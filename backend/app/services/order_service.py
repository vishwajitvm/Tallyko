"""Order lifecycle: create (idempotent, offline-safe), add/remove items, offers, pay, accept, cancel.

Statuses: placed (public/aggregator order awaiting acceptance) -> open (running, unpaid) -> completed | cancelled | merged.
Kitchen progress lives on each line (pending -> preparing -> ready -> served, or void); a KOT's status follows its lines.
A table can hold several open bills (shared tables, separate cheques); see floor_service for split / merge / void.

Pricing pipeline (`_price`): catalog price → channel mark-up → GST class in effect → offer → manual discount →
GST on the discounted value → round to the rupee. Every bill line stores its own GST snapshot.
"""
import logging
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from app.models import (Order, OrderItem, Payment, Product, KOT, TableEntity, Customer, InventoryLog, Brand, BusinessSettings,
                        Offer, OfferRedemption, TenantUser)
from app.schemas.billing import OrderCreate, OrderItemIn, PaymentIn, DiscountIn
from app.services import counters
from app.services import offers as offer_engine
from app.services.pricing import PricedLine, price_order, money, ZERO
from app.services.settings_service import get_settings, get_channel, get_default_location, AGGREGATOR_CHANNELS
from app.services.tax import TaxResolver, component_amounts
from app.services import channel_menu

logger = logging.getLogger("tallyko")

OPEN_STATUSES = ("placed", "open")
FREE_NOTE = "Free — "  # prefix on lines added by a free-item offer
VOID = "void"  # cancelled after the kitchen got it: shown struck out to staff and the kitchen
REMOVED = "removed"  # taken off before it reached the kitchen: kept for the owner's records, hidden from staff
GONE = (VOID, REMOVED)

def is_void(row: OrderItem) -> bool:
    return row.kitchen_status in GONE

def billable(items) -> list:
    """Lines that count on the bill (voided lines stay on the order for the record but are never charged)."""
    return [i for i in items if not is_void(i)]

def order_code(order_id: uuid.UUID) -> str:
    """Short, printable bill code derived from the order id, so offline devices can print it."""
    return order_id.hex[:10].upper()

async def load_order(db: AsyncSession, tenant_id: str, order_id) -> Order:
    result = await db.execute(
        select(Order)
        .options(selectinload(Order.items), selectinload(Order.payments))
        .where(Order.id == order_id, Order.tenant_id == tenant_id)
        .execution_options(populate_existing=True)
    )
    order = result.scalars().first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order

async def _load_products(db: AsyncSession, tenant_id: str, ids) -> dict:
    ids = set(ids)
    if not ids:
        return {}
    result = await db.execute(select(Product).options(selectinload(Product.variants))
                              .where(Product.id.in_(ids), Product.tenant_id == tenant_id))
    return {p.id: p for p in result.scalars().all()}

async def _sellable_products(db: AsyncSession, tenant_id: str, items: list[OrderItemIn], channel: str | None = None) -> dict:
    products = await _load_products(db, tenant_id, {i.product_id for i in items})
    if any(i.product_id not in products or not products[i.product_id].is_active for i in items):
        raise HTTPException(status_code=404, detail="Some items are no longer available. Refresh the menu and try again.")
    channel_menu.require_available(products, items, channel)
    return products

def _build_item_rows(order: Order, items: list[OrderItemIn], products: dict, taxes: TaxResolver, price_adjust_pct: Decimal) -> list[OrderItem]:
    """Prices come from the menu for the order's channel (per-item channel price, else the channel's mark-up)."""
    rows = []
    for item in items:
        product = products[item.product_id]
        modifier = Decimal(0)
        variant_name = None
        if item.variant_id:
            variant = next((v for v in product.variants if v.id == item.variant_id and v.is_active), None)
            if variant is None:
                raise HTTPException(status_code=404, detail=f"Option not found for {product.name}")
            modifier = Decimal(variant.price_modifier)
            variant_name = variant.variant_name
        unit = channel_menu.unit_price(product, order.channel, price_adjust_pct, modifier)
        rule = taxes.for_product(product)
        rows.append(OrderItem(
            id=uuid.uuid4(), order_id=order.id, product_id=product.id, variant_id=item.variant_id,
            name=product.name, variant_name=variant_name, quantity=item.quantity, unit_price=money(unit),
            tax_rate=rule.total_rate, tax_amount=ZERO, tax_components=[{"name": n, "rate": r} for n, r in rule.components],
            hsn_sac=rule.hsn_sac, subtotal=ZERO, notes=item.notes, created_at=datetime.utcnow(),
        ))
    return rows

def _discount_parts(discount: DiscountIn | None) -> tuple[Decimal, Decimal]:
    if not discount:
        return ZERO, ZERO
    value = Decimal(str(discount.value))
    return (value, ZERO) if discount.type == "flat" else (ZERO, value)

