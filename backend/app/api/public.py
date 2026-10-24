"""Customer-facing endpoints (no login): QR table menu, online store menu, and placing orders.

Orders placed here arrive as status "placed" in the shop's Online Orders inbox (unless the channel auto-accepts).

Table QR ordering: the customer scans the code on the table, orders, and pays at the counter or by UPI (as the owner allows,
Settings → QR table ordering). Each customer (by phone number) gets their own bill on the table, so two parties at one
table never end up on each other's bill; ordering again adds to their bill as a new kitchen ticket. UPI uses the shop's
own UPI ID (no payment gateway): the customer taps "I've paid" and staff confirm it against their UPI app.
"""
import uuid
from typing import List, Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from app.core.rate_limit import client_ip, rate_limit
from app.core.tenant import get_public_tenant_db
from app.models import Product, ProductCategory, TableEntity
from app.schemas.billing import OrderCreate, OrderItemIn, PHONE_PATTERN
from app.services import order_service
from app.services.settings_service import get_settings, get_channel
from app.services import channel_menu
from decimal import Decimal

router = APIRouter(prefix="/public", tags=["Public"])

class PublicOrder(BaseModel):
    id: uuid.UUID | None = None
    source: Literal["QR", "ONLINE"] = "ONLINE"
    order_type: Literal["DINE_IN", "TAKEAWAY", "DELIVERY"] = "TAKEAWAY"
    table_id: uuid.UUID | None = None
    customer_name: str = Field(min_length=1, max_length=80)
    customer_phone: str = Field(pattern=PHONE_PATTERN)
    delivery_address: str | None = Field(None, max_length=500)
    notes: str | None = Field(None, max_length=300)
    items: List[OrderItemIn] = Field(min_length=1, max_length=50)
    payment: Literal["counter", "upi"] = "counter"  # how the customer will pay (QR table orders)

def _payment_options(settings) -> dict:
    mode = settings.qr_payment_mode or "both"
    upi = bool(settings.upi_id) and mode in ("upi", "both")
    return {"counter": mode in ("counter", "both") or not upi, "upi": upi, "upi_id": settings.upi_id if upi else None,
            "payee_name": settings.business_name}

def _upi_link(settings, amount: float, code: str) -> str | None:
    """upi://pay deep link that opens the customer's UPI app with the amount filled in."""
    from urllib.parse import quote
    if not settings.upi_id:
        return None
    return (f"upi://pay?pa={quote(settings.upi_id)}&pn={quote(settings.business_name or 'Shop')}&am={amount:.2f}"
            f"&cu=INR&tn={quote('Bill ' + code)}")

@router.get("/{tenant_id}/menu")
async def public_menu(tenant_id: uuid.UUID, request: Request, channel: str = Query("ONLINE", pattern="^(ONLINE|QR)$"), db: AsyncSession = Depends(get_public_tenant_db)):
    await rate_limit(request, requests=600, window=60)  # a full restaurant browsing the menu on the shop Wi-Fi
    settings = await get_settings(db, str(tenant_id))
    online = await get_channel(db, str(tenant_id), channel)
    adjust = Decimal(online.price_adjust_pct or 0) if online else Decimal(0)
    categories = (await db.execute(select(ProductCategory).where(ProductCategory.tenant_id == tenant_id, ProductCategory.is_active == True)
                                   .order_by(ProductCategory.sort_order, ProductCategory.name))).scalars().all()
    products = (await db.execute(select(Product).options(selectinload(Product.variants))
                                 .where(Product.tenant_id == tenant_id, Product.is_active == True)
                                 .order_by(Product.sort_order, Product.name))).scalars().all()
    products = [p for p in products if channel_menu.available_on(p, channel)]
    await db.commit()
    return {
        "business": {"name": settings.business_name, "address": settings.address, "phone": settings.phone,
                     "currency_symbol": settings.currency_symbol, "prices_include_tax": settings.prices_include_tax,
                     "fssai": settings.fssai},
        "ordering": {"store": settings.store_enabled, "qr": settings.qr_ordering_enabled, "qr_payment": _payment_options(settings)},
        "categories": [{"id": str(c.id), "name": c.name} for c in categories],
        "products": [{
            "id": str(p.id), "name": p.name, "description": p.description, "price": float(channel_menu.unit_price(p, channel, adjust)),
            "category_id": str(p.category_id) if p.category_id else None, "is_veg": p.is_veg,
            "variants": [{"id": str(v.id), "name": v.variant_name, "price": float(channel_menu.unit_price(p, channel, adjust, v.price_modifier))}
                         for v in p.variants if v.is_active],
        } for p in products],
    }

