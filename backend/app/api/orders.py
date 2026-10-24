import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field
from app.core.tenant import get_tenant_db
from app.models import Order, OrderItem, TableEntity, TenantUser
from app.schemas.billing import (OrderCreate, OrderAddItems, OrderPay, OrderCancel, OrderTransfer, OrderCustomer, OrderOffer,
                                 ItemsStatus, ItemsVoid, ItemsComp, ItemsMove, BillMerge, BillDetails)
from app.services import floor_service, order_service, audit
from app.services import offers as offer_engine
from app.services.access import Access, get_access, require
from app.services.pricing import PricedLine, price_order

router = APIRouter(prefix="/orders", tags=["Orders"])

def _to_utc_naive(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is None:
        return value
    return (value - value.utcoffset()).replace(tzinfo=None)

def _own_orders_only(access: Access):
    """Staff without `orders.view_all` (e.g. waiters) see orders they took or created, plus every running table bill
    (any waiter can serve any table); other people's closed bills stay private."""
    conditions = [Order.waiter_id == access.staff_id, Order.created_by == access.user_id]
    if access.can("tables.view"):
        conditions.append((Order.table_id.isnot(None)) & (Order.status.in_(order_service.OPEN_STATUSES)))
    return or_(*conditions)

async def _visible_order(db, access: Access, order_id) -> Order:
    order = await order_service.load_order(db, access.tenant_id, order_id)
    running_table_bill = order.table_id is not None and order.status in order_service.OPEN_STATUSES and access.can("tables.view")
    if not (access.can("orders.view_all") or running_table_bill or str(order.waiter_id) == str(access.staff_id)
            or str(order.created_by) == str(access.user_id)):
        raise HTTPException(status_code=404, detail="Order not found")
    return order

async def _names(db, tenant_id: str, orders) -> tuple[dict, dict]:
    table_ids = {o.table_id for o in orders if o.table_id}
    staff_ids = {s for o in orders for s in (o.waiter_id, o.settled_by) if s}
    tables, staff = {}, {}
    if table_ids:
        rows = await db.execute(select(TableEntity.id, TableEntity.table_number).where(TableEntity.id.in_(table_ids), TableEntity.tenant_id == tenant_id))
        tables = {tid: number for tid, number in rows.all()}
    if staff_ids:
        rows = await db.execute(select(TenantUser.id, TenantUser.full_name, TenantUser.username).where(TenantUser.id.in_(staff_ids), TenantUser.tenant_id == tenant_id))
        staff = {sid: name or email for sid, name, email in rows.all()}
    return tables, staff

def _serialize(order: Order, tables: dict, staff: dict, include_removed: bool = False) -> dict:
    data = order_service.serialize_order(order, include_removed)
    data["table_label"] = tables.get(order.table_id)
    data["waiter_name"] = staff.get(order.waiter_id)
    data["settled_by_name"] = staff.get(order.settled_by)
    return data

@router.get("")
async def list_orders(
    status: str | None = Query(None, pattern="^(placed|open|completed|cancelled|merged|active)$"),
    channel: str | None = Query(None, max_length=20),
    table_id: uuid.UUID | None = None,
    waiter_id: uuid.UUID | None = None,
    q: str | None = Query(None, max_length=60),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    include_archived: bool = False,
    summary: bool = False,
    with_counts: bool = False,
    access: Access = Depends(require("orders.create", "orders.view_all", "orders.pay", any_of=True)),
    db=Depends(get_tenant_db),
):
    """`summary=true`: light rows (no lines / payments) for big lists. `with_counts=true`: bills per status for the same
    filters (the status chips), in the same call."""
    query = select(Order).where(Order.tenant_id == access.tenant_id)
    if not (include_archived and access.is_owner):
        query = query.where(Order.archived_at.is_(None))  # archived by Tallyko on the owner's request
    if not access.can("orders.view_all"):
        query = query.where(_own_orders_only(access))
    if channel:
        query = query.where(Order.channel == channel.upper())
    if table_id:
        query = query.where(Order.table_id == table_id)
    if waiter_id:
        query = query.where(Order.waiter_id == waiter_id)
    if date_from:
        query = query.where(Order.created_at >= _to_utc_naive(date_from))
    if date_to:
        query = query.where(Order.created_at < _to_utc_naive(date_to))
    if q:
        term = q.strip()
        query = query.where(or_(Order.code.ilike(f"%{term}%"), Order.invoice_no.ilike(f"%{term}%"),
                                Order.customer_phone.ilike(f"%{term}%"), Order.customer_name.ilike(f"%{term}%"),
                                Order.external_order_id.ilike(f"%{term}%")))
    counts = None
    if with_counts:
        rows = (await db.execute(query.with_only_columns(Order.status, func.count()).group_by(Order.status))).all()
        by_status = {st: int(n) for st, n in rows}
        counts = {**by_status, "all": sum(by_status.values()),
                  "active": sum(by_status.get(st, 0) for st in order_service.OPEN_STATUSES)}
    if status == "active":
        query = query.where(Order.status.in_(order_service.OPEN_STATUSES))
    elif status:
        query = query.where(Order.status == status)
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    if summary:
        orders = (await db.execute(query.order_by(Order.created_at.desc()).limit(limit).offset(offset))).scalars().all()
        tables, staff = await _names(db, access.tenant_id, orders)
        line_counts = dict((await db.execute(
            select(OrderItem.order_id, func.coalesce(func.sum(OrderItem.quantity), 0))
            .where(OrderItem.order_id.in_([o.id for o in orders] or [uuid.uuid4()]),
                   func.coalesce(OrderItem.kitchen_status, "").notin_(["void", "removed"]))
            .group_by(OrderItem.order_id))).all())
        items = [_summary_row(o, tables, staff, int(line_counts.get(o.id, 0))) for o in orders]
    else:
        result = await db.execute(query.options(selectinload(Order.items), selectinload(Order.payments))
                                  .order_by(Order.created_at.desc()).limit(limit).offset(offset))
        orders = result.scalars().all()
        tables, staff = await _names(db, access.tenant_id, orders)
        items = [_serialize(o, tables, staff) for o in orders]
    if not access.can("customers.view_contact"):
        for item in items:
            item["customer_phone"] = _mask(item["customer_phone"])
    return {"items": items, "total": total, "counts": counts}

def _summary_row(o: Order, tables: dict, staff: dict, item_count: int) -> dict:
    return {"id": str(o.id), "code": o.code, "invoice_no": o.invoice_no, "status": o.status, "payment_status": o.payment_status,
            "type": o.type, "channel": o.channel, "external_order_id": o.external_order_id, "token_no": o.token_no,
            "table_id": str(o.table_id) if o.table_id else None, "table_label": tables.get(o.table_id), "bill_label": o.bill_label,
            "customer_name": o.customer_name, "customer_phone": o.customer_phone, "waiter_id": str(o.waiter_id) if o.waiter_id else None,
            "waiter_name": staff.get(o.waiter_id), "settled_by_name": staff.get(o.settled_by), "total_amount": float(o.total_amount or 0),
            "discount_amount": float(o.discount_amount or 0), "item_count": item_count, "payment_claim": o.payment_claim,
            "archived": o.archived_at is not None, "created_at": o.created_at.isoformat() + "Z" if o.created_at else None,
            "completed_at": o.completed_at.isoformat() + "Z" if o.completed_at else None}

def _mask(phone: str | None) -> str | None:
    return f"••••••{phone[-4:]}" if phone and len(phone) > 4 else phone

@router.get("/{order_id}")
async def get_order(order_id: uuid.UUID, access: Access = Depends(get_access), db=Depends(get_tenant_db)):
    order = await _visible_order(db, access, order_id)
    tables, staff = await _names(db, access.tenant_id, [order])
    data = _serialize(order, tables, staff, include_removed=access.is_owner)  # removed lines: owner's eyes only
    if not access.can("customers.view_contact"):
        data["customer_phone"] = _mask(data["customer_phone"])
    return data

@router.post("")
async def create_order(data: OrderCreate, access: Access = Depends(require("orders.create")), db=Depends(get_tenant_db)):
    if data.payments and not access.can("orders.pay"):
        raise HTTPException(status_code=403, detail="Your role can't take payments")
    if (data.discount or data.redeem_points) and not access.can("orders.discount"):
        raise HTTPException(status_code=403, detail="Your role can't give discounts")
    if (data.offer_id or data.offer_code) and not access.can("offers.apply"):
        raise HTTPException(status_code=403, detail="Your role can't apply offers")
    if not access.has("offers"):
        data.auto_offers = False
    order, created = await order_service.create_order(db, access.tenant_id, data, user_id=access.user_id, staff_id=access.staff_id)
    if created and data.discount:
        audit.record(db, access, "order.discount", entity_type="order", entity_id=order.id,
                     summary=f"{data.discount.value}{'%' if data.discount.type == 'percent' else ' ₹'} off bill {order.code}")
    await db.commit()
    tables, staff = await _names(db, access.tenant_id, [order])
    result = _serialize(order, tables, staff)
    result["created"] = created
    return result

@router.post("/{order_id}/items")
async def add_items(order_id: uuid.UUID, data: OrderAddItems, access: Access = Depends(require("orders.create")), db=Depends(get_tenant_db)):
    await _visible_order(db, access, order_id)
    order = await order_service.add_items(db, access.tenant_id, order_id, data.items, data.send_to_kitchen)
    await db.commit()
    tables, staff = await _names(db, access.tenant_id, [order])
    return _serialize(order, tables, staff)

@router.delete("/{order_id}/items/{item_id}")
async def remove_item(order_id: uuid.UUID, item_id: uuid.UUID, access: Access = Depends(require("orders.create")), db=Depends(get_tenant_db)):
    before = await _visible_order(db, access, order_id)
    item = next((i for i in before.items if i.id == item_id), None)
    order = await order_service.remove_item(db, access.tenant_id, order_id, item_id, can_void_sent=access.can("orders.void_item"),
                                            staff_id=access.staff_id)
    if item:
        audit.record(db, access, "order.void_item" if item.kot_id else "order.remove_item", entity_type="order", entity_id=order.id,
                     summary=f"{'Cancelled' if item.kot_id else 'Removed'} {item.quantity} × {item.name} on bill {order.code}",
                     details={"value": float(item.unit_price) * item.quantity})
    await db.commit()
    tables, staff = await _names(db, access.tenant_id, [order])
    return _serialize(order, tables, staff)

@router.post("/{order_id}/pay")
async def pay_order(order_id: uuid.UUID, data: OrderPay, access: Access = Depends(require("orders.pay")), db=Depends(get_tenant_db)):
    if (data.discount or data.redeem_points) and not access.can("orders.discount"):
        raise HTTPException(status_code=403, detail="Your role can't give discounts")
    if data.offer_id and not access.can("offers.apply"):
        raise HTTPException(status_code=403, detail="Your role can't apply offers")
    order, change = await order_service.pay(db, access.tenant_id, order_id, data.payments, data.discount, data.redeem_points,
                                            offer_id=data.offer_id, remove_offer=data.remove_offer, staff_id=access.staff_id)
    if data.discount:
        audit.record(db, access, "order.discount", entity_type="order", entity_id=order.id,
                     summary=f"{data.discount.value}{'%' if data.discount.type == 'percent' else ' ₹'} off bill {order.invoice_no or order.code}")
    await db.commit()
    tables, staff = await _names(db, access.tenant_id, [order])
    result = _serialize(order, tables, staff)
    result["change"] = float(change)
    return result

@router.get("/{order_id}/offers")
async def applicable_offers(order_id: uuid.UUID, access: Access = Depends(require("offers.apply")), db=Depends(get_tenant_db)):
    """Every active offer with whether it applies to this bill right now (and why not)."""
    order = await _visible_order(db, access, order_id)
    return await _evaluate_for(db, access.tenant_id, order)

async def _evaluate_for(db, tenant_id: str, order: Order) -> list[dict]:
    settings = await order_service.get_settings(db, tenant_id)
    paid_items = [i for i in order.items if not order_service._is_free_line(i)]
    probe = [PricedLine(key=i, unit_price=i.unit_price, quantity=i.quantity, tax_rate=i.tax_rate) for i in paid_items]
    from decimal import Decimal
    for line in probe:
        line.unit_price, line.tax_rate = Decimal(line.unit_price), Decimal(line.tax_rate)
    price_order(probe, settings.prices_include_tax)
    products = await order_service._load_products(db, tenant_id, {i.product_id for i in paid_items})
    lines = [offer_engine.OfferLine(index=n, product_id=str(l.key.product_id),
                                    category_id=str(products[l.key.product_id].category_id) if products.get(l.key.product_id) and products[l.key.product_id].category_id else None,
                                    quantity=l.quantity, taxable=l.taxable, gross=l.gross) for n, l in enumerate(probe)]
    offers = await offer_engine.active_offers(db, tenant_id)
    visits, used = await offer_engine.customer_context(db, tenant_id, order.customer_id, offers)
    ctx = offer_engine.OfferContext(lines=lines, channel=order.channel, order_type=order.type, now_utc=datetime.utcnow(),
                                    customer_id=str(order.customer_id) if order.customer_id else None,
                                    customer_visits_in_window=visits, customer_redemptions=used)
    out = []
    for offer in offers:
        r = offer_engine.evaluate(offer, ctx)
        out.append({"offer_id": r.offer_id, "name": r.name, "description": r.description, "eligible": r.eligible,
                    "reason": r.reason, "discount": float(r.discount), "free_product_id": r.free_product_id,
                    "auto_apply": offer.auto_apply, "applied": order.offer_id == offer.id})
    return sorted(out, key=lambda x: (not x["eligible"], -x["discount"]))

@router.post("/{order_id}/offer")
async def set_offer(order_id: uuid.UUID, data: OrderOffer, access: Access = Depends(require("offers.apply")), db=Depends(get_tenant_db)):
    await _visible_order(db, access, order_id)
    order, warning = await order_service.change_offer(db, access.tenant_id, order_id, data.offer_id, data.offer_code, data.remove)
    if order.offer_id:
        audit.record(db, access, "order.offer", entity_type="order", entity_id=order.id, summary=f"{order.offer_name} on bill {order.code}")
    await db.commit()
    tables, staff = await _names(db, access.tenant_id, [order])
    result = _serialize(order, tables, staff)
    result["warning"] = warning
    return result

@router.post("/{order_id}/accept")
async def accept_order(order_id: uuid.UUID, access: Access = Depends(require("orders.accept_online")), db=Depends(get_tenant_db)):
    order = await order_service.accept(db, access.tenant_id, order_id)
    await db.commit()
    tables, staff = await _names(db, access.tenant_id, [order])
    return _serialize(order, tables, staff)

@router.post("/{order_id}/reject")
async def reject_order(order_id: uuid.UUID, data: OrderCancel, access: Access = Depends(require("orders.accept_online")), db=Depends(get_tenant_db)):
    order = await order_service.load_order(db, access.tenant_id, order_id)
    if order.status != "placed":
        raise HTTPException(status_code=409, detail="Only new online orders can be rejected")
    order = await order_service.cancel(db, access.tenant_id, order_id, f"Rejected: {data.reason}")
    await db.commit()
    tables, staff = await _names(db, access.tenant_id, [order])
    return _serialize(order, tables, staff)

@router.post("/{order_id}/cancel")
async def cancel_order(order_id: uuid.UUID, data: OrderCancel, access: Access = Depends(require("orders.cancel")), db=Depends(get_tenant_db)):
    order = await order_service.cancel(db, access.tenant_id, order_id, data.reason)
    audit.record(db, access, "order.cancel", entity_type="order", entity_id=order.id,
                 summary=f"Bill {order.invoice_no or order.code} (₹{order.total_amount}) — {data.reason}")
    await db.commit()
    tables, staff = await _names(db, access.tenant_id, [order])
    return _serialize(order, tables, staff)

@router.post("/{order_id}/transfer")
async def transfer_order(order_id: uuid.UUID, data: OrderTransfer, access: Access = Depends(require("tables.transfer", feature="tables")), db=Depends(get_tenant_db)):
    await _visible_order(db, access, order_id)
    order = await order_service.transfer_table(db, access.tenant_id, order_id, data.table_id)
    await db.commit()
    tables, staff = await _names(db, access.tenant_id, [order])
    return _serialize(order, tables, staff)

@router.put("/{order_id}/customer")
async def set_customer(order_id: uuid.UUID, data: OrderCustomer, access: Access = Depends(require("orders.create")), db=Depends(get_tenant_db)):
    order = await _visible_order(db, access, order_id)
    if order.status not in order_service.OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="This order is already closed")
    customer = await order_service._resolve_customer(db, access.tenant_id, data.customer_id, data.customer_name, data.customer_phone)
    order.customer_id = customer.id if customer else None
    order.customer_name = customer.name if customer else data.customer_name
    order.customer_phone = customer.phone if customer else data.customer_phone
    await db.commit()
    order = await order_service.load_order(db, access.tenant_id, order_id)
    tables, staff = await _names(db, access.tenant_id, [order])
    return _serialize(order, tables, staff)