async def _redeem_value(db: AsyncSession, order: Order, settings: BusinessSettings, points: int) -> Decimal:
    if not points:
        return ZERO
    if not settings.loyalty_enabled:
        raise HTTPException(status_code=400, detail="Loyalty points are turned off in settings")
    if not order.customer_id:
        raise HTTPException(status_code=400, detail="Add a customer to redeem points")
    customer = await db.get(Customer, order.customer_id)
    if customer is None or customer.points < points:
        raise HTTPException(status_code=400, detail="Customer does not have enough points")
    return money(points * Decimal(settings.loyalty_point_value))

def _is_free_line(row: OrderItem) -> bool:
    return Decimal(row.unit_price or 0) == 0 and (row.notes or "").startswith(FREE_NOTE)

async def _price(db: AsyncSession, tenant_id: str, order: Order, items: list[OrderItem], settings: BusinessSettings, *,
                 flat: Decimal, percent: Decimal, offer_mode: str = "keep", offer_id=None, offer_code: str | None = None,
                 strict_offer: bool = False) -> tuple[list[OrderItem], str | None]:
    """Price `items` onto `order`. offer_mode: keep (re-check current offer) · set (offer_id/offer_code) · auto · none.
    Returns (items incl. any free-item line, warning for staff)."""
    warning = None
    items = billable(items)
    paid_items = [i for i in items if not _is_free_line(i)]
    for row in [i for i in items if _is_free_line(i)]:
        if row in db:  # previously applied free item: recomputed below
            await db.delete(row)

    # First pass without discounts gives each line's pre-tax value for the offer rules
    probe = [PricedLine(key=i, unit_price=Decimal(i.unit_price), quantity=i.quantity, tax_rate=Decimal(i.tax_rate)) for i in paid_items]
    price_order(probe, settings.prices_include_tax)
    products = await _load_products(db, tenant_id, {i.product_id for i in paid_items})
    lines = [offer_engine.OfferLine(index=idx, product_id=str(l.key.product_id),
                                    category_id=str(products[l.key.product_id].category_id) if products.get(l.key.product_id) and products[l.key.product_id].category_id else None,
                                    quantity=l.quantity, taxable=l.taxable, gross=l.gross) for idx, l in enumerate(probe)]

    chosen: Offer | None = None
    result: offer_engine.OfferResult | None = None
    if offer_mode != "none":
        candidates = await offer_engine.active_offers(db, tenant_id)
        if offer_mode == "set" and offer_code and not offer_id:
            chosen = next((o for o in candidates if o.code and o.code.upper() == offer_code.strip().upper()), None)
            if chosen is None:
                raise HTTPException(status_code=404, detail="No active offer with this code")
        elif offer_mode == "set":
            chosen = next((o for o in candidates if str(o.id) == str(offer_id)), None)
            if chosen is None:
                raise HTTPException(status_code=404, detail="This offer is not active")
        elif offer_mode == "keep" and order.offer_id:
            chosen = next((o for o in candidates if o.id == order.offer_id), None)
            if chosen is None:
                warning = f"Offer “{order.offer_name}” is no longer active and was removed"
        visits, used = await offer_engine.customer_context(db, tenant_id, order.customer_id, [chosen] if chosen else candidates)
        ctx = offer_engine.OfferContext(lines=lines, channel=order.channel, order_type=order.type,
                                        now_utc=order.created_at or datetime.utcnow(), customer_id=str(order.customer_id) if order.customer_id else None,
                                        customer_visits_in_window=visits, customer_redemptions=used, code=offer_code)
        if chosen is not None:
            result = offer_engine.evaluate(chosen, ctx, staff_selected=True)
            if not result.eligible:
                if strict_offer:
                    raise HTTPException(status_code=400, detail=f"Offer can't be applied: {result.reason}")
                warning = f"Offer “{chosen.name}” removed: {result.reason}"
                chosen, result = None, None
        elif offer_mode == "auto":
            autos = [offer_engine.evaluate(o, ctx) for o in candidates if o.auto_apply]
            result = offer_engine.best_offer(autos)
            chosen = next((o for o in candidates if result and str(o.id) == result.offer_id), None)

    all_items = list(paid_items)
    if result is not None and result.free_product_id:
        free = (await _load_products(db, tenant_id, {uuid.UUID(result.free_product_id)})).get(uuid.UUID(result.free_product_id))
        if free is None or not free.is_active:
            warning = "The free item for this offer is no longer on the menu"
        else:
            all_items.append(OrderItem(id=uuid.uuid4(), order_id=order.id, product_id=free.id, name=free.name,
                                       quantity=result.free_quantity, unit_price=ZERO, tax_rate=ZERO, tax_components=[],
                                       tax_amount=ZERO, subtotal=ZERO, notes=f"{FREE_NOTE}{chosen.name}", created_at=datetime.utcnow()))
            db.add(all_items[-1])

    priced_lines = [PricedLine(key=i, unit_price=Decimal(i.unit_price), quantity=i.quantity, tax_rate=Decimal(i.tax_rate)) for i in all_items]
    priced = price_order(priced_lines, settings.prices_include_tax, discount_flat=flat, discount_percent=percent,
                         line_discounts=result.line_discounts if result else None)
    for line in priced.lines:
        row = line.key
        row.subtotal = line.gross
        row.tax_amount = line.tax
        row.tax_components = component_amounts([(c["name"], c["rate"]) for c in (row.tax_components or [])], line.tax) if line.tax else \
            [{"name": c["name"], "rate": c["rate"], "amount": 0.0} for c in (row.tax_components or [])]
    order.subtotal = priced.subtotal
    order.discount_amount = priced.discount
    order.tax_amount = priced.tax
    order.round_off = priced.round_off
    order.total_amount = priced.total
    order.offer_id = chosen.id if chosen else None
    order.offer_name = chosen.name if chosen else None
    order.offer_discount = money(sum(result.line_discounts.values(), ZERO)) if result else ZERO
    return all_items, warning

