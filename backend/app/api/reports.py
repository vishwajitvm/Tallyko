"""Sales reports. Ranges come from the client as timezone-aware datetimes (device local day)."""
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.config import settings as app_settings
from app.core.tenant import get_tenant_db
from app.services.access import Access, get_access, require
from app.models import Order, OrderItem, Payment, Product, ProductCategory, InventoryLog, TenantUser, KOT

router = APIRouter(prefix="/reports", tags=["Reports"])

# Cancelled (void) lines stay on bills for the record but were never sold
SOLD = func.coalesce(OrderItem.kitchen_status, "").notin_(["void", "removed"])

def _range(date_from: datetime | None, date_to: datetime | None) -> tuple[datetime, datetime]:
    """UTC-naive [start, end). Defaults to today in the business timezone."""
    tz = ZoneInfo(app_settings.TIMEZONE)
    if date_from is None:
        local_start = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)
        date_from = local_start
    if date_to is None:
        date_to = date_from + timedelta(days=1)
    def to_utc(v: datetime) -> datetime:
        if v.tzinfo is None:
            v = v.replace(tzinfo=tz)
        return (v - v.utcoffset()).replace(tzinfo=None)
    return to_utc(date_from), to_utc(date_to)

def _f(v) -> float:
    return float(v or 0)

@router.get("/summary")
async def sales_summary(date_from: datetime | None = None, date_to: datetime | None = None,
                        access: Access = Depends(require("reports.view", feature="reports")), db: AsyncSession = Depends(get_tenant_db)):
    tenant_id = access.tenant_id
    start, end = _range(date_from, date_to)
    base = [Order.tenant_id == tenant_id, Order.created_at >= start, Order.created_at < end]
    done = base + [Order.status == "completed", Order.archived_at.is_(None)]

    totals = (await db.execute(select(
        func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0), func.coalesce(func.sum(Order.subtotal), 0),
        func.coalesce(func.sum(Order.tax_amount), 0), func.coalesce(func.sum(Order.discount_amount), 0),
        func.coalesce(func.sum(Order.commission_amount), 0), func.coalesce(func.sum(Order.round_off), 0),
    ).where(*done))).one()
    count, gross, net, tax, discount, commission, round_off = totals
    cancelled = (await db.execute(select(func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
                                  .where(*base, Order.status == "cancelled"))).one()
    open_orders = (await db.execute(select(func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
                                    .where(Order.tenant_id == tenant_id, Order.status.in_(["open", "placed"])))).one()

    by_payment = (await db.execute(select(Payment.method, func.sum(Payment.amount), func.count(Payment.id))
                                   .join(Order, Order.id == Payment.order_id).where(*done).group_by(Payment.method))).all()
    by_channel = (await db.execute(select(Order.channel, func.count(Order.id), func.sum(Order.total_amount), func.sum(Order.commission_amount))
                                   .where(*done).group_by(Order.channel))).all()
    by_type = (await db.execute(select(Order.type, func.count(Order.id), func.sum(Order.total_amount)).where(*done).group_by(Order.type))).all()

    tz = ZoneInfo(app_settings.TIMEZONE)
    hourly = [0.0] * 24
    for created_at, total in (await db.execute(select(Order.created_at, Order.total_amount).where(*done))).all():
        local = created_at.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)
        hourly[local.hour] += float(total)

    top_items = (await db.execute(
        select(OrderItem.name, func.sum(OrderItem.quantity).label("qty"), func.sum(OrderItem.subtotal).label("revenue"))
        .join(Order, Order.id == OrderItem.order_id).where(*done, SOLD)
        .group_by(OrderItem.name).order_by(desc("revenue")).limit(10)
    )).all()
    by_category = (await db.execute(
        select(func.coalesce(ProductCategory.name, "Uncategorised"), func.sum(OrderItem.quantity), func.sum(OrderItem.subtotal))
        .join(Order, Order.id == OrderItem.order_id).join(Product, Product.id == OrderItem.product_id)
        .outerjoin(ProductCategory, ProductCategory.id == Product.category_id).where(*done, SOLD)
        .group_by(ProductCategory.name).order_by(desc(func.sum(OrderItem.subtotal)))
    )).all()

    count = int(count)
    return {
        "from": start.isoformat() + "Z", "to": end.isoformat() + "Z",
        "orders": count, "gross_sales": _f(gross), "net_sales": _f(Decimal(net) - Decimal(discount)), "tax": _f(tax),
        "discounts": _f(discount), "commission": _f(commission), "round_off": _f(round_off),
        "average_order_value": round(_f(gross) / count, 2) if count else 0.0,
        "cancelled_orders": int(cancelled[0]), "cancelled_value": _f(cancelled[1]),
        "open_orders": int(open_orders[0]), "open_value": _f(open_orders[1]),
        "by_payment": [{"method": m, "amount": _f(a), "count": int(c)} for m, a, c in by_payment],
        "by_channel": [{"channel": ch, "orders": int(c), "amount": _f(a), "commission": _f(cm), "net": _f(Decimal(a or 0) - Decimal(cm or 0))}
                       for ch, c, a, cm in by_channel],
        "by_type": [{"type": t, "orders": int(c), "amount": _f(a)} for t, c, a in by_type],
        "hourly": [round(v, 2) for v in hourly],
        "top_items": [{"name": n, "quantity": int(q or 0), "revenue": _f(r)} for n, q, r in top_items],
        "by_category": [{"category": n, "quantity": int(q or 0), "revenue": _f(r)} for n, q, r in by_category],
    }

@router.get("/items")
async def item_sales(date_from: datetime | None = None, date_to: datetime | None = None,
                     access: Access = Depends(require("reports.view", feature="advanced_reports")), db: AsyncSession = Depends(get_tenant_db)):
    start, end = _range(date_from, date_to)
    rows = (await db.execute(
        select(OrderItem.name, OrderItem.variant_name, func.sum(OrderItem.quantity), func.sum(OrderItem.subtotal), func.sum(OrderItem.tax_amount))
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.tenant_id == access.tenant_id, Order.status == "completed", Order.archived_at.is_(None), Order.created_at >= start, Order.created_at < end, SOLD)
        .group_by(OrderItem.name, OrderItem.variant_name).order_by(desc(func.sum(OrderItem.subtotal)))
    )).all()
    return [{"name": n, "variant": v, "quantity": int(q or 0), "revenue": _f(r), "tax": _f(t)} for n, v, q, r, t in rows]