# --- Running bills: item status, cancel, on the house, split / merge ------------------------------------------------

async def _respond(db, access: Access, order: Order) -> dict:
    tables, staff = await _names(db, access.tenant_id, [order])
    return _serialize(order, tables, staff)

def _lines(items) -> list[tuple]:
    return [(i.item_id, i.quantity) for i in items]

@router.post("/{order_id}/items/status")
async def set_items_status(order_id: uuid.UUID, data: ItemsStatus, access: Access = Depends(require("kitchen.update")), db=Depends(get_tenant_db)):
    """Mark lines preparing / ready / served — from the kitchen display, or by floor staff when there's no kitchen screen."""
    order = await floor_service.set_items_status(db, access.tenant_id, order_id, data.item_ids, data.status)
    await db.commit()
    return await _respond(db, access, order)

@router.post("/{order_id}/items/void")
async def void_items(order_id: uuid.UUID, data: ItemsVoid, access: Access = Depends(require("orders.create")), db=Depends(get_tenant_db)):
    """Cancel items (all or part of a line). Items the kitchen has need `orders.void_item` and a reason."""
    before = await _visible_order(db, access, order_id)
    names = {str(i.id): i.name for i in before.items}
    order, warning = await floor_service.void_items(db, access.tenant_id, order_id, _lines(data.items), data.reason, access.staff_id,
                                                    can_void_sent=access.can("orders.void_item"), waste=data.waste)
    what = ", ".join(f"{i.quantity or 'all'} × {names.get(str(i.item_id), 'item')}" for i in data.items)
    sent = any(str(i.item_id) in {str(x.id) for x in before.items if x.kot_id} for i in data.items)
    audit.record(db, access, "order.void_item" if sent else "order.remove_item", entity_type="order", entity_id=order.id,
                 summary=f"Cancelled {what} on bill {order.code}" + (f": {data.reason}" if data.reason else ""),
                 details={"waste": data.waste})
    await db.commit()
    result = await _respond(db, access, order)
    result["warning"] = warning
    return result