async def _create_kot(db: AsyncSession, tenant_id: str, order: Order, rows: list[OrderItem], products: dict) -> KOT | None:
    kitchen_rows = [r for r in rows if products.get(r.product_id) is None or products[r.product_id].print_to_kitchen]
    if not kitchen_rows:
        return None
    kot = KOT(id=uuid.uuid4(), tenant_id=tenant_id, order_id=order.id, status="pending",
              kot_no=await counters.next_kot_no(db, tenant_id), created_at=datetime.utcnow())
    db.add(kot)
    for row in kitchen_rows:
        row.kot_id = kot.id
        row.kitchen_status, row.status_at = "pending", kot.created_at
    return kot

async def _resolve_customer(db: AsyncSession, tenant_id: str, customer_id, name: str | None, phone: str | None) -> Customer | None:
    if customer_id:
        result = await db.execute(select(Customer).where(Customer.id == customer_id, Customer.tenant_id == tenant_id))
        customer = result.scalars().first()
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")
        return customer
    if phone:
        phone = phone.replace(" ", "")
        result = await db.execute(select(Customer).where(Customer.phone == phone, Customer.tenant_id == tenant_id))
        customer = result.scalars().first()
        if customer is None:
            customer = Customer(id=uuid.uuid4(), tenant_id=tenant_id, name=(name or "Guest").strip() or "Guest", phone=phone, points=0)
            db.add(customer)
            await db.flush()
        return customer
    return None

async def _staff_in_business(db: AsyncSession, tenant_id: str, staff_id) -> bool:
    found = await db.execute(select(TenantUser.id).where(TenantUser.id == staff_id, TenantUser.tenant_id == tenant_id, TenantUser.is_active == True))
    return found.first() is not None

async def _is_waiter(db: AsyncSession, tenant_id: str, staff_id) -> bool:
    if not staff_id:
        return False
    role = (await db.execute(select(TenantUser.role).where(TenantUser.id == staff_id, TenantUser.tenant_id == tenant_id))).scalar()
    return role == "waiter"

async def open_bills_on_table(db: AsyncSession, tenant_id: str, table_id, exclude=None) -> list[Order]:
    query = select(Order).where(Order.tenant_id == tenant_id, Order.table_id == table_id, Order.status.in_(OPEN_STATUSES))
    if exclude is not None:
        query = query.where(Order.id != exclude)
    return (await db.execute(query.order_by(Order.created_at))).scalars().all()

async def _claim_table(db: AsyncSession, tenant_id: str, table_id, order: Order, prefer_assigned: bool = False,
                       allow_shared: bool = False) -> None:
    """`prefer_assigned`: credit the table's waiter even though someone else (cashier, owner) keyed the order in.
    `allow_shared`: the table may already have bills (two parties at one table, separate cheques)."""
    result = await db.execute(select(TableEntity).where(TableEntity.id == table_id, TableEntity.tenant_id == tenant_id).with_for_update())
    table = result.scalars().first()
    if not table or not table.is_active:
        raise HTTPException(status_code=404, detail="Table not found")
    others = await open_bills_on_table(db, tenant_id, table_id, exclude=order.id)
    if others and not allow_shared:
        raise HTTPException(status_code=409, detail=f"Table {table.table_number} already has a running bill. "
                                                    "Add the items to it, or start a separate bill for this table.")
    if not order.bill_label and others:
        order.bill_label = f"Bill {len(others) + 1}"
    table.status = "occupied"
    if not others:
        table.current_order_id = order.id
    if table.assigned_staff_id and (not order.waiter_id or prefer_assigned):
        order.waiter_id = table.assigned_staff_id

