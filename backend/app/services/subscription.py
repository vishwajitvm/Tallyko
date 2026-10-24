"""Tallyko's own subscriptions: trials, paid periods, pricing options, promotional offers, the access lock and the daily check.

Access rule: a business works while `tenant_configs.paid_until` (+ the platform grace days) is in the future. After that every
business API answers 402 and the app shows the renewal screen. Nothing is deleted: data stays, and bills a device made offline
stay in its outbox and sync once the business renews.

Daily at 01:00 India time (`run_scheduler`, started with the API) the check signs out every device of businesses whose
subscription just ended, so open screens close too. It is idempotent and safe to run by hand (`manage.py subscriptions:check`
or the console's "Run now").
"""
import asyncio
import logging
import time
from datetime import datetime, timedelta
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.catalog import DEFAULT_PLAN_KEY
from app.core.config import settings as app_settings
from app.core.tenant import drop_tenant_cache, get_redis_client, get_shared_session_maker
from app.services.pricing import money

logger = logging.getLogger("tallyko")

IST = timedelta(hours=5, minutes=30)
JOB_KEY = "jobs.subscription_check"
DEFAULT_SETTINGS = {
    "trial_days": 7,  # free demo for every new business (super admin → Settings; per business → "Give a demo")
    "grace_days": 0,
    "reminder_days": 7,
    "payment": {
        "upi_id": "", "payee_name": "Tallyko", "bank_details": "", "support_phone": "", "support_email": "",
        "instructions": "Pay by UPI or bank transfer, then send us the reference (UTR) number below. "
                        "Your account is switched on as soon as we confirm the payment.",
    },
}
# "Development access": no expiry until the super admin removes it (internal testing, pilot shops while we build).
DEVELOPMENT_UNTIL = datetime(2099, 12, 31)
KIND_LABELS = {"trial": "Free demo", "paid": "Paid", "complimentary": "Complimentary", "development": "Development access"}
LAPSED_MESSAGE = "Your Tallyko subscription has ended. Renew to continue — your data and any offline bills are safe."

# --- platform settings ---------------------------------------------------------------------------------------------

_settings_cache: tuple[float, dict] | None = None

async def get_platform_settings(db: AsyncSession | None = None, fresh: bool = False) -> dict:
    """Defaults merged with what the super admin saved (cached in-process for 60 s)."""
    global _settings_cache
    if not fresh and _settings_cache and time.monotonic() - _settings_cache[0] < 60:
        return _settings_cache[1]
    from app.models import PlatformSetting

    async def load(session):
        rows = (await session.execute(select(PlatformSetting))).scalars().all()
        return {r.key: r.value for r in rows}
    if db is not None:
        stored = await load(db)
    else:
        async with get_shared_session_maker()() as session:
            stored = await load(session)
    merged = {**DEFAULT_SETTINGS, **{k: v for k, v in stored.items() if k in DEFAULT_SETTINGS or k.startswith("jobs.")}}
    merged["payment"] = {**DEFAULT_SETTINGS["payment"], **(stored.get("payment") or {})}
    _settings_cache = (time.monotonic(), merged)
    return merged

async def save_platform_setting(db: AsyncSession, key: str, value) -> None:
    global _settings_cache
    from app.models import PlatformSetting
    row = await db.get(PlatformSetting, key)
    if row is None:
        db.add(PlatformSetting(key=key, value=value))
    else:
        row.value = value
    _settings_cache = None

# --- access state --------------------------------------------------------------------------------------------------

def _parse(value) -> datetime | None:
    if value is None or isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)

def state_for(paid_until, grace_days: int, kind: str | None = None, now: datetime | None = None) -> dict:
    """trial (demo) | development | active | grace | lapsed, with days left."""
    now = now or datetime.utcnow()
    paid_until = _parse(paid_until)
    if paid_until is None:
        return {"state": "lapsed", "paid_until": None, "days_left": 0, "locked": True}
    lock_at = paid_until + timedelta(days=grace_days or 0)
    days_left = (paid_until - now).total_seconds() / 86400
    if now >= lock_at:
        state = "lapsed"
    elif now >= paid_until:
        state = "grace"
    elif kind in ("trial", "development"):
        state = kind
    else:
        state = "active"
    return {"state": state, "kind": kind, "label": KIND_LABELS.get(kind or "", None), "paid_until": paid_until.isoformat() + "Z",
            "lock_at": lock_at.isoformat() + "Z", "days_left": None if state == "development" else
            (max(0, int(days_left + 0.999)) if days_left > 0 else 0), "locked": now >= lock_at}