@router.get("/wastage")
async def wastage(date_from: datetime | None = None, date_to: datetime | None = None,
                  access: Access = Depends(require("reports.view", feature="advanced_reports")), db: AsyncSession = Depends(get_tenant_db)):
    start, end = _range(date_from, date_to)
    rows = (await db.execute(
        select(Product.name, func.sum(InventoryLog.quantity_change), func.sum(-InventoryLog.quantity_change * func.coalesce(Product.cost_price, 0)))
        .join(Product, Product.id == InventoryLog.product_id)
        .where(InventoryLog.tenant_id == access.tenant_id, InventoryLog.reason == "wastage",
               InventoryLog.created_at >= start, InventoryLog.created_at < end)
        .group_by(Product.name)
    )).all()
    return [{"product": n, "quantity": abs(int(q or 0)), "cost": _f(c)} for n, q, c in rows]

@router.get("/staff")
async def staff_performance(date_from: datetime | None = None, date_to: datetime | None = None,
                            access: Access = Depends(require("reports.view", "staff.view", feature="advanced_reports")),
                            db: AsyncSession = Depends(get_tenant_db)):
    """Per staff member: orders taken (waiter), sales, average bill, tables & covers served, items, bills settled, cancellations."""
    start, end = _range(date_from, date_to)
    return await _staff_rows(db, access.tenant_id, start, end)