@router.post("/{order_id}/items/comp")
async def comp_items(order_id: uuid.UUID, data: ItemsComp, access: Access = Depends(require("orders.discount")), db=Depends(get_tenant_db)):
    """On the house: the items cost nothing on this bill (value kept for reports)."""
    await _visible_order(db, access, order_id)
    order = await floor_service.comp_items(db, access.tenant_id, order_id, _lines(data.items), data.reason)
    comped = sum(float(i.comp_value or 0) for i in order.items if i.comp_reason)
    audit.record(db, access, "order.comp", entity_type="order", entity_id=order.id,
                 summary=f"On the house on bill {order.code}: {data.reason}", details={"bill_comp_value": comped})
    await db.commit()
    return await _respond(db, access, order)

@router.post("/{order_id}/items/move")
async def move_items(order_id: uuid.UUID, data: ItemsMove, access: Access = Depends(require("orders.create")), db=Depends(get_tenant_db)):
    """Split a bill: move items (or part of a line) to another open bill, or to a new bill on the same table."""
    await _visible_order(db, access, order_id)
    source, target = await floor_service.move_items(db, access.tenant_id, order_id, _lines(data.items), data.target_order_id,
                                                    data.new_bill_label, user_id=access.user_id)
    audit.record(db, access, "order.split", entity_type="order", entity_id=source.id,
                 summary=f"Moved {len(data.items)} item(s) from bill {source.bill_label or source.code} to {target.bill_label or target.code}")
    await db.commit()
    tables, staff = await _names(db, access.tenant_id, [source, target])
    return {"source": _serialize(source, tables, staff), "target": _serialize(target, tables, staff)}

