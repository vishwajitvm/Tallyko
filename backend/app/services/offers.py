"""Offer & loyalty-reward rules engine.

`evaluate()` is pure (no I/O) so every rule is unit-testable; `context_for_order()` gathers what it needs.
Discounts are worked out on the pre-tax value of the eligible lines, so GST is charged on the discounted amount.
"""
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.config import settings as app_settings
from app.services.pricing import money, ZERO

@dataclass
class OfferLine:
    index: int
    product_id: str
    category_id: str | None
    quantity: int
    taxable: Decimal  # pre-tax value of the line before any discount
    gross: Decimal  # what the menu shows (incl. tax when prices include tax)

@dataclass
class OfferContext:
    lines: list[OfferLine]
    channel: str
    order_type: str
    now_utc: datetime
    customer_id: str | None = None
    customer_visits_in_window: dict[int | None, int] = field(default_factory=dict)  # window_days -> completed visits
    customer_redemptions: dict[str, int] = field(default_factory=dict)  # offer_id -> times this customer used it
    code: str | None = None  # coupon code typed by the customer/cashier

@dataclass
class OfferResult:
    offer_id: str
    name: str
    eligible: bool
    reason: str | None = None  # why not eligible (shown to staff)
    discount: Decimal = ZERO  # pre-tax amount off
    line_discounts: dict[int, Decimal] = field(default_factory=dict)
    free_product_id: str | None = None
    free_quantity: int = 0
    description: str = ""

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

def describe(offer) -> str:
    """Human summary, e.g. "20% off (max ₹150) on bills above ₹500 · Fri–Sun 18:00–22:00"."""
    value = Decimal(offer.benefit_value or 0)
    if offer.benefit_type == "percent":
        benefit = f"{value.normalize():f}% off" + (f" (max ₹{Decimal(offer.max_discount).normalize():f})" if offer.max_discount else "")
    elif offer.benefit_type == "flat":
        benefit = f"₹{value.normalize():f} off"
    else:
        benefit = f"{offer.free_quantity or 1} free item" + ("s" if (offer.free_quantity or 1) > 1 else "")
    scope = " on selected items" if offer.kind == "items" else ""
    parts = [benefit + scope]
    if offer.min_order_amount and Decimal(offer.min_order_amount) > 0:
        parts.append(f"on bills above ₹{Decimal(offer.min_order_amount).normalize():f}")
    if offer.kind == "loyalty" and offer.min_visits:
        window = f" in {offer.visits_window_days} days" if offer.visits_window_days else ""
        parts.append(f"after {offer.min_visits} visits{window}")
    text = " ".join(parts)
    if offer.days_of_week:
        text += " · " + ", ".join(DAY_NAMES[d] for d in sorted(offer.days_of_week))
    if offer.start_time and offer.end_time:
        text += f" · {offer.start_time.strftime('%H:%M')}–{offer.end_time.strftime('%H:%M')}"
    return text

def _within_daily_window(local: datetime, start: time | None, end: time | None) -> bool:
    if not start or not end:
        return True
    now = local.time()
    return start <= now < end if start <= end else (now >= start or now < end)  # overnight windows, e.g. 22:00–02:00

