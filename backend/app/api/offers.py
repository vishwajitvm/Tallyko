"""Offers & loyalty rewards: create, schedule, switch on/off, evaluate against a cart, announce by email."""
import uuid
from datetime import datetime, time
from decimal import Decimal
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.tenant import get_tenant_db
from app.models import Customer, Offer, OfferRedemption, Product, ProductCategory, ProductVariant
from app.schemas.billing import OrderItemIn, PHONE_PATTERN
from app.services import audit
from app.services import offers as engine
from app.services.access import Access, require
from app.services.email.service import queue_email
from app.services.pricing import PricedLine, price_order
from app.services.settings_service import get_channel, get_settings
from app.services.tax import TaxResolver
from app.services import channel_menu

router = APIRouter(prefix="/offers", tags=["Offers"])

class OfferIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(None, max_length=300)
    code: str | None = Field(None, pattern=r"^$|^[A-Za-z0-9_-]{3,20}$")
    kind: Literal["bill", "items", "loyalty"] = "bill"
    benefit_type: Literal["percent", "flat", "free_item"]
    benefit_value: float = Field(0, ge=0, le=1_000_000)
    max_discount: float | None = Field(None, ge=0, le=1_000_000)
    free_product_id: uuid.UUID | None = None
    free_quantity: int = Field(1, ge=1, le=20)
    min_order_amount: float = Field(0, ge=0, le=1_000_000)
    product_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)
    category_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    min_visits: int | None = Field(None, ge=1, le=1000)
    visits_window_days: int | None = Field(None, ge=1, le=3650)
    channels: list[str] | None = Field(None, max_length=10)
    order_types: list[Literal["DINE_IN", "TAKEAWAY", "DELIVERY", "RETAIL_WALKIN"]] | None = None
    days_of_week: list[int] | None = Field(None, max_length=7)
    start_time: time | None = None
    end_time: time | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    auto_apply: bool = False
    is_active: bool = True
    priority: int = Field(0, ge=0, le=1000)
    max_uses_total: int | None = Field(None, ge=1)
    max_uses_per_customer: int | None = Field(None, ge=1)
    notify_email: bool = False

    @model_validator(mode="after")
    def _rules(self):
        if self.benefit_type == "percent" and not 0 < self.benefit_value <= 100:
            raise ValueError("Percent must be between 1 and 100")
        if self.benefit_type == "flat" and self.benefit_value <= 0:
            raise ValueError("Enter the discount amount")
        if self.benefit_type == "free_item" and not self.free_product_id:
            raise ValueError("Choose the free item")
        if self.kind == "items" and not (self.product_ids or self.category_ids):
            raise ValueError("Choose the items or categories this offer applies to")
        if self.kind == "loyalty" and not self.min_visits:
            raise ValueError("Loyalty rewards need a number of visits")
        if (self.start_time is None) != (self.end_time is None):
            raise ValueError("Set both a start and an end time")
        if self.days_of_week and any(d < 0 or d > 6 for d in self.days_of_week):
            raise ValueError("Days are 0 (Mon) to 6 (Sun)")
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("End date must be after the start date")
        return self

def _naive(dt: datetime | None) -> datetime | None:
    if dt is None or dt.tzinfo is None:
        return dt
    return (dt - dt.utcoffset()).replace(tzinfo=None)

async def _check_refs(db: AsyncSession, tenant_id: str, data: OfferIn) -> None:
    ids = set(data.product_ids) | ({data.free_product_id} if data.free_product_id else set())
    if ids:
        found = {r for (r,) in (await db.execute(select(Product.id).where(Product.id.in_(ids), Product.tenant_id == tenant_id))).all()}
        if ids - found:
            raise HTTPException(status_code=404, detail="Some selected items don't exist")
    if data.category_ids:
        found = {r for (r,) in (await db.execute(select(ProductCategory.id).where(ProductCategory.id.in_(data.category_ids),
                                                                                  ProductCategory.tenant_id == tenant_id))).all()}
        if set(data.category_ids) - found:
            raise HTTPException(status_code=404, detail="Some selected categories don't exist")

def _apply(offer: Offer, data: OfferIn) -> None:
    values = data.model_dump()
    values["code"] = (values["code"] or "").upper() or None
    values["product_ids"] = [str(p) for p in data.product_ids] or None
    values["category_ids"] = [str(c) for c in data.category_ids] or None
    values["channels"] = [c.upper() for c in data.channels] if data.channels else None
    values["starts_at"], values["ends_at"] = _naive(data.starts_at), _naive(data.ends_at)
    for key, value in values.items():
        setattr(offer, key, value)

