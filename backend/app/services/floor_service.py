"""Running bills on the floor: per-item kitchen status, voids, complimentary items, splitting and merging bills.

Real situations this covers:
- 4 items on a ticket, 2 ready and 2 still cooking → each line has its own kitchen status; the ticket follows its lines.
- No kitchen screen (owner alone, small café) → anyone allowed to update kitchen status marks items ready / served.
- "Two more rotis" → add_items again: a new KOT for just those, the earlier rotis keep their status.
- Customer cancels 1 of 3 rotis after it reached the kitchen → partial void with a reason; the kitchen sees it struck out;
  optionally booked as wastage. Unsent items are simply removed.
- On the house → complimentary line (price 0, reason and value kept for reports).
- Two parties at one table / "separate bills please" → several bills per table; move selected items (or part of a line)
  to another or a new bill; merge bills when tables join.
Every change re-prices the affected bills with the same engine (offers re-checked, manual discount kept).
"""
import uuid
from datetime import datetime
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models import KOT, InventoryLog, Order, OrderItem, Product
from app.services.order_service import (FREE_NOTE, OPEN_STATUSES, REMOVED, VOID, _claim_table, _is_free_line, _manual_discount, _price,
                                        _release_table, is_void, load_order, order_code)
from app.services.pricing import ZERO, money
from app.services.settings_service import get_settings
from app.services import counters

KITCHEN_FLOW = ("pending", "preparing", "ready", "served")

def _open(order: Order) -> None:
    if order.status not in OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="This bill is already closed")