async def _release_table(db: AsyncSession, order: Order) -> None:
    """The table stays occupied while any other bill on it is open."""
    if not order.table_id:
        return
    table = await db.get(TableEntity, order.table_id)
    if table is None:
        return
    await db.flush()
    others = await open_bills_on_table(db, str(order.tenant_id), order.table_id, exclude=order.id)
    if others:
        table.status, table.current_order_id = "occupied", others[0].id
    else:
        table.status, table.current_order_id = "free", None

async def create_order(db: AsyncSession, tenant_id: str, data: OrderCreate, user_id: str | None = None,
                       public: bool = False, staff_id: str | None = None) -> tuple[Order, bool]:
    """Returns (order, created). Re-sending the same `id` returns the existing order unchanged."""
    if data.id:
        existing = await db.execute(select(Order.id).where(Order.id == data.id, Order.tenant_id == tenant_id))
        if existing.first():
            return await load_order(db, tenant_id, data.id), False

    settings = await get_settings(db, tenant_id)
    channel = await get_channel(db, tenant_id, data.channel)
    if channel is None:
        raise HTTPException(status_code=400, detail=f"Unknown sales channel {data.channel}")
    if public and not channel.enabled:
        raise HTTPException(status_code=403, detail="Online ordering is not available right now")

    if data.external_order_id:
        dup = await db.execute(select(Order).where(Order.tenant_id == tenant_id, Order.channel == channel.code,
                                                   Order.external_order_id == data.external_order_id))
        dup_order = dup.scalars().first()
        if dup_order:
            return await load_order(db, tenant_id, dup_order.id), False

    if data.brand_id:
        brand = await db.execute(select(Brand.id).where(Brand.id == data.brand_id, Brand.tenant_id == tenant_id))
        if brand.first() is None:
            raise HTTPException(status_code=404, detail="Brand not found")
    waiter_id = data.waiter_id or staff_id
    if data.waiter_id and not await _staff_in_business(db, tenant_id, data.waiter_id):
        raise HTTPException(status_code=404, detail="Staff member not found")

    products = await _sellable_products(db, tenant_id, data.items, channel.code)
    location = await get_default_location(db, tenant_id)
    order_id = data.id or uuid.uuid4()
    now = datetime.utcnow()
    created_at = now
    if data.created_at:
        ts = data.created_at.replace(tzinfo=None) if data.created_at.tzinfo is None else \
            (data.created_at - data.created_at.utcoffset()).replace(tzinfo=None)
        # Offline orders keep their real time, but never in the future or absurdly old
        created_at = min(ts, now) if ts > now - timedelta(days=30) else now

    customer = await _resolve_customer(db, tenant_id, data.customer_id, data.customer_name, data.customer_phone)
    taxes = await TaxResolver.load(db, tenant_id, settings, at=created_at, inter_state=data.supply_type == "inter")
    order = Order(
        id=order_id, tenant_id=tenant_id, location_id=location.id, table_id=data.table_id,
        customer_id=customer.id if customer else None, brand_id=data.brand_id, code=order_code(order_id),
        token_no=await counters.next_token_no(db, tenant_id), type=data.order_type, channel=channel.code,
        external_order_id=data.external_order_id,
        status=("open" if channel.auto_accept else "placed") if public else "open",
        payment_status="unpaid",
        customer_name=data.customer_name or (customer.name if customer else None),
        customer_phone=(data.customer_phone or (customer.phone if customer else None)),
        delivery_address=data.delivery_address, notes=data.notes, total_amount=ZERO,
        bill_label=(data.bill_label or "").strip() or None, guests=data.guests,
        created_by=user_id, waiter_id=waiter_id, created_at=created_at,
        bill_type="tax_invoice" if taxes.charges_tax else "bill_of_supply", supply_type=data.supply_type,
    )
    db.add(order)
    await db.flush()

    rows = _build_item_rows(order, data.items, products, taxes, Decimal(channel.price_adjust_pct or 0))
    db.add_all(rows)
    flat, percent = _discount_parts(data.discount)
    flat += await _redeem_value(db, order, settings, data.redeem_points)
    order.loyalty_points_redeemed = data.redeem_points
    offer_mode = "set" if (data.offer_id or data.offer_code) else ("auto" if data.auto_offers and not public else "none")
    if public and data.offer_code:
        offer_mode = "set"
    rows, _ = await _price(db, tenant_id, order, rows, settings, flat=flat, percent=percent, offer_mode=offer_mode,
                           offer_id=data.offer_id, offer_code=data.offer_code, strict_offer=offer_mode == "set")
    order.commission_amount = money(order.total_amount * Decimal(channel.commission_pct or 0) / 100)

    if data.table_id:
        await _claim_table(db, tenant_id, data.table_id, order, allow_shared=data.new_bill,
                           prefer_assigned=data.waiter_id is None and not await _is_waiter(db, tenant_id, staff_id))
    if data.send_to_kitchen and order.status == "open":
        await _create_kot(db, tenant_id, order, rows, products)

    await db.flush()
    order = await load_order(db, tenant_id, order.id)
    if data.payments:
        await _apply_payments(db, tenant_id, order, data.payments, settings, staff_id)
        order = await load_order(db, tenant_id, order.id)
    logger.info(f"[Billing] Order {order.code} created ({order.channel}, {order.status}) total {order.total_amount}",
                extra={"tenant_id": tenant_id})
    return order, True