@router.post("/{order_id}/merge")
async def merge_bills(order_id: uuid.UUID, data: BillMerge, access: Access = Depends(require("orders.create")), db=Depends(get_tenant_db)):
    """Bring another open bill's items into this one (e.g. tables joined, one person pays)."""
    await _visible_order(db, access, order_id)
    await _visible_order(db, access, data.source_order_id)
    order = await floor_service.merge_bills(db, access.tenant_id, order_id, data.source_order_id)
    audit.record(db, access, "order.merge", entity_type="order", entity_id=order.id, summary=f"Merged a bill into {order.code}")
    await db.commit()
    return await _respond(db, access, order)

@router.put("/{order_id}/details")
async def bill_details(order_id: uuid.UUID, data: BillDetails, access: Access = Depends(require("orders.create")), db=Depends(get_tenant_db)):
    order = await _visible_order(db, access, order_id)
    if order.status not in order_service.OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="This bill is already closed")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(order, key, (value or "").strip() or None if key == "bill_label" else value)
    await db.commit()
    return await _respond(db, access, await order_service.load_order(db, access.tenant_id, order_id))


# --- Customer said "I've paid by UPI" (table QR) -----------------------------------------------------------------------

class ClaimReview(BaseModel):
    reason: str | None = Field(None, max_length=200)