def _find(order: Order, item_id) -> OrderItem:
    item = next((i for i in order.items if str(i.id) == str(item_id)), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found on this bill")
    return item

def _split(item: OrderItem, quantity: int) -> OrderItem:
    """Take `quantity` off a line into a new line (same price/tax snapshot, same KOT and kitchen status)."""
    if quantity <= 0 or quantity > item.quantity:
        raise HTTPException(status_code=400, detail=f"Choose between 1 and {item.quantity} of {item.name}")
    if quantity == item.quantity:
        return item
    item.quantity -= quantity
    return OrderItem(id=uuid.uuid4(), order_id=item.order_id, product_id=item.product_id, variant_id=item.variant_id, kot_id=item.kot_id,
                     name=item.name, variant_name=item.variant_name, quantity=quantity, unit_price=item.unit_price,
                     tax_rate=item.tax_rate, tax_amount=ZERO, tax_components=[{**c, "amount": 0.0} for c in (item.tax_components or [])],
                     hsn_sac=item.hsn_sac, subtotal=ZERO, notes=item.notes, kitchen_status=item.kitchen_status,
                     status_at=item.status_at, comp_reason=item.comp_reason, created_at=item.created_at)

async def _reprice(db: AsyncSession, tenant_id: str, order: Order) -> str | None:
    settings = await get_settings(db, tenant_id)
    await db.flush()
    order = await load_order(db, tenant_id, order.id)
    _, warning = await _price(db, tenant_id, order, list(order.items), settings, flat=_manual_discount(order), percent=ZERO)
    return warning

async def sync_kot_status(db: AsyncSession, kot_ids) -> None:
    """A ticket follows its lines: all void → cancelled; otherwise the least advanced live line."""
    for kot_id in {k for k in kot_ids if k}:
        kot = await db.get(KOT, kot_id)
        if kot is None:
            continue
        lines = (await db.execute(select(OrderItem).where(OrderItem.kot_id == kot_id))).scalars().all()
        live = [l for l in lines if not is_void(l)]
        if not live:
            kot.status = "cancelled"
            continue
        kot.status = min((l.kitchen_status or "pending" for l in live), key=lambda s: KITCHEN_FLOW.index(s) if s in KITCHEN_FLOW else 0)

async def set_items_status(db: AsyncSession, tenant_id: str, order_id, item_ids: list, status: str) -> Order:
    if status not in KITCHEN_FLOW:
        raise HTTPException(status_code=400, detail="Unknown kitchen status")
    order = await load_order(db, tenant_id, order_id)
    if order.status == "cancelled":
        raise HTTPException(status_code=409, detail="This bill was cancelled")
    now = datetime.utcnow()
    touched = set()
    for item_id in item_ids:
        item = _find(order, item_id)
        if is_void(item):
            raise HTTPException(status_code=409, detail=f"{item.name} was cancelled")
        if item.kot_id is None:
            raise HTTPException(status_code=400, detail=f"{item.name} isn't a kitchen item (or hasn't been sent yet)")
        item.kitchen_status, item.status_at = status, now
        touched.add(item.kot_id)
    await db.flush()
    await sync_kot_status(db, touched)
    await db.flush()
    return await load_order(db, tenant_id, order.id)

async def set_ticket_status(db: AsyncSession, tenant_id: str, kot: KOT, status: str) -> None:
    """Kitchen bumps a whole ticket: its live lines move together."""
    now = datetime.utcnow()
    lines = (await db.execute(select(OrderItem).where(OrderItem.kot_id == kot.id))).scalars().all()
    for line in lines:
        if is_void(line):
            continue
        if status == "cancelled":
            line.kitchen_status, line.void_reason = VOID, line.void_reason or "Ticket cancelled"
        else:
            line.kitchen_status = status
        line.status_at = now
    kot.status = status

async def void_items(db: AsyncSession, tenant_id: str, order_id, lines: list[tuple], reason: str | None, staff_id,
                     can_void_sent: bool, waste: bool = False) -> tuple[Order, str | None]:
    """lines: [(item_id, quantity | None)]. Unsent items are removed; sent ones are kept as cancelled lines
    (so the kitchen and the audit log see them) and are never charged."""
    order = await load_order(db, tenant_id, order_id)
    _open(order)
    if order.payments:
        raise HTTPException(status_code=409, detail="Items can't change after a payment was taken. Refund or cancel the bill instead.")
    now = datetime.utcnow()
    touched, wasted = set(), []
    for item_id, quantity in lines:
        item = _find(order, item_id)
        if is_void(item):
            continue
        if _is_free_line(item):
            raise HTTPException(status_code=400, detail="Free offer items follow the offer; remove the offer instead")
        qty = quantity or item.quantity
        if item.kot_id is None:
            removed = _split(item, qty)  # kept as a removed line (owner's records), never deleted
            if removed is not item:
                db.add(removed)
            removed.kitchen_status, removed.status_at, removed.voided_by = REMOVED, now, staff_id
            removed.void_reason = (reason or "").strip()[:200] or "Removed before sending to the kitchen"
            removed.subtotal, removed.tax_amount = ZERO, ZERO
            continue
        if not can_void_sent:
            raise HTTPException(status_code=403, detail=f"{item.name} is already in the kitchen. Ask a manager to cancel it.")
        if not (reason or "").strip():
            raise HTTPException(status_code=400, detail="Give a reason for cancelling items the kitchen already has")
        cancelled = _split(item, qty)
        if cancelled is not item:
            db.add(cancelled)
        cancelled.kitchen_status, cancelled.status_at = VOID, now
        cancelled.void_reason, cancelled.voided_by = reason.strip()[:200], staff_id
        cancelled.subtotal, cancelled.tax_amount = ZERO, ZERO
        touched.add(item.kot_id)
        if waste:
            wasted.append(cancelled)
    await db.flush()
    await sync_kot_status(db, touched)
    if wasted:
        tracked = {p for (p,) in (await db.execute(select(Product.id).where(Product.id.in_({w.product_id for w in wasted}),
                                                                             Product.tenant_id == tenant_id, Product.track_stock == True))).all()}
        for w in wasted:
            if w.product_id in tracked:
                db.add(InventoryLog(id=uuid.uuid4(), tenant_id=tenant_id, product_id=w.product_id, location_id=order.location_id,
                                    quantity_change=-w.quantity, reason="wastage", order_id=order.id,
                                    note=f"Cancelled from bill {order.code}: {w.void_reason}", created_at=now))
    warning = await _reprice(db, tenant_id, order)
    await db.flush()
    return await load_order(db, tenant_id, order.id), warning

async def comp_items(db: AsyncSession, tenant_id: str, order_id, lines: list[tuple], reason: str) -> Order:
    """On the house: the line costs nothing; its normal value is kept for reports."""
    order = await load_order(db, tenant_id, order_id)
    _open(order)
    if order.payments:
        raise HTTPException(status_code=409, detail="Items can't change after a payment was taken")
    if not (reason or "").strip():
        raise HTTPException(status_code=400, detail="Say why it's on the house (shown in reports)")
    for item_id, quantity in lines:
        item = _find(order, item_id)
        if is_void(item) or _is_free_line(item) or item.comp_reason:
            raise HTTPException(status_code=409, detail=f"{item.name} is already free or cancelled")
        line = _split(item, quantity or item.quantity)
        if line is not item:
            db.add(line)
        line.comp_value = money(Decimal(line.unit_price) * line.quantity)
        line.comp_reason, line.unit_price = reason.strip()[:200], ZERO
    await _reprice(db, tenant_id, order)
    await db.flush()
    return await load_order(db, tenant_id, order.id)

async def _new_bill_like(db: AsyncSession, tenant_id: str, source: Order, label: str | None, user_id) -> Order:
    bill_id = uuid.uuid4()
    bill = Order(id=bill_id, tenant_id=tenant_id, location_id=source.location_id, table_id=source.table_id, code=order_code(bill_id),
                 token_no=await counters.next_token_no(db, tenant_id), type=source.type, channel=source.channel, status="open",
                 payment_status="unpaid", total_amount=ZERO, created_by=user_id, waiter_id=source.waiter_id,
                 created_at=datetime.utcnow(), bill_type=source.bill_type, supply_type=source.supply_type,
                 bill_label=(label or "").strip() or None, brand_id=source.brand_id)
    db.add(bill)
    await db.flush()
    if source.table_id:
        await _claim_table(db, tenant_id, source.table_id, bill, allow_shared=True)
    return bill

async def move_items(db: AsyncSession, tenant_id: str, order_id, lines: list[tuple], target_order_id=None, new_bill_label: str | None = None,
                     user_id=None) -> tuple[Order, Order]:
    """Split a bill: move whole lines or part of a line to another open bill (or a new bill on the same table)."""
    source = await load_order(db, tenant_id, order_id)
    _open(source)
    if source.payments:
        raise HTTPException(status_code=409, detail="This bill already has a payment; items can't move off it")
    if target_order_id and str(target_order_id) == str(source.id):
        raise HTTPException(status_code=400, detail="Choose a different bill")
    if target_order_id:
        target = await load_order(db, tenant_id, target_order_id)
        _open(target)
        if target.payments:
            raise HTTPException(status_code=409, detail="The other bill already has a payment")
    else:
        target = await _new_bill_like(db, tenant_id, source, new_bill_label, user_id)
    moved = 0
    for item_id, quantity in lines:
        item = _find(source, item_id)
        if is_void(item) or _is_free_line(item):
            raise HTTPException(status_code=400, detail=f"{item.name} can't be moved")
        line = _split(item, quantity or item.quantity)
        if line is not item:
            db.add(line)
        line.order_id = target.id
        moved += 1
    if not moved:
        raise HTTPException(status_code=400, detail="Choose the items to move")
    await db.flush()
    source = await load_order(db, tenant_id, source.id)
    if not [i for i in source.items if not is_void(i) and not _is_free_line(i)]:
        await _close_as_merged(db, source, target)
    else:
        await _reprice(db, tenant_id, source)
    await _reprice(db, tenant_id, target)
    await db.flush()
    return await load_order(db, tenant_id, source.id), await load_order(db, tenant_id, target.id)

async def _close_as_merged(db: AsyncSession, source: Order, target: Order) -> None:
    """A bill with nothing left closes as merged (kept for the record, never counted as a sale or a cancellation)."""
    for item in list(source.items):
        if _is_free_line(item):
            await db.delete(item)
        elif is_void(item):
            item.order_id = target.id  # the cancelled lines' history goes with the items
    source.status = "merged"
    source.cancel_reason = f"Merged into bill {target.bill_label or target.code}"
    source.subtotal = source.discount_amount = source.tax_amount = source.round_off = source.total_amount = ZERO
    source.offer_id, source.offer_name, source.offer_discount = None, None, ZERO
    await db.flush()
    await _release_table(db, source)

async def merge_bills(db: AsyncSession, tenant_id: str, target_id, source_id) -> Order:
    """Join two bills (tables pushed together, one person pays for everyone)."""
    if str(target_id) == str(source_id):
        raise HTTPException(status_code=400, detail="Choose a different bill")
    target = await load_order(db, tenant_id, target_id)
    source = await load_order(db, tenant_id, source_id)
    _open(target)
    _open(source)
    if source.payments or target.payments:
        raise HTTPException(status_code=409, detail="Bills with payments can't be merged")
    for item in list(source.items):
        if not _is_free_line(item):
            item.order_id = target.id
    if not target.customer_id and source.customer_id:
        target.customer_id, target.customer_name, target.customer_phone = source.customer_id, source.customer_name, source.customer_phone
    target.guests = (target.guests or 0) + (source.guests or 0) or None
    await db.flush()
    source = await load_order(db, tenant_id, source.id)
    await _close_as_merged(db, source, target)
    await _reprice(db, tenant_id, target)
    await db.flush()
    return await load_order(db, tenant_id, target.id)
