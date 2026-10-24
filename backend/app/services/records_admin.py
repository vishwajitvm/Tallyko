"""Tallyko-only record corrections. Businesses can never delete their own records (the app's database role has no
DELETE on bills); the super admin can, usually on the owner's request, through system sessions:

- archive: the bill stays in the database but disappears from lists and reports (preferred: GST invoice numbers stay
  continuous, and it can be undone)
- delete: permanently removes the bill and everything attached to it, after reversing its effects on stock, loyalty
  points and offer usage exactly like a cancellation. A snapshot is written to the platform audit log first.
"""
from datetime import datetime
from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models import KOT, EmailLog, InventoryLog, OfferRedemption, Order, OrderItem, Payment, TableEntity
from app.services import order_service

def bill_snapshot(order: Order) -> dict:
    return {"id": str(order.id), "code": order.code, "invoice_no": order.invoice_no, "status": order.status,
            "total": float(order.total_amount or 0), "created_at": order.created_at.isoformat() if order.created_at else None,
            "customer": order.customer_name, "channel": order.channel,
            "items": [[i.name, i.quantity, float(i.unit_price)] for i in order.items], "payments": [[p.method, float(p.amount)] for p in order.payments]}

async def _orders(db: AsyncSession, tenant_id, order_ids) -> list[Order]:
    orders = []
    for oid in order_ids:
        orders.append(await order_service.load_order(db, str(tenant_id), oid))
    return orders

async def archive_orders(db: AsyncSession, tenant_id, order_ids, reason: str, undo: bool = False) -> list[dict]:
    """Running bills are cancelled first (frees the table, stops the kitchen)."""
    out = []
    for order in await _orders(db, tenant_id, order_ids):
        if undo:
            order.archived_at, order.archived_reason = None, None
        else:
            if order.status in order_service.OPEN_STATUSES:
                order = await order_service.cancel(db, str(tenant_id), order.id, f"Archived by Tallyko: {reason}")
            order.archived_at, order.archived_reason = datetime.utcnow(), reason[:200]
        out.append(bill_snapshot(order))
    await db.flush()
    return out

async def hard_delete_orders(db: AsyncSession, tenant_id, order_ids, reason: str) -> list[dict]:
    snapshots = []
    for order in await _orders(db, tenant_id, order_ids):
        snapshots.append(bill_snapshot(order))
        if order.status not in ("cancelled", "merged"):
            await order_service.cancel(db, str(tenant_id), order.id, f"Deleted by Tallyko: {reason}")  # reverse stock & loyalty
        await db.execute(update(TableEntity).where(TableEntity.current_order_id == order.id).values(current_order_id=None))
        await db.execute(delete(OfferRedemption).where(OfferRedemption.order_id == order.id))
        await db.execute(delete(InventoryLog).where(InventoryLog.order_id == order.id))  # its sale and its reversal net to zero
        await db.execute(update(EmailLog).where(EmailLog.order_id == order.id).values(order_id=None))
        await db.execute(delete(Payment).where(Payment.order_id == order.id))
        await db.execute(delete(OrderItem).where(OrderItem.order_id == order.id))
        await db.execute(delete(KOT).where(KOT.order_id == order.id))
        await db.execute(delete(Order).where(Order.id == order.id))
    await db.flush()
    return snapshots

async def search_orders(db: AsyncSession, tenant_id, q: str | None, status: str | None, include_archived: bool, limit: int,
                        order_ids=None) -> list[dict]:
    query = select(Order).where(Order.tenant_id == tenant_id)
    if order_ids:
        query = query.where(Order.id.in_(order_ids))
    if q:
        like = f"%{q.strip()}%"
        from sqlalchemy import or_
        query = query.where(or_(Order.code.ilike(like), Order.invoice_no.ilike(like), Order.customer_name.ilike(like)))
    if status:
        query = query.where(Order.status == status)
    if not include_archived:
        query = query.where(Order.archived_at.is_(None))
    rows = (await db.execute(query.order_by(Order.created_at.desc()).limit(limit))).scalars().all()
    return [{"id": str(o.id), "code": o.code, "invoice_no": o.invoice_no, "status": o.status, "total": float(o.total_amount or 0),
             "customer_name": o.customer_name, "channel": o.channel, "created_at": o.created_at.isoformat() + "Z",
             "archived": o.archived_at is not None, "archived_reason": o.archived_reason} for o in rows]