def serialize_offer(o: Offer, redemptions: int = 0) -> dict:
    now = datetime.utcnow()
    state = "off" if not o.is_active else "scheduled" if o.starts_at and o.starts_at > now else "expired" if o.ends_at and o.ends_at <= now \
        else "used_up" if o.max_uses_total and (o.uses_count or 0) >= o.max_uses_total else "live"
    return {
        "id": str(o.id), "name": o.name, "description": o.description, "code": o.code, "kind": o.kind, "benefit_type": o.benefit_type,
        "benefit_value": float(o.benefit_value or 0), "max_discount": float(o.max_discount) if o.max_discount is not None else None,
        "free_product_id": str(o.free_product_id) if o.free_product_id else None, "free_quantity": o.free_quantity,
        "min_order_amount": float(o.min_order_amount or 0), "product_ids": o.product_ids or [], "category_ids": o.category_ids or [],
        "min_visits": o.min_visits, "visits_window_days": o.visits_window_days, "channels": o.channels, "order_types": o.order_types,
        "days_of_week": o.days_of_week, "start_time": o.start_time.strftime("%H:%M") if o.start_time else None,
        "end_time": o.end_time.strftime("%H:%M") if o.end_time else None,
        "starts_at": o.starts_at.isoformat() + "Z" if o.starts_at else None, "ends_at": o.ends_at.isoformat() + "Z" if o.ends_at else None,
        "auto_apply": o.auto_apply, "is_active": o.is_active, "priority": o.priority, "max_uses_total": o.max_uses_total,
        "max_uses_per_customer": o.max_uses_per_customer, "uses_count": o.uses_count or 0, "notify_email": o.notify_email,
        "summary": engine.describe(o), "state": state, "redemptions": redemptions,
    }

@router.get("")
async def list_offers(include_inactive: bool = True, access: Access = Depends(require("offers.apply", "offers.manage", any_of=True, feature="offers")),
                      db: AsyncSession = Depends(get_tenant_db)):
    query = select(Offer).where(Offer.tenant_id == access.tenant_id)
    if not include_inactive or not access.can("offers.manage"):
        query = query.where(Offer.is_active == True)
    offers = (await db.execute(query.order_by(Offer.is_active.desc(), Offer.priority.desc(), Offer.created_at.desc()))).scalars().all()
    totals = dict((await db.execute(select(OfferRedemption.offer_id, func.count()).where(OfferRedemption.tenant_id == access.tenant_id)
                                    .group_by(OfferRedemption.offer_id))).all())
    return [serialize_offer(o, int(totals.get(o.id, 0))) for o in offers]

@router.post("")
async def create_offer(data: OfferIn, access: Access = Depends(require("offers.manage", feature="offers")), db: AsyncSession = Depends(get_tenant_db)):
    if data.kind == "loyalty" and not access.has("loyalty"):
        raise HTTPException(status_code=403, detail="Loyalty rewards aren't included in your plan")
    await _check_refs(db, access.tenant_id, data)
    offer = Offer(id=uuid.uuid4(), tenant_id=access.tenant_id, created_by=access.user_id)
    _apply(offer, data)
    if offer.code and (await db.execute(select(Offer.id).where(Offer.tenant_id == access.tenant_id, Offer.code == offer.code))).first():
        raise HTTPException(status_code=409, detail="Another offer already uses this code")
    db.add(offer)
    audit.record(db, access, "offer.create", entity_type="offer", entity_id=offer.id, summary=f"{offer.name}: {engine.describe(offer)}")
    await db.commit()
    return serialize_offer(offer)

async def _redemptions(db: AsyncSession, tenant_id: str, offer_id) -> int:
    return int((await db.execute(select(func.count()).select_from(OfferRedemption)
                                 .where(OfferRedemption.tenant_id == tenant_id, OfferRedemption.offer_id == offer_id))).scalar_one())

async def _get(db: AsyncSession, tenant_id: str, offer_id) -> Offer:
    offer = (await db.execute(select(Offer).where(Offer.id == offer_id, Offer.tenant_id == tenant_id))).scalars().first()
    if offer is None:
        raise HTTPException(status_code=404, detail="Offer not found")
    return offer

@router.put("/{offer_id}")
async def update_offer(offer_id: uuid.UUID, data: OfferIn, access: Access = Depends(require("offers.manage", feature="offers")),
                       db: AsyncSession = Depends(get_tenant_db)):
    offer = await _get(db, access.tenant_id, offer_id)
    await _check_refs(db, access.tenant_id, data)
    _apply(offer, data)
    if offer.code and (await db.execute(select(Offer.id).where(Offer.tenant_id == access.tenant_id, Offer.code == offer.code, Offer.id != offer.id))).first():
        raise HTTPException(status_code=409, detail="Another offer already uses this code")
    audit.record(db, access, "offer.update", entity_type="offer", entity_id=offer.id, summary=f"{offer.name}: {engine.describe(offer)}")
    await db.commit()
    return serialize_offer(offer, await _redemptions(db, access.tenant_id, offer.id))

class Toggle(BaseModel):
    is_active: bool

@router.put("/{offer_id}/active")
async def toggle_offer(offer_id: uuid.UUID, data: Toggle, access: Access = Depends(require("offers.manage", feature="offers")),
                       db: AsyncSession = Depends(get_tenant_db)):
    """Switch an offer off (or back on) instantly."""
    offer = await _get(db, access.tenant_id, offer_id)
    offer.is_active = data.is_active
    audit.record(db, access, "offer.update", entity_type="offer", entity_id=offer.id, summary=f"{offer.name} switched {'on' if data.is_active else 'off'}")
    await db.commit()
    return serialize_offer(offer, await _redemptions(db, access.tenant_id, offer.id))