@router.get("/{tenant_id}/tables/{table_id}")
async def public_table(tenant_id: uuid.UUID, table_id: uuid.UUID, db: AsyncSession = Depends(get_public_tenant_db)):
    table = (await db.execute(select(TableEntity).where(TableEntity.id == table_id, TableEntity.tenant_id == tenant_id,
                                                        TableEntity.is_active == True))).scalars().first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    return {"id": str(table.id), "table_number": table.table_number}

@router.post("/{tenant_id}/orders")
async def place_order(tenant_id: uuid.UUID, data: PublicOrder, request: Request, db: AsyncSession = Depends(get_public_tenant_db)):
    # Customers at one restaurant share its Wi-Fi IP: limit per customer (phone) per shop, with a high per-IP ceiling
    await rate_limit(request, requests=10, window=300, key=f"public-order:{tenant_id}:{data.customer_phone.replace(' ', '')}")
    await rate_limit(request, requests=300, window=300, key=f"public-order-ip:{tenant_id}:{client_ip(request)}")
    settings = await get_settings(db, str(tenant_id))
    if data.source == "QR" and not settings.qr_ordering_enabled:
        raise HTTPException(status_code=403, detail="Table ordering is not available right now")
    if data.source == "ONLINE" and not settings.store_enabled:
        raise HTTPException(status_code=403, detail="Online ordering is not available right now")
    if data.source == "QR" and not data.table_id:
        raise HTTPException(status_code=400, detail="Scan the QR code on your table to order")
    if data.order_type == "DELIVERY" and not data.delivery_address:
        raise HTTPException(status_code=400, detail="Delivery address is required")
    options = _payment_options(settings)
    if data.source == "QR" and not options.get(data.payment):
        raise HTTPException(status_code=400, detail="This payment option isn't available here")
    order_in = OrderCreate(
        id=data.id, order_type="DINE_IN" if data.source == "QR" else data.order_type, channel=data.source,
        customer_name=data.customer_name, customer_phone=data.customer_phone, delivery_address=data.delivery_address,
        notes=data.notes, items=data.items, send_to_kitchen=True,
    )
    if data.source == "QR":
        table = (await db.execute(select(TableEntity).where(TableEntity.id == data.table_id, TableEntity.tenant_id == tenant_id,
                                                            TableEntity.is_active == True))).scalars().first()
        if not table:
            raise HTTPException(status_code=404, detail="Table not found")
        # Ordering again adds to *this customer's* bill on the table (a new kitchen ticket); other parties keep theirs
        phone = data.customer_phone.replace(" ", "")
        mine = next((o for o in await order_service.open_bills_on_table(db, str(tenant_id), table.id)
                     if (o.customer_phone or "").replace(" ", "") == phone and o.channel == "QR"), None)
        if mine is not None:
            if mine.payment_claim:
                raise HTTPException(status_code=409, detail="Your payment is being confirmed. Ask the staff to add more items.")
            # The request id makes "Add to my bill" safe to retry after a lost response (no doubled items)
            if data.id and not await _first_time(f"public-add:{tenant_id}:{data.id}"):
                return _public_order(await order_service.load_order(db, str(tenant_id), mine.id), settings, data.payment, table)
            order = await order_service.add_items(db, str(tenant_id), mine.id, data.items, send_to_kitchen=mine.status == "open")
            order.notes = _with_payment_note(order.notes, data.payment)
            await db.commit()
            return _public_order(order, settings, data.payment, table)
        order_in.table_id = data.table_id
        order_in.new_bill = True
        order_in.bill_label = data.customer_name.strip().split(" ")[0][:20]
        order_in.notes = _with_payment_note(data.notes, data.payment)
    order, _ = await order_service.create_order(db, str(tenant_id), order_in, public=True)
    await db.commit()
    return _public_order(order, settings, data.payment, table if data.source == "QR" else None)