def evaluate(offer, ctx: OfferContext, *, staff_selected: bool = True) -> OfferResult:
    result = OfferResult(offer_id=str(offer.id), name=offer.name, eligible=False, description=describe(offer))
    def no(reason: str) -> OfferResult:
        result.reason = reason
        return result

    if not offer.is_active:
        return no("This offer is switched off")
    if offer.starts_at and ctx.now_utc < offer.starts_at:
        return no("Starts later")
    if offer.ends_at and ctx.now_utc >= offer.ends_at:
        return no("Expired")
    local = ctx.now_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo(app_settings.TIMEZONE))
    if offer.days_of_week and local.weekday() not in offer.days_of_week:
        return no("Not valid today")
    if not _within_daily_window(local, offer.start_time, offer.end_time):
        return no(f"Valid {offer.start_time.strftime('%H:%M')}–{offer.end_time.strftime('%H:%M')} only")
    if offer.channels and ctx.channel not in offer.channels:
        return no("Not valid on this channel")
    if offer.order_types and ctx.order_type not in offer.order_types:
        return no("Not valid for this order type")
    if offer.code and not staff_selected and (ctx.code or "").strip().upper() != offer.code.upper():
        return no("Needs the offer code")
    if offer.max_uses_total is not None and (offer.uses_count or 0) >= offer.max_uses_total:
        return no("Fully redeemed")

    needs_customer = offer.kind == "loyalty" or offer.max_uses_per_customer is not None
    if needs_customer and not ctx.customer_id:
        return no("Add the customer to use this offer")
    if offer.max_uses_per_customer is not None and ctx.customer_redemptions.get(str(offer.id), 0) >= offer.max_uses_per_customer:
        return no("Customer already used this offer")
    if offer.kind == "loyalty" and offer.min_visits:
        visits = ctx.customer_visits_in_window.get(offer.visits_window_days, 0)
        if visits < offer.min_visits:
            window = f" in the last {offer.visits_window_days} days" if offer.visits_window_days else ""
            return no(f"Needs {offer.min_visits} visits{window} (has {visits})")

    bill_gross = sum((l.gross for l in ctx.lines), ZERO)
    if offer.min_order_amount and bill_gross < Decimal(offer.min_order_amount):
        return no(f"Bill must be above ₹{Decimal(offer.min_order_amount).normalize():f}")

    if offer.kind == "items":
        products = {str(p) for p in (offer.product_ids or [])}
        categories = {str(c) for c in (offer.category_ids or [])}
        eligible = [l for l in ctx.lines if l.product_id in products or (l.category_id and l.category_id in categories)]
        if not eligible:
            return no("No eligible items in the bill")
    else:
        eligible = list(ctx.lines)

    if offer.benefit_type == "free_item":
        if not offer.free_product_id:
            return no("Free item not set")
        result.free_product_id = str(offer.free_product_id)
        result.free_quantity = max(1, offer.free_quantity or 1)
        result.eligible = True
        return result

    base = sum((l.taxable for l in eligible), ZERO)
    value = Decimal(offer.benefit_value or 0)
    discount = money(base * value / 100) if offer.benefit_type == "percent" else money(min(value, base))
    if offer.max_discount is not None:
        discount = min(discount, money(offer.max_discount))
    if discount <= 0:
        return no("Nothing to discount")
    # Spread over eligible lines in proportion to value, so each GST rate gets its share
    remaining = discount
    for i, line in enumerate(eligible):
        share = remaining if i == len(eligible) - 1 else min(remaining, money(discount * line.taxable / base))
        result.line_discounts[line.index] = share
        remaining -= share
    result.discount = discount
    result.eligible = True
    return result

def best_offer(results: list[OfferResult]) -> OfferResult | None:
    eligible = [r for r in results if r.eligible]
    return max(eligible, key=lambda r: r.discount, default=None)

async def customer_context(db: AsyncSession, tenant_id: str, customer_id, offers) -> tuple[dict, dict]:
    """Visits per window and per-offer redemptions for a customer (only what the offers need)."""
    from app.models import Order, OfferRedemption
    if not customer_id:
        return {}, {}
    windows = {o.visits_window_days for o in offers if o.kind == "loyalty" and o.min_visits}
    visits = {}
    for days in windows:
        query = select(func.count(Order.id)).where(Order.tenant_id == tenant_id, Order.customer_id == customer_id, Order.status == "completed")
        if days:
            query = query.where(Order.completed_at >= datetime.utcnow() - timedelta(days=days))
        visits[days] = int((await db.execute(query)).scalar_one())
    rows = await db.execute(select(OfferRedemption.offer_id, func.count(OfferRedemption.id))
                            .where(OfferRedemption.tenant_id == tenant_id, OfferRedemption.customer_id == customer_id)
                            .group_by(OfferRedemption.offer_id))
    return visits, {str(oid): int(n) for oid, n in rows.all()}

async def active_offers(db: AsyncSession, tenant_id: str):
    from app.models import Offer
    rows = await db.execute(select(Offer).where(Offer.tenant_id == tenant_id, Offer.is_active == True).order_by(Offer.priority.desc(), Offer.created_at))
    return rows.scalars().all()