async def add_items(db: AsyncSession, tenant_id: str, order_id, items: list[OrderItemIn], send_to_kitchen: bool) -> Order:
    order = await load_order(db, tenant_id, order_id)
    if order.status not in OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="This order is already closed")
    settings = await get_settings(db, tenant_id)
    channel = await get_channel(db, tenant_id, order.channel)
    products = await _sellable_products(db, tenant_id, items, order.channel)
    taxes = await TaxResolver.load(db, tenant_id, settings, inter_state=order.supply_type == "inter")
    rows = _build_item_rows(order, items, products, taxes, Decimal(channel.price_adjust_pct or 0) if channel else ZERO)
    db.add_all(rows)
    await _price(db, tenant_id, order, list(order.items) + rows, settings, flat=_manual_discount(order), percent=ZERO)
    if send_to_kitchen and order.status == "open":
        await _create_kot(db, tenant_id, order, rows, products)
    await db.flush()
    return await load_order(db, tenant_id, order.id)

def _manual_discount(order: Order) -> Decimal:
    """The non-offer part of the current discount (kept when items change)."""
    return max(ZERO, Decimal(order.discount_amount or 0) - _offer_discount(order))

def _offer_discount(order: Order) -> Decimal:
    return Decimal(order.offer_discount or 0)

async def remove_item(db: AsyncSession, tenant_id: str, order_id, item_id, can_void_sent: bool, staff_id=None) -> Order:
    """Nothing is deleted: the line stays on the order (removed / cancelled) for the owner's records and is never charged."""
    order = await load_order(db, tenant_id, order_id)
    if order.status not in OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="This order is already closed")
    item = next((i for i in order.items if i.id == item_id and not is_void(i)), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found on this order")
    if item.kot_id and not can_void_sent:
        raise HTTPException(status_code=403, detail="Item already sent to kitchen. Ask a manager to void it.")
    item.kitchen_status = VOID if item.kot_id else REMOVED
    item.void_reason = item.void_reason or ("Cancelled" if item.kot_id else "Removed before sending to the kitchen")
    item.voided_by, item.status_at = staff_id, datetime.utcnow()
    item.subtotal, item.tax_amount = ZERO, ZERO
    remaining = [i for i in order.items if i.id != item_id]
    settings = await get_settings(db, tenant_id)
    await _price(db, tenant_id, order, remaining, settings, flat=_manual_discount(order), percent=ZERO)
    await db.flush()
    return await load_order(db, tenant_id, order.id)

async def change_offer(db: AsyncSession, tenant_id: str, order_id, offer_id=None, offer_code: str | None = None, remove: bool = False) -> tuple[Order, str | None]:
    order = await load_order(db, tenant_id, order_id)
    if order.status not in OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="This order is already closed")
    if order.payments:
        raise HTTPException(status_code=409, detail="Offers must be applied before the first payment")
    settings = await get_settings(db, tenant_id)
    _, warning = await _price(db, tenant_id, order, list(order.items), settings, flat=_manual_discount(order), percent=ZERO,
                              offer_mode="none" if remove else "set", offer_id=offer_id, offer_code=offer_code, strict_offer=True)
    await db.flush()
    return await load_order(db, tenant_id, order.id), warning

async def _apply_payments(db: AsyncSession, tenant_id: str, order: Order, payments: list[PaymentIn], settings: BusinessSettings,
                          staff_id: str | None = None) -> Decimal:
    already = sum((Decimal(p.amount) for p in order.payments), ZERO)
    incoming = sum((money(p.amount) for p in payments), ZERO)
    due = Decimal(order.total_amount) - already
    has_cash = any(p.method == "CASH" for p in payments)
    change = ZERO
    if incoming > due:
        cash_given = sum((money(p.amount) for p in payments if p.method == "CASH"), ZERO)
        if not has_cash or incoming - due > cash_given:
            raise HTTPException(status_code=400, detail="Payment is more than the amount due")
        change = incoming - due
    remaining_change = change
    for p in payments:
        amount = money(p.amount)
        if p.method == "CASH" and remaining_change:
            # Record cash net of change returned, so the cash drawer report matches reality
            deduct = min(amount, remaining_change)
            amount -= deduct
            remaining_change -= deduct
        if amount > 0:
            db.add(Payment(id=uuid.uuid4(), order_id=order.id, method=p.method, amount=amount, reference=p.reference,
                           created_at=datetime.utcnow()))
    paid = already + incoming - change
    order.payment_status = "paid" if paid >= Decimal(order.total_amount) else ("partial" if paid > 0 else "unpaid")
    if order.payment_status == "paid" and order.status in OPEN_STATUSES:
        order.settled_by = staff_id or order.settled_by
        await _finalize(db, tenant_id, order, settings)
    await db.flush()
    return change