class CartIn(BaseModel):
    items: list[OrderItemIn] = Field(min_length=1, max_length=200)
    channel: str = "POS"
    order_type: Literal["DINE_IN", "TAKEAWAY", "DELIVERY", "RETAIL_WALKIN"] = "TAKEAWAY"
    customer_id: uuid.UUID | None = None
    customer_phone: str | None = Field(None, pattern=PHONE_PATTERN)
    code: str | None = Field(None, max_length=32)

@router.post("/evaluate")
async def evaluate_cart(data: CartIn, access: Access = Depends(require("offers.apply", feature="offers")), db: AsyncSession = Depends(get_tenant_db)):
    """Which offers apply to a cart that isn't an order yet (POS shows these before billing)."""
    settings = await get_settings(db, access.tenant_id)
    channel = await get_channel(db, access.tenant_id, data.channel.upper())
    adjust = Decimal(channel.price_adjust_pct or 0) if channel else Decimal(0)
    products = {p.id: p for p in (await db.execute(select(Product).where(Product.id.in_({i.product_id for i in data.items}),
                                                                         Product.tenant_id == access.tenant_id))).scalars().all()}
    taxes = await TaxResolver.load(db, access.tenant_id, settings)
    lines, keys = [], []
    for item in data.items:
        product = products.get(item.product_id)
        if product is None:
            continue
        modifier = Decimal(0)
        if item.variant_id:
            variant = await db.get(ProductVariant, item.variant_id)
            if variant and variant.product_id == product.id:
                modifier = Decimal(variant.price_modifier)
        unit = channel_menu.unit_price(product, data.channel, adjust, modifier)
        lines.append(PricedLine(key=product, unit_price=unit, quantity=item.quantity, tax_rate=taxes.for_product(product).total_rate))
    price_order(lines, settings.prices_include_tax)
    offer_lines = [engine.OfferLine(index=n, product_id=str(l.key.id), category_id=str(l.key.category_id) if l.key.category_id else None,
                                    quantity=l.quantity, taxable=l.taxable, gross=l.gross) for n, l in enumerate(lines)]
    customer_id = data.customer_id
    if not customer_id and data.customer_phone:
        customer_id = (await db.execute(select(Customer.id).where(Customer.tenant_id == access.tenant_id,
                                                                  Customer.phone == data.customer_phone.replace(" ", "")))).scalar()
    offers = await engine.active_offers(db, access.tenant_id)
    visits, used = await engine.customer_context(db, access.tenant_id, customer_id, offers)
    ctx = engine.OfferContext(lines=offer_lines, channel=data.channel.upper(), order_type=data.order_type, now_utc=datetime.utcnow(),
                              customer_id=str(customer_id) if customer_id else None, customer_visits_in_window=visits,
                              customer_redemptions=used, code=data.code)
    results = [engine.evaluate(o, ctx) for o in offers]
    best = engine.best_offer([r for r, o in zip(results, offers) if o.auto_apply])
    return {"best_auto_offer_id": best.offer_id if best else None,
            "offers": sorted(({"offer_id": r.offer_id, "name": r.name, "description": r.description, "eligible": r.eligible,
                               "reason": r.reason, "discount": float(r.discount), "free_product_id": r.free_product_id,
                               "auto_apply": o.auto_apply} for r, o in zip(results, offers)), key=lambda x: (not x["eligible"], -x["discount"]))}

@router.post("/{offer_id}/announce")
async def announce_offer(offer_id: uuid.UUID, access: Access = Depends(require("email.manage", feature="email")),
                         db: AsyncSession = Depends(get_tenant_db)):
    """Email the offer to customers who agreed to receive offers (marketing consent)."""
    offer = await _get(db, access.tenant_id, offer_id)
    if not offer.is_active:
        raise HTTPException(status_code=409, detail="Switch the offer on before announcing it")
    customers = (await db.execute(select(Customer).where(Customer.tenant_id == access.tenant_id, Customer.marketing_opt_in == True,
                                                         Customer.email.isnot(None)).limit(5000))).scalars().all()
    queued = 0
    for c in customers:
        log = await queue_email(db, access.tenant_id, "offer_announcement", c.email, {
            "customer_name": (c.name or "").split(" ")[0] or "there", "offer_name": offer.name, "offer_details": engine.describe(offer),
            "offer_code": offer.code or "your phone number", "offer_valid_until": offer.ends_at.strftime("%d %b %Y") if offer.ends_at else "further notice",
        }, customer_id=c.id, offer_id=offer.id)
        queued += 1 if log is not None else 0
    audit.record(db, access, "offer.update", entity_type="offer", entity_id=offer.id, summary=f"Announced {offer.name} to {queued} customers")
    await db.commit()
    return {"queued": queued, "opted_in_customers": len(customers)}