async def current_kind(db: AsyncSession, vendor_id) -> str | None:
    """trial | paid | complimentary for the period running now (or the latest one)."""
    from app.models import Subscription
    now = datetime.utcnow()
    rows = (await db.execute(select(Subscription).where(Subscription.vendor_id == vendor_id)
                             .order_by(Subscription.end_date.desc()).limit(5))).scalars().all()
    current = next((s for s in rows if s.start_date <= now < s.end_date), rows[0] if rows else None)
    return (current.snap_entitlements or {}).get("kind", "paid") if current else None

async def is_locked(tenant_config: dict) -> bool:
    """For the per-request check: `tenant_config` is the cached dict from get_tenant_config."""
    grace = int((await get_platform_settings()).get("grace_days") or 0)
    return state_for(tenant_config.get("paid_until"), grace)["locked"]

# --- pricing & offers ----------------------------------------------------------------------------------------------

def price_options(plan) -> list[dict]:
    """How a plan can be bought: explicit billing options, or the monthly price for 1 / 3 / 6 / 12 months."""
    monthly = Decimal(plan.price_monthly or 0)
    options = plan.billing_options or [{"months": m} for m in (1, 3, 6, 12)]
    out = []
    for opt in sorted(options, key=lambda o: int(o["months"])):
        months = int(opt["months"])
        price = money(Decimal(str(opt["price"]))) if opt.get("price") is not None else money(monthly * months)
        full = money(monthly * months)
        out.append({"months": months, "price": float(price), "label": opt.get("label") or _default_label(months),
                    "per_month": float(money(price / months)) if months else 0.0,
                    "saving": float(max(Decimal(0), full - price))})
    return out

def _default_label(months: int) -> str:
    return {1: "Monthly", 3: "Quarterly", 6: "Half-yearly", 12: "Yearly"}.get(months, f"{months} months")

def offer_check(offer, plan_key: str, months: int, list_price: Decimal, has_paid_before: bool, now: datetime | None = None) -> tuple[bool, str | None, Decimal, int]:
    """(eligible, reason, discount ₹, extra free days)."""
    now = now or datetime.utcnow()
    if not offer.is_active:
        return False, "This offer has ended", Decimal(0), 0
    if offer.starts_at and now < offer.starts_at:
        return False, "This offer hasn't started yet", Decimal(0), 0
    if offer.ends_at and now >= offer.ends_at:
        return False, "This offer has ended", Decimal(0), 0
    if offer.max_redemptions and (offer.redemptions or 0) >= offer.max_redemptions:
        return False, "This offer is fully used", Decimal(0), 0
    if offer.plan_keys and plan_key not in offer.plan_keys:
        return False, "Not valid for this plan", Decimal(0), 0
    if months < (offer.min_months or 1):
        return False, f"Valid on {offer.min_months}+ months", Decimal(0), 0
    if offer.new_businesses_only and has_paid_before:
        return False, "Only for a first paid subscription", Decimal(0), 0
    value = Decimal(offer.discount_value or 0)
    discount = Decimal(0)
    if offer.discount_type == "percent":
        discount = money(list_price * min(value, Decimal(100)) / 100)
    elif offer.discount_type == "flat":
        discount = min(money(value), list_price)
    return True, None, discount, int(offer.extra_days or 0)

def describe_offer(offer) -> str:
    parts = []
    if offer.discount_type == "percent" and offer.discount_value:
        parts.append(f"{Decimal(offer.discount_value).normalize():f}% off")
    elif offer.discount_type == "flat" and offer.discount_value:
        parts.append(f"₹{Decimal(offer.discount_value):,.0f} off")
    if offer.extra_days:
        parts.append(f"{offer.extra_days} extra days free")
    if (offer.min_months or 1) > 1:
        parts.append(f"on {offer.min_months}+ months")
    if offer.plan_keys:
        parts.append("on " + ", ".join(offer.plan_keys))
    return " ".join(parts) or offer.name