async def pay(db: AsyncSession, tenant_id: str, order_id, payments: list[PaymentIn], discount: DiscountIn | None,
              redeem_points: int | None, offer_id=None, remove_offer: bool = False, staff_id: str | None = None) -> tuple[Order, Decimal]:
    order = await load_order(db, tenant_id, order_id)
    if order.status == "completed":
        raise HTTPException(status_code=409, detail="This bill is already paid")
    if order.status == "cancelled":
        raise HTTPException(status_code=409, detail="This order was cancelled")
    settings = await get_settings(db, tenant_id)
    if discount is not None or redeem_points is not None or offer_id or remove_offer:
        if order.payments:
            raise HTTPException(status_code=409, detail="Discounts and offers must be applied before the first payment")
        # Only what was sent changes: an offer switch keeps the manual discount and redeemed points
        old_points_value = money((order.loyalty_points_redeemed or 0) * Decimal(settings.loyalty_point_value or 0))
        if discount is not None:
            flat, percent = _discount_parts(discount)
        else:
            flat, percent = max(ZERO, _manual_discount(order) - old_points_value), ZERO
        points = redeem_points if redeem_points is not None else (order.loyalty_points_redeemed or 0)
        flat += await _redeem_value(db, order, settings, points)
        order.loyalty_points_redeemed = points
        mode = "none" if remove_offer else ("set" if offer_id else "keep")
        await _price(db, tenant_id, order, list(order.items), settings, flat=flat, percent=percent, offer_mode=mode,
                     offer_id=offer_id, strict_offer=bool(offer_id))
    if order.status == "placed":
        await accept(db, tenant_id, order.id, reload=False, order=order)
    change = await _apply_payments(db, tenant_id, order, payments, settings, staff_id)
    return await load_order(db, tenant_id, order.id), change

async def accept(db: AsyncSession, tenant_id: str, order_id, reload: bool = True, order: Order | None = None) -> Order:
    order = order or await load_order(db, tenant_id, order_id)
    if order.status != "placed":
        raise HTTPException(status_code=409, detail="Only new online orders can be accepted")
    order.status = "open"
    pending = [i for i in order.items if i.kot_id is None]
    products = await _load_products(db, tenant_id, {i.product_id for i in pending})
    await _create_kot(db, tenant_id, order, pending, products)
    if order.payment_status == "paid":
        await _finalize(db, tenant_id, order, await get_settings(db, tenant_id))
    await db.flush()
    return await load_order(db, tenant_id, order.id) if reload else order