@router.get("/me")
async def my_performance(date_from: datetime | None = None, date_to: datetime | None = None,
                         access: Access = Depends(require("reports.view_own", "reports.view", any_of=True)),
                         db: AsyncSession = Depends(get_tenant_db)):
    """A staff member's own numbers (waiters/cashiers see their day without seeing the whole business)."""
    start, end = _range(date_from, date_to)
    rows = await _staff_rows(db, access.tenant_id, start, end, only=access.staff_id)
    return rows[0] if rows else {"staff_id": access.staff_id, "name": access.staff_name, "orders": 0, "sales": 0.0, "average_bill": 0.0,
                                 "tables_served": 0, "covers": 0, "items": 0, "bills_settled": 0, "collected": 0.0, "cancelled": 0}

async def _staff_rows(db: AsyncSession, tenant_id: str, start, end, only=None) -> list[dict]:
    from app.models import TenantUser, TableEntity
    window = [Order.tenant_id == tenant_id, Order.created_at >= start, Order.created_at < end]
    taken_q = (select(Order.waiter_id, func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0),
                      func.count(func.distinct(Order.table_id)))
               .where(*window, Order.status == "completed", Order.archived_at.is_(None), Order.waiter_id.isnot(None)).group_by(Order.waiter_id))
    covers_q = (select(Order.waiter_id, func.coalesce(func.sum(TableEntity.capacity), 0))
                .join(TableEntity, TableEntity.id == Order.table_id)
                .where(*window, Order.status == "completed", Order.archived_at.is_(None), Order.waiter_id.isnot(None)).group_by(Order.waiter_id))
    items_q = (select(Order.waiter_id, func.coalesce(func.sum(OrderItem.quantity), 0)).join(OrderItem, OrderItem.order_id == Order.id)
               .where(*window, Order.status == "completed", Order.archived_at.is_(None), Order.waiter_id.isnot(None), SOLD).group_by(Order.waiter_id))
    settled_q = (select(Order.settled_by, func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
                 .where(*window, Order.status == "completed", Order.archived_at.is_(None), Order.settled_by.isnot(None)).group_by(Order.settled_by))
    cancelled_q = (select(Order.waiter_id, func.count(Order.id)).where(*window, Order.status == "cancelled", Order.waiter_id.isnot(None))
                   .group_by(Order.waiter_id))
    if only:
        taken_q, covers_q, items_q = taken_q.where(Order.waiter_id == only), covers_q.where(Order.waiter_id == only), items_q.where(Order.waiter_id == only)
        settled_q, cancelled_q = settled_q.where(Order.settled_by == only), cancelled_q.where(Order.waiter_id == only)
    taken = {r[0]: r for r in (await db.execute(taken_q)).all()}
    covers = dict((await db.execute(covers_q)).all())
    items = dict((await db.execute(items_q)).all())
    settled = {r[0]: r for r in (await db.execute(settled_q)).all()}
    cancelled = dict((await db.execute(cancelled_q)).all())
    ids = set(taken) | set(settled) | set(cancelled)
    staff_q = select(TenantUser).where(TenantUser.tenant_id == tenant_id)
    staff = {s.id: s for s in (await db.execute(staff_q)).scalars().all()}
    rows = []
    for sid in ids:
        member = staff.get(sid)
        _, orders, sales, tables = taken.get(sid, (sid, 0, 0, 0))
        _, settled_count, collected = settled.get(sid, (sid, 0, 0))
        rows.append({
            "staff_id": str(sid), "name": (member.full_name or member.username) if member else "Former staff",
            "role": member.role if member else None, "orders": int(orders), "sales": _f(sales),
            "average_bill": round(_f(sales) / int(orders), 2) if orders else 0.0, "tables_served": int(tables),
            "covers": int(covers.get(sid, 0)), "items": int(items.get(sid, 0)), "bills_settled": int(settled_count),
            "collected": _f(collected), "cancelled": int(cancelled.get(sid, 0)),
        })
    return sorted(rows, key=lambda r: -r["sales"])