@router.post("/{order_id}/payment-claim/confirm")
async def confirm_payment_claim(order_id: uuid.UUID, access: Access = Depends(require("orders.pay")), db=Depends(get_tenant_db)):
    """Seen the money in the shop's UPI app: record the UPI payment (closes the bill if it covers it)."""
    from app.schemas.billing import PaymentIn
    order = await order_service.load_order(db, access.tenant_id, order_id)
    claim = order.payment_claim
    if not claim:
        raise HTTPException(status_code=409, detail="No payment to confirm")
    due = float(order.total_amount) - sum(float(p.amount) for p in order.payments)
    amount = round(min(float(claim.get("amount") or due), due), 2)
    order.payment_claim = None
    order, _ = await order_service.pay(db, access.tenant_id, order_id, [PaymentIn(method="UPI", amount=amount, reference=claim.get("reference"))],
                                       None, None, staff_id=access.staff_id)
    await db.commit()
    return await _respond(db, access, order)

@router.post("/{order_id}/payment-claim/reject")
async def reject_payment_claim(order_id: uuid.UUID, data: ClaimReview, access: Access = Depends(require("orders.pay")), db=Depends(get_tenant_db)):
    """Money didn't arrive: the customer is asked to pay again or at the counter."""
    order = await order_service.load_order(db, access.tenant_id, order_id)
    if not order.payment_claim:
        raise HTTPException(status_code=409, detail="No payment to reject")
    order.payment_claim = None
    order.notes = "\n".join(filter(None, [order.notes, f"UPI payment not received{': ' + data.reason if data.reason else ''}"]))
    audit.record(db, access, "order.claim_rejected", entity_type="order", entity_id=order.id, summary=f"UPI claim on {order.code} not received")
    await db.commit()
    return await _respond(db, access, await order_service.load_order(db, access.tenant_id, order_id))