async def _finalize(db: AsyncSession, tenant_id: str, order: Order, settings: BusinessSettings) -> None:
    order.status = "completed"
    order.completed_at = datetime.utcnow()
    if not order.invoice_no:
        order.invoice_no = await counters.next_invoice_no(db, tenant_id, settings.invoice_prefix or "INV")
    await _release_table(db, order)
    if not order.stock_deducted:
        await _move_stock(db, tenant_id, order, direction=-1, reason="sale")
        order.stock_deducted = True
    if order.offer_id:
        existing = await db.execute(select(OfferRedemption.id).where(OfferRedemption.order_id == order.id))
        if existing.first() is None:
            offer = await db.get(Offer, order.offer_id)
            db.add(OfferRedemption(tenant_id=tenant_id, offer_id=order.offer_id, order_id=order.id, customer_id=order.customer_id,
                                   discount_amount=Decimal(order.discount_amount or 0)))
            if offer:
                offer.uses_count = (offer.uses_count or 0) + 1
    if order.customer_id:
        customer = await db.get(Customer, order.customer_id)
        if customer:
            earned = 0
            if settings.loyalty_enabled:
                earned = int(Decimal(order.total_amount) // 100) * int(settings.loyalty_points_per_100 or 0)
            customer.points = max(0, customer.points - (order.loyalty_points_redeemed or 0) + earned)
            customer.total_spent = Decimal(customer.total_spent or 0) + Decimal(order.total_amount)
            customer.visits = (customer.visits or 0) + 1
            customer.last_visit_at = order.completed_at
            order.loyalty_points_earned = earned
            await _queue_customer_emails(db, tenant_id, order, customer, settings)

async def _queue_customer_emails(db: AsyncSession, tenant_id: str, order: Order, customer: Customer, settings: BusinessSettings) -> None:
    """E-receipt / welcome after a bill, and a reward email when this visit unlocks a loyalty reward."""
    if not customer.email:
        return
    from app.services.access import entitlements
    from app.services.email.service import queue_email
    features = (await entitlements(tenant_id))["features"]
    if "email" not in features:
        return
    first_name = (customer.name or "").split(" ")[0] or "there"
    base = {"customer_name": first_name, "points": customer.points, "visits": customer.visits,
            "bill_no": order.invoice_no or order.code, "bill_total": f"₹{Decimal(order.total_amount):,.2f}",
            "bill_date": (order.completed_at or datetime.utcnow()).strftime("%d %b %Y")}
    await queue_email(db, tenant_id, "welcome" if customer.visits == 1 else "order_receipt", customer.email, base,
                      customer_id=customer.id, order_id=order.id)
    if "loyalty" not in features:
        return
    rewards = (await db.execute(select(Offer).where(Offer.tenant_id == tenant_id, Offer.is_active == True, Offer.kind == "loyalty",
                                                   Offer.notify_email == True, Offer.min_visits.isnot(None)))).scalars().all()
    for reward in rewards:
        query = select(func.count(Order.id)).where(Order.tenant_id == tenant_id, Order.customer_id == customer.id,
                                                   Order.status == "completed")
        if reward.visits_window_days:
            query = query.where(Order.completed_at >= datetime.utcnow() - timedelta(days=reward.visits_window_days))
        visits = int((await db.execute(query)).scalar_one())  # includes this bill (flushed as completed)
        if visits == reward.min_visits:  # exactly reached on this visit → tell them once
            await queue_email(db, tenant_id, "loyalty_reward", customer.email,
                              {**base, "visits": visits, "offer_name": reward.name, "offer_details": offer_engine.describe(reward),
                               "offer_code": reward.code or ""}, customer_id=customer.id, order_id=order.id, offer_id=reward.id)

async def _move_stock(db: AsyncSession, tenant_id: str, order: Order, direction: int, reason: str) -> None:
    ids = {i.product_id for i in order.items}
    if not ids:
        return
    result = await db.execute(select(Product).where(Product.id.in_(ids), Product.tenant_id == tenant_id, Product.track_stock == True))
    tracked = {p.id for p in result.scalars().all()}
    for item in billable(order.items):
        if item.product_id in tracked:
            db.add(InventoryLog(id=uuid.uuid4(), tenant_id=tenant_id, product_id=item.product_id, location_id=order.location_id,
                                quantity_change=direction * item.quantity, reason=reason, order_id=order.id,
                                note=f"Bill {order.invoice_no or order.code}", created_at=datetime.utcnow()))

async def cancel(db: AsyncSession, tenant_id: str, order_id, reason: str) -> Order:
    order = await load_order(db, tenant_id, order_id)
    if order.status == "cancelled":
        return order
    was_completed = order.status == "completed"
    order.status = "cancelled"
    order.cancel_reason = reason
    await _release_table(db, order)
    if order.stock_deducted:
        await _move_stock(db, tenant_id, order, direction=1, reason="return")
        order.stock_deducted = False
    redemption = (await db.execute(select(OfferRedemption).where(OfferRedemption.order_id == order.id))).scalars().first()
    if redemption:
        offer = await db.get(Offer, redemption.offer_id)
        if offer:
            offer.uses_count = max(0, (offer.uses_count or 0) - 1)
        await db.delete(redemption)
    if was_completed and order.customer_id:
        customer = await db.get(Customer, order.customer_id)
        if customer:
            customer.points = max(0, customer.points + (order.loyalty_points_redeemed or 0) - (order.loyalty_points_earned or 0))
            customer.total_spent = max(ZERO, Decimal(customer.total_spent or 0) - Decimal(order.total_amount))
            customer.visits = max(0, (customer.visits or 0) - 1)
    result = await db.execute(select(KOT).where(KOT.order_id == order.id, KOT.tenant_id == tenant_id))
    for kot in result.scalars().all():
        if kot.status != "served":
            kot.status = "cancelled"
    await db.flush()
    logger.info(f"[Billing] Order {order.code} cancelled: {reason}", extra={"tenant_id": tenant_id})
    return await load_order(db, tenant_id, order.id)

async def transfer_table(db: AsyncSession, tenant_id: str, order_id, table_id) -> Order:
    order = await load_order(db, tenant_id, order_id)
    if order.status not in OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="Only running orders can move tables")
    if str(order.table_id) == str(table_id):
        return order
    await _release_table(db, order)
    order.bill_label = None
    await _claim_table(db, tenant_id, table_id, order, allow_shared=True)  # joins any bills already on that table
    order.table_id = table_id
    order.type = "DINE_IN"
    await db.flush()
    return await load_order(db, tenant_id, order.id)