def serialize_offer(o) -> dict:
    return {"id": str(o.id), "code": o.code, "name": o.name, "description": o.description, "discount_type": o.discount_type,
            "discount_value": float(o.discount_value or 0), "extra_days": o.extra_days, "plan_keys": o.plan_keys, "min_months": o.min_months,
            "starts_at": o.starts_at.isoformat() + "Z" if o.starts_at else None, "ends_at": o.ends_at.isoformat() + "Z" if o.ends_at else None,
            "max_redemptions": o.max_redemptions, "redemptions": o.redemptions or 0, "new_businesses_only": o.new_businesses_only,
            "show_to_owners": o.show_to_owners, "is_active": o.is_active, "summary": describe_offer(o)}

async def find_offer(db: AsyncSession, code: str | None = None, offer_id=None):
    from app.models import SubscriptionOffer
    if offer_id:
        return await db.get(SubscriptionOffer, offer_id)
    if code:
        return (await db.execute(select(SubscriptionOffer).where(SubscriptionOffer.code == code.strip().upper()))).scalars().first()
    return None

async def has_paid_before(db: AsyncSession, vendor_id) -> bool:
    from app.models import Subscription
    subs = (await db.execute(select(Subscription).where(Subscription.vendor_id == vendor_id))).scalars().all()
    return any((s.snap_entitlements or {}).get("kind", "paid") == "paid" for s in subs)

async def quote(db: AsyncSession, vendor_id, plan_key: str, months: int, offer_code: str | None = None) -> dict:
    from app.models import Plan
    plan = await db.get(Plan, plan_key)
    if plan is None or not plan.is_active:
        raise HTTPException(status_code=404, detail="Plan not found")
    option = next((o for o in price_options(plan) if o["months"] == months), None)
    list_price = Decimal(str(option["price"])) if option else money(Decimal(plan.price_monthly or 0) * months)
    result = {"plan_key": plan.key, "plan_name": plan.name, "months": months, "list_price": float(list_price), "discount": 0.0,
              "extra_days": 0, "amount": float(list_price), "offer": None, "offer_error": None}
    if offer_code:
        offer = await find_offer(db, code=offer_code)
        if offer is None:
            result["offer_error"] = "No offer with this code"
        else:
            ok, reason, discount, extra = offer_check(offer, plan.key, months, list_price, await has_paid_before(db, vendor_id))
            if ok:
                result.update(discount=float(discount), extra_days=extra, amount=float(list_price - discount), offer=serialize_offer(offer))
            else:
                result["offer_error"] = reason
    return result

# --- recording -----------------------------------------------------------------------------------------------------