PAY_NOTES = ("Will pay by UPI", "Will pay at the counter")

def _with_payment_note(notes: str | None, payment: str) -> str:
    """Keep exactly one up-to-date "how will they pay" line for staff."""
    lines = [line for line in (notes or "").split("\n") if line.strip() and line.strip() not in PAY_NOTES]
    return "\n".join(lines + [PAY_NOTES[0] if payment == "upi" else PAY_NOTES[1]])

async def _first_time(key: str) -> bool:
    from app.core.tenant import get_redis_client
    try:
        return bool(await (await get_redis_client()).set(key, "1", nx=True, ex=24 * 3600))
    except Exception:
        return True  # Redis down: accept (a rare duplicate is better than refusing an order)

def _public_order(order, settings, payment: str | None = None, table=None) -> dict:
    paid = sum(float(p.amount) for p in order.payments)
    due = max(0.0, float(order.total_amount) - paid)
    return {"id": str(order.id), "code": order.code, "status": order.status, "payment_status": order.payment_status,
            "total_amount": float(order.total_amount), "balance_due": due, "token_no": order.token_no, "bill_label": order.bill_label,
            "payment_claim": order.payment_claim, "payment_options": _payment_options(settings),
            "upi_link": _upi_link(settings, due, order.code) if due > 0 and _payment_options(settings)["upi"] else None,
            "items": [{"name": i.name, "variant_name": i.variant_name, "quantity": i.quantity, "price": float(i.unit_price),
                       "line_total": float(i.subtotal), "status": i.kitchen_status}
                      for i in order.items if i.kitchen_status not in ("void", "removed")],
            "subtotal": float(order.subtotal or 0), "tax_amount": float(order.tax_amount or 0),
            "discount_amount": float(order.discount_amount or 0), "round_off": float(order.round_off or 0),
            "table_label": table.table_number if table is not None else None}

class PaymentClaim(BaseModel):
    reference: str | None = Field(None, max_length=40)  # UPI transaction id, if the customer has it

@router.post("/{tenant_id}/orders/{order_id}/payment-claim")
async def claim_payment(tenant_id: uuid.UUID, order_id: uuid.UUID, data: PaymentClaim, request: Request,
                        db: AsyncSession = Depends(get_public_tenant_db)):
    """The customer says they paid by UPI; staff confirm it against their UPI app before the bill closes."""
    await rate_limit(request, requests=10, window=300)
    from datetime import datetime
    settings = await get_settings(db, str(tenant_id))
    if not _payment_options(settings)["upi"]:
        raise HTTPException(status_code=400, detail="UPI payment isn't available here")
    order = await order_service.load_order(db, str(tenant_id), order_id)
    if order.status not in order_service.OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="This bill is already closed")
    due = float(order.total_amount) - sum(float(p.amount) for p in order.payments)
    if due <= 0:
        raise HTTPException(status_code=409, detail="Nothing left to pay")
    order.payment_claim = {"method": "UPI", "amount": round(due, 2), "reference": (data.reference or "").strip() or None,
                           "at": datetime.utcnow().isoformat() + "Z"}
    await db.commit()
    return _public_order(await order_service.load_order(db, str(tenant_id), order_id), settings)

@router.get("/{tenant_id}/orders/{order_id}")
async def order_status(tenant_id: uuid.UUID, order_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_public_tenant_db)):
    """Let a customer track their own order (the unguessable order id acts as the capability)."""
    await rate_limit(request, requests=120, window=60)
    order = await order_service.load_order(db, str(tenant_id), order_id)
    return _public_order(order, await get_settings(db, str(tenant_id)))