def tax_breakup(items) -> list[dict]:
    """Per GST rate: taxable value and CGST/SGST/IGST amounts, from the bill lines' own snapshots."""
    groups: dict[Decimal, dict] = {}
    for item in billable(items):
        rate = Decimal(item.tax_rate or 0)
        g = groups.setdefault(rate, {"taxable": ZERO, "cgst": ZERO, "sgst": ZERO, "igst": ZERO, "tax": ZERO})
        tax = Decimal(item.tax_amount or 0)
        g["tax"] += tax
        g["taxable"] += money(tax * 100 / rate) if rate else Decimal(item.subtotal or 0)
        components = item.tax_components or []
        if components:
            for c in components:
                key = str(c.get("name", "")).lower()
                if key in ("cgst", "sgst", "igst"):
                    g[key] += Decimal(str(c.get("amount", 0)))
        elif tax:  # lines from before component snapshots: split evenly
            half = money(tax / 2)
            g["cgst"] += half
            g["sgst"] += tax - half
    return [{"rate": float(r), "taxable": float(money(g["taxable"])), "cgst": float(money(g["cgst"])),
             "sgst": float(money(g["sgst"])), "igst": float(money(g["igst"]))} for r, g in sorted(groups.items())]

def serialize_order(order: Order, include_removed: bool = False) -> dict:
    paid = sum((Decimal(p.amount) for p in order.payments), ZERO)
    return {
        "id": str(order.id),
        "code": order.code,
        "invoice_no": order.invoice_no,
        "bill_type": order.bill_type,
        "supply_type": order.supply_type,
        "token_no": order.token_no,
        "type": order.type,
        "channel": order.channel,
        "external_order_id": order.external_order_id,
        "status": order.status,
        "payment_status": order.payment_status,
        "table_id": str(order.table_id) if order.table_id else None,
        "customer_id": str(order.customer_id) if order.customer_id else None,
        "brand_id": str(order.brand_id) if order.brand_id else None,
        "waiter_id": str(order.waiter_id) if order.waiter_id else None,
        "settled_by": str(order.settled_by) if order.settled_by else None,
        "offer_id": str(order.offer_id) if order.offer_id else None,
        "offer_name": order.offer_name,
        "offer_discount": float(order.offer_discount or 0),
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "delivery_address": order.delivery_address,
        "notes": order.notes,
        "subtotal": float(order.subtotal or 0),
        "discount_amount": float(order.discount_amount or 0),
        "tax_amount": float(order.tax_amount or 0),
        "round_off": float(order.round_off or 0),
        "total_amount": float(order.total_amount or 0),
        "paid_amount": float(paid),
        "balance_due": float(max(ZERO, Decimal(order.total_amount or 0) - paid)),
        "commission_amount": float(order.commission_amount or 0),
        "loyalty_points_earned": order.loyalty_points_earned or 0,
        "loyalty_points_redeemed": order.loyalty_points_redeemed or 0,
        "cancel_reason": order.cancel_reason,
        "bill_label": order.bill_label,
        "payment_claim": order.payment_claim,
        "archived": order.archived_at is not None,
        "guests": order.guests,
        "created_at": order.created_at.isoformat() + "Z" if order.created_at else None,
        "completed_at": order.completed_at.isoformat() + "Z" if order.completed_at else None,
        "items": [
            {
                "id": str(i.id), "product_id": str(i.product_id), "variant_id": str(i.variant_id) if i.variant_id else None,
                "name": i.name, "variant_name": i.variant_name, "quantity": i.quantity, "unit_price": float(i.unit_price),
                "tax_rate": float(i.tax_rate or 0), "tax_amount": float(i.tax_amount or 0), "line_total": float(i.subtotal),
                "tax_components": i.tax_components or [], "hsn_sac": i.hsn_sac, "is_free": _is_free_line(i),
                "notes": i.notes, "sent_to_kitchen": i.kot_id is not None, "kot_id": str(i.kot_id) if i.kot_id else None,
                "kitchen_status": i.kitchen_status, "status_at": i.status_at.isoformat() + "Z" if i.status_at else None,
                "is_void": is_void(i), "is_removed": i.kitchen_status == REMOVED, "void_reason": i.void_reason,
                "comp_reason": i.comp_reason, "comp_value": float(i.comp_value) if i.comp_value is not None else None,
            } for i in order.items if include_removed or i.kitchen_status != REMOVED
        ],
        "payments": [
            {"id": str(p.id), "method": p.method, "amount": float(p.amount), "reference": p.reference} for p in order.payments
        ],
        "tax_breakup": tax_breakup(order.items),
    }

def is_aggregator(code: str) -> bool:
    return code in AGGREGATOR_CHANNELS