async def record_subscription(db: AsyncSession, vendor_id, plan, months: int, *, amount_paid: float, method: str, recorded_by: str,
                              kind: str = "paid", reference: str | None = None, note: str | None = None, offer=None,
                              start: datetime | None = None, days: int | None = None) -> dict:
    """Add a subscription period (paid, trial or complimentary). Continues from the current paid-until date, unlocks the
    business, and snapshots the plan so later plan edits never change what was sold."""
    from app.models import Subscription, TenantConfig
    config = await db.get(TenantConfig, vendor_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Business not found")
    now = datetime.utcnow()
    list_price = Decimal(0)
    if plan is not None and months:
        option = next((o for o in price_options(plan) if o["months"] == months), None)
        list_price = Decimal(str(option["price"])) if option else money(Decimal(plan.price_monthly or 0) * months)
    discount, extra_days = Decimal(0), 0
    if offer is not None:
        ok, reason, discount, extra_days = offer_check(offer, plan.key, months, list_price, await has_paid_before(db, vendor_id))
        if not ok:
            raise HTTPException(status_code=400, detail=f"Offer can't be used: {reason}")
        offer.redemptions = (offer.redemptions or 0) + 1
    # Continue after the running paid/demo period. Development access (no expiry) runs alongside, not ahead.
    from app.models import Subscription as Sub
    ends = [s.end_date for s in (await db.execute(select(Sub).where(Sub.vendor_id == vendor_id, Sub.end_date > now))).scalars().all()
            if (s.snap_entitlements or {}).get("kind") != "development"]
    current_end = max(ends) if ends and kind != "development" else None
    begin = start or current_end or now
    end = begin + timedelta(days=days if days is not None else 30 * months) + timedelta(days=extra_days)
    snapshot = {
        "kind": kind, "plan_key": plan.key if plan else (config.plan_key or DEFAULT_PLAN_KEY), "plan_name": plan.name if plan else None,
        "features": list(plan.features) if plan else None, "limits": dict(plan.limits) if plan else None,
        "price_monthly": float(plan.price_monthly) if plan else 0.0, "months": months, "list_price": float(list_price),
        "discount": float(discount), "extra_days": extra_days, "amount_due": float(max(Decimal(0), list_price - discount)),
        "amount_paid": float(amount_paid), "payment_method": method, "payment_reference": reference, "note": note,
        "offer": {"id": str(offer.id), "code": offer.code, "name": offer.name} if offer is not None else None,
        "recorded_by": recorded_by, "paid_at": now.isoformat(),
    }
    db.add(Subscription(vendor_id=vendor_id, snap_entitlements=snapshot, start_date=begin, end_date=end))
    if plan is not None:
        config.plan_key = plan.key
    config.paid_until = max(config.paid_until or end, end) if config.paid_until and config.paid_until > now else end
    config.lapsed_at = None
    if config.status == "suspended" and (config.status_reason or "").lower().startswith(("payment", "subscription")):
        config.status, config.status_reason = "active", None
    await db.flush()
    await drop_tenant_cache(vendor_id)
    from app.services.access import invalidate
    invalidate(str(vendor_id))
    return {"start_date": begin.isoformat() + "Z", "end_date": end.isoformat() + "Z", "paid_until": config.paid_until.isoformat() + "Z", **snapshot}

async def start_trial(db: AsyncSession, vendor_id, plan_key: str | None = None, days: int | None = None, recorded_by: str = "signup",
                      note: str | None = None) -> dict | None:
    """A free demo of `days` (default: the platform setting). Extends a demo/period that is still running."""
    from app.models import Plan, TenantConfig
    trial_days = days if days is not None else int((await get_platform_settings(db)).get("trial_days") or 0)
    if trial_days <= 0:
        return None  # no demo: the business stays locked until its first payment
    if plan_key is None:
        config = await db.get(TenantConfig, vendor_id)
        plan_key = config.plan_key if config and config.plan_key else DEFAULT_PLAN_KEY
    plan = await db.get(Plan, plan_key)
    return await record_subscription(db, vendor_id, plan, 0, amount_paid=0, method="free", recorded_by=recorded_by, kind="trial",
                                     note=note or f"{trial_days}-day free demo", days=trial_days)

async def recompute_paid_until(db: AsyncSession, vendor_id) -> datetime | None:
    from app.models import Subscription, TenantConfig
    config = await db.get(TenantConfig, vendor_id)
    ends = [s.end_date for s in (await db.execute(select(Subscription).where(Subscription.vendor_id == vendor_id))).scalars().all()]
    config.paid_until = max(ends) if ends else None
    await db.flush()
    await drop_tenant_cache(vendor_id)
    return config.paid_until

async def set_development_access(db: AsyncSession, vendor_id, enabled: bool, recorded_by: str, note: str | None = None) -> dict:
    """Development access: works with no expiry until removed. Removing it ends that period now; the business is then on
    whatever it had paid for (or locked if nothing is left, after the grace days)."""
    from app.models import Plan, Subscription, TenantConfig
    now = datetime.utcnow()
    running = [s for s in (await db.execute(select(Subscription).where(Subscription.vendor_id == vendor_id,
                                                                       Subscription.end_date > now))).scalars().all()
               if (s.snap_entitlements or {}).get("kind") == "development"]
    if enabled:
        if not running:
            config = await db.get(TenantConfig, vendor_id)
            if config is None:
                raise HTTPException(status_code=404, detail="Business not found")
            plan = await db.get(Plan, config.plan_key or DEFAULT_PLAN_KEY)
            await record_subscription(db, vendor_id, plan, 0, amount_paid=0, method="free", recorded_by=recorded_by, kind="development",
                                      note=note or "Development access (no expiry)", start=now,
                                      days=(DEVELOPMENT_UNTIL - now).days)
    else:
        for sub in running:
            sub.end_date = max(sub.start_date, now)
        paid_until = await recompute_paid_until(db, vendor_id)
        config = await db.get(TenantConfig, vendor_id)
        if paid_until is None or paid_until <= now:
            config.paid_until = now  # nothing else is paid: locked (after any grace days)
    from app.services.access import invalidate
    invalidate(str(vendor_id))
    await drop_tenant_cache(vendor_id)
    return {"development": enabled}

# --- the daily check -----------------------------------------------------------------------------------------------

async def run_subscription_check(now: datetime | None = None, actor: str = "system (daily check)") -> dict:
    """Sign out every device of businesses whose subscription (+ grace) ended and that weren't locked yet."""
    from app.models import PlatformAuditLog, TenantConfig
    from app.services.sessions import sign_out_business
    started = time.monotonic()
    now = now or datetime.utcnow()
    async with get_shared_session_maker()() as db:
        platform = await get_platform_settings(db, fresh=True)
        grace = timedelta(days=int(platform.get("grace_days") or 0))
        reminder = timedelta(days=int(platform.get("reminder_days") or 7))
        configs = (await db.execute(select(TenantConfig).where(TenantConfig.status == "active"))).scalars().all()
        locked, due_soon = [], 0
        for config in configs:
            if config.paid_until is None or config.paid_until + grace <= now:
                if config.lapsed_at is None:
                    config.lapsed_at = now
                    devices = await sign_out_business(db, config.vendor_id, "Subscription ended")
                    db.add(PlatformAuditLog(actor_email=actor, action="subscription.lapsed", target_tenant_id=config.vendor_id,
                                            details={"paid_until": config.paid_until.isoformat() if config.paid_until else None,
                                                     "devices_signed_out": devices}))
                    locked.append(str(config.vendor_id))
            elif config.paid_until <= now + reminder:
                due_soon += 1
        summary = {"last_run_at": now.isoformat() + "Z", "businesses_checked": len(configs), "locked_now": len(locked),
                   "renewals_due_soon": due_soon, "duration_ms": int((time.monotonic() - started) * 1000), "by": actor}
        await save_platform_setting(db, JOB_KEY, summary)
        await db.commit()
    logger.info(f"[Subscriptions] daily check: {summary}")
    return {**summary, "locked_business_ids": locked}

def next_run_utc(now: datetime | None = None, hour_ist: int = 1) -> datetime:
    now = now or datetime.utcnow()
    local = now + IST
    target = local.replace(hour=hour_ist, minute=0, second=0, microsecond=0)
    if target <= local:
        target += timedelta(days=1)
    return target - IST

async def _run_once_per_day(local_date: str) -> None:
    """Several API replicas may run; a Redis lock makes one of them do the day's check (runs anyway if Redis is down —
    the check is idempotent)."""
    try:
        redis = await get_redis_client()
        if not await redis.set(f"jobs:subscription_check:{local_date}", "1", nx=True, ex=6 * 3600):
            return
    except Exception:
        pass
    await run_subscription_check()

async def run_scheduler(stop: asyncio.Event) -> None:
    """Started from the API lifespan: the 01:00 IST check, plus a catch-up if the server was down at 01:00."""
    try:
        last = (await get_platform_settings(fresh=True)).get(JOB_KEY) or {}
        last_run = _parse(last.get("last_run_at", "").rstrip("Z") or None)
        now = datetime.utcnow()
        today_run = next_run_utc(now) - timedelta(days=1)
        if last_run is None or last_run < today_run:
            await _run_once_per_day((today_run + IST).date().isoformat())
    except Exception as exc:
        logger.error(f"[Subscriptions] catch-up check failed: {exc}")
    while not stop.is_set():
        target = next_run_utc()
        try:
            await asyncio.wait_for(stop.wait(), timeout=max(1.0, (target - datetime.utcnow()).total_seconds()))
            return
        except asyncio.TimeoutError:
            pass
        try:
            await _run_once_per_day((target + IST).date().isoformat())
        except Exception as exc:
            logger.error(f"[Subscriptions] daily check failed: {exc}")

def scheduler_enabled() -> bool:
    return bool(getattr(app_settings, "JOB_SCHEDULER_ENABLED", True))
