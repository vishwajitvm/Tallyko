"""Super admin console: businesses & owners, plans, features per business, subscription payments, GST library.

Only Tallyko platform accounts (global_users.platform_role) can call these; business logins get 403.
Reads are allowed for `support`; anything that changes data needs `super_admin`.
Platform work crosses businesses, so it uses system sessions (no tenant RLS) — every write is audited.
"""
import secrets
import string
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_
from sqlalchemy.future import select
from app.core.catalog import ALL_FEATURES, DEFAULT_PLAN_KEY, DEFAULT_PLANS, FEATURES, split_gst
from app.core.security import PlatformUser, get_password_hash, get_platform_user, require_super_admin, hash_password_async
from app.core.tenant import drop_tenant_cache, get_shared_session_maker
from app.models import (BusinessSettings, GlobalUser, GlobalVendor, Plan, PlatformAuditLog, Product, Subscription, SubscriptionOffer,
                        SubscriptionRequest, TaxPreset, TaxPresetRate, TenantConfig, TenantUser, UserSession, Order, OwnerRequest)
from app.services import sessions as session_service
from app.services import subscription as subs
from app.services import records_admin
from app.schemas.auth import VendorSignupRequest
from app.services import audit
from app.services.access import entitlements, invalidate
from app.services.auth_service import register_vendor
from app.services.tax import ensure_platform_presets, publish_preset_rate

router = APIRouter(prefix="/platform", tags=["Platform (super admin)"])

def _temp_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "Tk-" + "".join(secrets.choice(alphabet) for _ in range(10))

async def _ensure_plans(db) -> None:
    """Default plans exist in the database so they can be edited."""
    for spec in DEFAULT_PLANS:
        if await db.get(Plan, spec["key"]) is None:
            db.add(Plan(key=spec["key"], name=spec["name"], description=spec["description"], price_monthly=spec["price_monthly"],
                        features=list(spec["features"]), limits=dict(spec["limits"]), sort_order=spec["sort_order"]))
    await db.flush()

async def _drop_tenant_cache(tenant_id) -> None:
    invalidate(str(tenant_id))
    await drop_tenant_cache(tenant_id)

@router.get("/me")
async def platform_me(user: PlatformUser = Depends(get_platform_user)):
    return {"user_id": user.user_id, "email": user.email, "platform_role": user.platform_role, "can_edit": user.platform_role == "super_admin"}

async def _count_by_plan(db, condition) -> list[tuple[str, int]]:
    """Businesses per plan; no plan set means the default plan."""
    rows = (await db.execute(select(TenantConfig.plan_key, func.count()).where(condition).group_by(TenantConfig.plan_key))).all()
    totals: dict[str, int] = {}
    for key, count in rows:
        totals[key or DEFAULT_PLAN_KEY] = totals.get(key or DEFAULT_PLAN_KEY, 0) + int(count)
    return list(totals.items())

def _paid_at(sub: Subscription) -> datetime:
    raw = (sub.snap_entitlements or {}).get("paid_at")
    try:
        return datetime.fromisoformat(raw) if raw else sub.start_date
    except ValueError:
        return sub.start_date

def _utc_naive(dt: datetime) -> datetime:
    return dt if dt.tzinfo is None else (dt - dt.utcoffset()).replace(tzinfo=None)

# --- Overview -------------------------------------------------------------------------------------------------

@router.get("/overview")
async def overview(user: PlatformUser = Depends(get_platform_user)):
    async with get_shared_session_maker()() as db:
        await _ensure_plans(db)
        await db.commit()
        status_rows = (await db.execute(select(TenantConfig.status, func.count()).group_by(TenantConfig.status))).all()
        plan_rows = await _count_by_plan(db, TenantConfig.status == "active")
        month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        new_this_month = (await db.execute(select(func.count(GlobalVendor.id)).where(GlobalVendor.created_at >= month_start))).scalar_one()
        # Revenue counts when the payment was recorded (an early renewal may start next month)
        recent = (await db.execute(select(Subscription).where(Subscription.end_date >= month_start))).scalars().all()
        revenue = sum(Decimal(str((s.snap_entitlements or {}).get("amount_paid", 0) or 0)) for s in recent if _paid_at(s) >= month_start)
        now = datetime.utcnow()
        latest_end = select(Subscription.vendor_id, func.max(Subscription.end_date).label("end")).group_by(Subscription.vendor_id).subquery()
        expiring = (await db.execute(select(func.count()).select_from(latest_end)
                                     .where(latest_end.c.end > now, latest_end.c.end <= now + timedelta(days=7)))).scalar_one()
        locked = (await db.execute(select(func.count()).select_from(TenantConfig).where(TenantConfig.status == "active",
                                                                                       TenantConfig.lapsed_at.isnot(None)))).scalar_one()
        pending_requests = (await db.execute(select(func.count()).select_from(SubscriptionRequest)
                                             .where(SubscriptionRequest.status == "pending"))).scalar_one()
        last_check = (await subs.get_platform_settings(db, fresh=True)).get(subs.JOB_KEY)
        types = (await db.execute(select(func.coalesce(GlobalVendor.business_type, "restaurant"), func.count())
                                  .outerjoin(TenantConfig, TenantConfig.vendor_id == GlobalVendor.id)
                                  .where(func.coalesce(TenantConfig.status, "active") != "deleted")
                                  .group_by(GlobalVendor.business_type))).all()
    return {
        "businesses": {s: int(n) for s, n in status_rows},
        "by_plan": {p: int(n) for p, n in plan_rows},
        "by_type": {t: int(n) for t, n in types},
        "new_this_month": int(new_this_month),
        "revenue_this_month": float(revenue),
        "renewals_due_7_days": int(expiring),
        "locked": int(locked),
        "pending_payment_requests": int(pending_requests),
        "last_subscription_check": last_check,
    }

# --- Businesses -----------------------------------------------------------------------------------------------

def _business_row(vendor: GlobalVendor, config: TenantConfig | None, owner: TenantUser | None, owner_account: GlobalUser | None,
                  staff_count: int, paid_until, last_order_at, grace_days: int = 0) -> dict:
    paid_until = (config.paid_until if config and config.paid_until else None) or paid_until
    access = subs.state_for(paid_until, grace_days)
    return {
        "access": access, "locked": access["locked"], "lapsed_at": config.lapsed_at.isoformat() + "Z" if config and config.lapsed_at else None,
        "id": str(vendor.id), "name": vendor.name, "business_type": vendor.business_type or "restaurant",
        "status": config.status if config else "active", "status_reason": config.status_reason if config else None,
        "plan_key": (config.plan_key if config and config.plan_key else None) or DEFAULT_PLAN_KEY,
        "owner": {"name": (owner_account.full_name if owner_account else None) or (owner.full_name if owner else None),
                  "email": owner.username if owner else None, "phone": owner_account.phone if owner_account else None},
        "staff_count": staff_count, "created_at": vendor.created_at.isoformat() + "Z",
        "paid_until": paid_until.isoformat() + "Z" if paid_until else None,
        "subscription_status": "none" if not paid_until else ("expired" if access["state"] in ("lapsed", "grace") else "active"),
        "last_activity_at": last_order_at.isoformat() + "Z" if last_order_at else None,
    }

@router.get("/businesses")
async def list_businesses(q: str | None = Query(None, max_length=80), status: str | None = Query(None, pattern="^(active|suspended|deleted)$"),
                          plan: str | None = Query(None, max_length=40), limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                          access: str | None = Query(None, pattern="^(locked|trial|development|active|expiring)$"),
                          with_counts: bool = False,
                          user: PlatformUser = Depends(get_platform_user)):
    async with get_shared_session_maker()() as db:
        query = select(GlobalVendor, TenantConfig).outerjoin(TenantConfig, TenantConfig.vendor_id == GlobalVendor.id)
        if status:
            query = query.where(TenantConfig.status == status)
        if plan:
            query = query.where(TenantConfig.plan_key == plan) if plan != DEFAULT_PLAN_KEY else                 query.where(or_(TenantConfig.plan_key == plan, TenantConfig.plan_key.is_(None)))
        if q:
            owners = select(TenantUser.tenant_id).where(TenantUser.role == "owner", TenantUser.username.ilike(f"%{q.strip()}%"))
            query = query.where(or_(GlobalVendor.name.ilike(f"%{q.strip()}%"), GlobalVendor.id.in_(owners)))
        # The filter chips' counts use the same search / status / plan, before the access filter
        base_ids = query.with_only_columns(GlobalVendor.id)
        if access:
            now = datetime.utcnow()
            grace_days = int((await subs.get_platform_settings(db)).get("grace_days") or 0)
            running_kind = (select(Subscription.vendor_id).where(Subscription.start_date <= now, Subscription.end_date > now,
                                                                 Subscription.snap_entitlements["kind"].as_string() == ("trial" if access == "trial" else "development")))
            if access == "locked":
                query = query.where(or_(TenantConfig.paid_until.is_(None), TenantConfig.paid_until + timedelta(days=grace_days) <= now))
            elif access == "expiring":
                query = query.where(TenantConfig.paid_until > now, TenantConfig.paid_until <= now + timedelta(days=7))
            elif access in ("trial", "development"):
                query = query.where(GlobalVendor.id.in_(running_kind))
                if access == "trial":
                    query = query.where(GlobalVendor.id.notin_(
                        select(Subscription.vendor_id).where(Subscription.start_date <= now, Subscription.end_date > now,
                                                             Subscription.snap_entitlements["kind"].as_string() == "development")))
            else:
                query = query.where(TenantConfig.paid_until > now)
        total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
        rows = (await db.execute(query.order_by(GlobalVendor.created_at.desc()).limit(limit).offset(offset))).all()
        ids = [v.id for v, _ in rows]
        owners = {u.tenant_id: u for u in (await db.execute(select(TenantUser).where(TenantUser.tenant_id.in_(ids), TenantUser.role == "owner")
                                                            .order_by(TenantUser.created_at))).scalars().all()} if ids else {}
        accounts = {a.email.lower(): a for a in (await db.execute(select(GlobalUser).where(func.lower(GlobalUser.email).in_(
            [o.username.lower() for o in owners.values()])))).scalars().all()} if owners else {}
        staff = dict((await db.execute(select(TenantUser.tenant_id, func.count()).where(TenantUser.tenant_id.in_(ids), TenantUser.is_active == True)
                                       .group_by(TenantUser.tenant_id))).all()) if ids else {}
        paid = dict((await db.execute(select(Subscription.vendor_id, func.max(Subscription.end_date)).where(Subscription.vendor_id.in_(ids))
                                      .group_by(Subscription.vendor_id))).all()) if ids else {}
        last = dict((await db.execute(select(Order.tenant_id, func.max(Order.created_at)).where(Order.tenant_id.in_(ids))
                                      .group_by(Order.tenant_id))).all()) if ids else {}
        items = []
        grace = int((await subs.get_platform_settings(db)).get("grace_days") or 0)
        now = datetime.utcnow()
        running = {}
        if ids:
            for s in (await db.execute(select(Subscription).where(Subscription.vendor_id.in_(ids), Subscription.start_date <= now,
                                                                  Subscription.end_date > now))).scalars().all():
                if running.get(s.vendor_id) != "development":  # development access outranks a parallel demo
                    running[s.vendor_id] = (s.snap_entitlements or {}).get("kind", "paid")
        for vendor, config in rows:
            owner = owners.get(vendor.id)
            items.append(_business_row(vendor, config, owner, accounts.get(owner.username.lower()) if owner else None,
                                       int(staff.get(vendor.id, 0)), paid.get(vendor.id), last.get(vendor.id), grace))
            items[-1]["access"] = subs.state_for(items[-1]["paid_until"].rstrip("Z") if items[-1]["paid_until"] else None, grace,
                                                 running.get(vendor.id))
        counts = await _access_counts(db, base_ids) if with_counts else None
    return {"total": total, "items": items, "counts": counts}

async def _access_counts(db, base_ids) -> dict:
    """Businesses per access state within the current search / status / plan, for the console's filter chips."""
    now = datetime.utcnow()
    grace = timedelta(days=int((await subs.get_platform_settings(db)).get("grace_days") or 0))
    open_ = TenantConfig.vendor_id.in_(base_ids)
    count = lambda *conds: select(func.count()).select_from(TenantConfig).where(open_, *conds)
    running = lambda kind: select(Subscription.vendor_id).where(Subscription.start_date <= now, Subscription.end_date > now,
                                                                Subscription.snap_entitlements["kind"].as_string() == kind)
    return {
        "all": int((await db.execute(count())).scalar_one()),
        "locked": int((await db.execute(count(or_(TenantConfig.paid_until.is_(None), TenantConfig.paid_until + grace <= now)))).scalar_one()),
        "expiring": int((await db.execute(count(TenantConfig.paid_until > now, TenantConfig.paid_until <= now + timedelta(days=7)))).scalar_one()),
        # development access outranks a demo that is still running alongside it
        "trial": int((await db.execute(count(TenantConfig.vendor_id.in_(running("trial")),
                                             TenantConfig.vendor_id.notin_(running("development"))))).scalar_one()),
        "development": int((await db.execute(count(TenantConfig.vendor_id.in_(running("development"))))).scalar_one()),
        "active": int((await db.execute(count(TenantConfig.paid_until > now))).scalar_one()),
    }

async def _load_business(db, business_id) -> tuple[GlobalVendor, TenantConfig]:
    vendor = await db.get(GlobalVendor, business_id)
    if vendor is None:
        raise HTTPException(status_code=404, detail="Business not found")
    config = await db.get(TenantConfig, business_id)
    if config is None:
        config = TenantConfig(vendor_id=vendor.id, status="active")
        db.add(config)
        await db.flush()
    return vendor, config

@router.get("/businesses/{business_id}")
async def business_detail(business_id: uuid.UUID, user: PlatformUser = Depends(get_platform_user)):
    async with get_shared_session_maker()() as db:
        vendor, config = await _load_business(db, business_id)
        settings = (await db.execute(select(BusinessSettings).where(BusinessSettings.tenant_id == business_id))).scalars().first()
        staff = (await db.execute(select(TenantUser).where(TenantUser.tenant_id == business_id).order_by(TenantUser.created_at))).scalars().all()
        owner = next((s for s in staff if s.role == "owner"), None)
        owner_account = (await db.execute(select(GlobalUser).where(func.lower(GlobalUser.email) == owner.username.lower()))).scalars().first() if owner else None
        subscriptions = (await db.execute(select(Subscription).where(Subscription.vendor_id == business_id).order_by(Subscription.start_date.desc()))).scalars().all()
        products = (await db.execute(select(func.count(Product.id)).where(Product.tenant_id == business_id, Product.is_active == True))).scalar_one()
        last_order = (await db.execute(select(func.max(Order.created_at)).where(Order.tenant_id == business_id))).scalar()
        plan = await db.get(Plan, (config.plan_key if config else None) or DEFAULT_PLAN_KEY)
        await db.commit()
    ent = await entitlements(str(business_id))
    grace = int((await subs.get_platform_settings()).get("grace_days") or 0)
    row = _business_row(vendor, config, owner, owner_account, sum(1 for s in staff if s.is_active),
                        subscriptions[0].end_date if subscriptions else None, last_order, grace)
    now = datetime.utcnow()
    running = next((s for s in subscriptions if s.start_date <= now < s.end_date), None)
    kind = (running.snap_entitlements or {}).get("kind", "paid") if running else None
    row["access"] = subs.state_for(config.paid_until, grace, kind)
    row["development"] = kind == "development"
    row.update({
        "admin_notes": config.admin_notes, "feature_overrides": config.feature_overrides or {}, "limit_overrides": config.limit_overrides or {},
        "effective_features": sorted(ent["features"]), "plan_features": sorted(ent["plan_features"]),
        "plan_default_features": sorted(plan.features or []) if plan else [], "hidden_by_owner": sorted(ent["hidden"]),
        "limits": ent["limits"], "products": int(products),
        "settings": {"address": settings.address, "phone": settings.phone, "email": settings.email, "gstin": settings.gstin,
                     "gst_registration": settings.gst_registration} if settings else None,
        "staff": [{"id": str(s.id), "name": s.full_name, "email": s.username, "role": s.role, "is_active": s.is_active} for s in staff],
        "subscriptions": [{"id": str(s.id), "start_date": s.start_date.isoformat() + "Z", "end_date": s.end_date.isoformat() + "Z",
                           **(s.snap_entitlements or {})} for s in subscriptions],
        "features_catalog": [{"key": k, "name": v} for k, v in FEATURES.items()],
    })
    return row

class BusinessCreate(BaseModel):
    business_name: str = Field(min_length=2, max_length=100)
    business_type: Literal["restaurant", "retail", "cloud_kitchen", "cafe"] = "restaurant"
    owner_name: str = Field(min_length=1, max_length=80)
    owner_email: EmailStr
    owner_phone: str = Field(pattern=r"^\+?[0-9 ]{6,16}$")
    plan_key: str = DEFAULT_PLAN_KEY
    password: str | None = Field(None, min_length=8, max_length=64)  # empty = generate a temporary one
    demo_days: int | None = Field(None, ge=0, le=365)  # free demo length; empty = the platform default, 0 = none
    development: bool = False  # development access: no expiry until removed

@router.post("/businesses")
async def create_business(data: BusinessCreate, user: PlatformUser = Depends(require_super_admin)):
    """Onboard a business for a customer who bought Tallyko (they get a temporary password to change)."""
    password = data.password or _temp_password()
    tokens = await register_vendor(VendorSignupRequest(vendor_name=data.business_name, owner_name=data.owner_name, email=data.owner_email,
                                                       phone=data.owner_phone, password=password, business_type=data.business_type),
                                   demo_days=data.demo_days)
    async with get_shared_session_maker()() as db:
        _, config = await _load_business(db, tokens.tenant_id)
        if await db.get(Plan, data.plan_key) is None and data.plan_key not in {p["key"] for p in DEFAULT_PLANS}:
            raise HTTPException(status_code=404, detail="Plan not found")
        await _ensure_plans(db)
        config.plan_key = data.plan_key
        if data.development:
            await subs.set_development_access(db, tokens.tenant_id, True, user.email)
        audit.record_platform(db, user, "business.create", tenant_id=tokens.tenant_id,
                              details={"name": data.business_name, "plan": data.plan_key, "demo_days": data.demo_days, "development": data.development})
        await db.commit()
    return {"id": str(tokens.tenant_id), "owner_email": data.owner_email.lower(), "temporary_password": None if data.password else password}

class BusinessUpdate(BaseModel):
    status: Literal["active", "suspended"] | None = None
    status_reason: str | None = Field(None, max_length=200)
    plan_key: str | None = Field(None, max_length=40)
    feature_overrides: dict[str, bool] | None = None
    limit_overrides: dict[str, int | None] | None = None
    admin_notes: str | None = Field(None, max_length=2000)

@router.put("/businesses/{business_id}")
async def update_business(business_id: uuid.UUID, data: BusinessUpdate, user: PlatformUser = Depends(require_super_admin)):
    async with get_shared_session_maker()() as db:
        await _ensure_plans(db)
        _, config = await _load_business(db, business_id)
        if config.status == "deleted":
            raise HTTPException(status_code=409, detail="This business was closed by its owner")
        update = data.model_dump(exclude_unset=True)
        if "plan_key" in update and update["plan_key"] and await db.get(Plan, update["plan_key"]) is None:
            raise HTTPException(status_code=404, detail="Plan not found")
        if update.get("feature_overrides"):
            unknown = [k for k in update["feature_overrides"] if k not in ALL_FEATURES]
            if unknown:
                raise HTTPException(status_code=422, detail=f"Unknown features: {', '.join(unknown)}")
        if update.get("limit_overrides"):
            unknown = [k for k in update["limit_overrides"] if k not in ("max_staff", "max_products", "max_locations")]
            if unknown:
                raise HTTPException(status_code=422, detail=f"Unknown limits: {', '.join(unknown)}")
        if update.get("status") == "active" and "status_reason" not in update:
            update["status_reason"] = None
        for key, value in update.items():
            setattr(config, key, value)
        audit.record_platform(db, user, "business.update", tenant_id=business_id, details={k: v for k, v in update.items()})
        await db.commit()
    await _drop_tenant_cache(business_id)
    return await business_detail(business_id, user)

@router.post("/businesses/{business_id}/reset-owner-password")
async def reset_owner_password(business_id: uuid.UUID, user: PlatformUser = Depends(require_super_admin)):
    password = _temp_password()
    async with get_shared_session_maker()() as db:
        owner = (await db.execute(select(TenantUser).where(TenantUser.tenant_id == business_id, TenantUser.role == "owner", TenantUser.is_active == True)
                                  .order_by(TenantUser.created_at))).scalars().first()
        if owner is None:
            raise HTTPException(status_code=404, detail="This business has no active owner")
        account = (await db.execute(select(GlobalUser).where(func.lower(GlobalUser.email) == owner.username.lower()))).scalars().first()
        hashed = await hash_password_async(password)
        owner.password_hash = hashed
        if account:
            account.password_hash = hashed
        audit.record_platform(db, user, "business.reset_owner_password", tenant_id=business_id, details={"owner": owner.username})
        await db.commit()
    return {"owner_email": owner.username, "temporary_password": password}

# --- Subscriptions / payments -----------------------------------------------------------------------------------

class SubscriptionIn(BaseModel):
    plan_key: str = Field(max_length=40)
    months: int = Field(1, ge=1, le=60)
    start_date: datetime | None = None  # default: continue from the current paid-until date (or today)
    amount_paid: float = Field(0, ge=0, le=10_000_000)
    payment_method: Literal["upi", "bank_transfer", "cash", "card", "cheque", "free", "other"] = "upi"
    payment_reference: str | None = Field(None, max_length=100)
    note: str | None = Field(None, max_length=300)
    offer_code: str | None = Field(None, max_length=40)
    kind: Literal["paid", "complimentary", "trial"] = "paid"
    extra_days: int = Field(0, ge=0, le=365)  # goodwill days on top

@router.post("/businesses/{business_id}/subscriptions")
async def record_subscription(business_id: uuid.UUID, data: SubscriptionIn, user: PlatformUser = Depends(require_super_admin)):
    """Record a payment / renewal (or a complimentary period). The plan's features and limits are snapshotted so later plan edits
    don't change what was sold; a locked business is switched back on immediately."""
    async with get_shared_session_maker()() as db:
        await _ensure_plans(db)
        await _load_business(db, business_id)
        plan = await db.get(Plan, data.plan_key)
        if plan is None:
            raise HTTPException(status_code=404, detail="Plan not found")
        offer = None
        if data.offer_code:
            offer = await subs.find_offer(db, code=data.offer_code)
            if offer is None:
                raise HTTPException(status_code=404, detail="No subscription offer with this code")
        result = await subs.record_subscription(
            db, business_id, plan, data.months, amount_paid=data.amount_paid, method=data.payment_method, recorded_by=user.email,
            kind=data.kind, reference=data.payment_reference, note=data.note, offer=offer,
            start=_utc_naive(data.start_date) if data.start_date else None,
            days=30 * data.months + data.extra_days if data.extra_days else None)
        audit.record_platform(db, user, "subscription.record", tenant_id=business_id,
                              details={"plan": plan.key, "amount": data.amount_paid, "months": data.months, "kind": data.kind,
                                       "offer": data.offer_code, "paid_until": result["paid_until"]})
        await db.commit()
    await _drop_tenant_cache(business_id)
    return result

class QuoteIn(BaseModel):
    plan_key: str = Field(max_length=40)
    months: int = Field(ge=1, le=60)
    offer_code: str | None = Field(None, max_length=40)

@router.post("/businesses/{business_id}/quote")
async def business_quote(business_id: uuid.UUID, data: QuoteIn, user: PlatformUser = Depends(get_platform_user)):
    async with get_shared_session_maker()() as db:
        return await subs.quote(db, business_id, data.plan_key, data.months, data.offer_code)

# --- Plans ---------------------------------------------------------------------------------------------------------

class PlanIn(BaseModel):
    key: str = Field(pattern=r"^[a-z0-9_]{2,40}$")
    name: str = Field(min_length=2, max_length=60)
    description: str | None = Field(None, max_length=300)
    price_monthly: float = Field(0, ge=0, le=1_000_000)
    features: list[str] = Field(default_factory=list)
    limits: dict[str, int | None] = Field(default_factory=dict)
    is_active: bool = True
    sort_order: int = 0
    billing_options: list[dict] | None = None  # [{"months": 12, "price": 4990, "label": "Yearly"}]; empty = monthly × months

def _clean_options(options: list[dict] | None) -> list[dict] | None:
    if not options:
        return None
    out, seen = [], set()
    for o in options:
        try:
            months = int(o["months"])
            price = None if o.get("price") in (None, "") else round(float(o["price"]), 2)
        except (KeyError, TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Each pricing option needs months and a price")
        if not 1 <= months <= 60 or months in seen or (price is not None and not 0 <= price <= 10_000_000):
            raise HTTPException(status_code=422, detail="Pricing options: 1–60 months, each once, price 0 or more")
        seen.add(months)
        out.append({"months": months, "price": price, "label": (str(o.get("label") or "").strip()[:40] or None)})
    return sorted(out, key=lambda x: x["months"])

def _serialize_plan(p: Plan, counts: dict) -> dict:
    return {"key": p.key, "name": p.name, "description": p.description, "price_monthly": float(p.price_monthly),
            "features": sorted(p.features or []), "limits": p.limits or {}, "is_active": p.is_active, "sort_order": p.sort_order,
            "billing_options": p.billing_options or [], "price_options": subs.price_options(p),
            "businesses": int(counts.get(p.key, 0))}

@router.get("/plans")
async def list_plans(user: PlatformUser = Depends(get_platform_user)):
    async with get_shared_session_maker()() as db:
        await _ensure_plans(db)
        await db.commit()
        plans = (await db.execute(select(Plan).order_by(Plan.sort_order, Plan.name))).scalars().all()
        counts = dict(await _count_by_plan(db, TenantConfig.status != "deleted"))
    return {"plans": [_serialize_plan(p, counts) for p in plans], "features": [{"key": k, "name": v} for k, v in FEATURES.items()]}

@router.post("/plans")
async def save_plan(data: PlanIn, user: PlatformUser = Depends(require_super_admin)):
    unknown = [f for f in data.features if f not in ALL_FEATURES]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown features: {', '.join(unknown)}")
    async with get_shared_session_maker()() as db:
        plan = await db.get(Plan, data.key)
        if plan is None:
            plan = Plan(key=data.key)
            db.add(plan)
        plan.name, plan.description, plan.price_monthly = data.name, data.description, data.price_monthly
        plan.features, plan.limits, plan.is_active, plan.sort_order = sorted(set(data.features)), data.limits, data.is_active, data.sort_order
        if "billing_options" in data.model_fields_set:  # leaving it out keeps the current options
            plan.billing_options = _clean_options(data.billing_options)
        audit.record_platform(db, user, "plan.save", details={"key": data.key, "features": plan.features})
        await db.commit()
    invalidate()  # plan changes affect every business on it
    return (await list_plans(user))

# --- GST rate library -----------------------------------------------------------------------------------------------

@router.get("/tax/presets")
async def tax_presets(user: PlatformUser = Depends(get_platform_user)):
    async with get_shared_session_maker()() as db:
        await ensure_platform_presets(db)
        await db.commit()
        presets = (await db.execute(select(TaxPreset).order_by(TaxPreset.sort_order))).scalars().all()
        rates = (await db.execute(select(TaxPresetRate).order_by(TaxPresetRate.effective_from))).scalars().all()
    now = datetime.utcnow()
    out = []
    for p in presets:
        versions = [r for r in rates if r.preset_key == p.key]
        current = max((r for r in versions if r.effective_from <= now), key=lambda r: r.effective_from, default=None)
        out.append({"key": p.key, "name": p.name, "hsn_sac": p.hsn_sac, "description": p.description, "is_active": p.is_active,
                    "current_rate": float(current.total_rate) if current else None,
                    "versions": [{"id": str(r.id), "effective_from": r.effective_from.isoformat() + "Z", "total_rate": float(r.total_rate),
                                  "components": r.components, "note": r.note, "upcoming": r.effective_from > now} for r in versions]})
    return out

class PresetIn(BaseModel):
    key: str = Field(pattern=r"^[A-Z0-9_]{2,40}$")
    name: str = Field(min_length=2, max_length=80)
    hsn_sac: str | None = Field(None, max_length=12)
    description: str | None = Field(None, max_length=300)
    rate: float = Field(ge=0, le=100)
    effective_from: datetime

@router.post("/tax/presets")
async def create_preset(data: PresetIn, user: PlatformUser = Depends(require_super_admin)):
    async with get_shared_session_maker()() as db:
        if await db.get(TaxPreset, data.key) is not None:
            raise HTTPException(status_code=409, detail="A preset with this key exists")
        db.add(TaxPreset(key=data.key, name=data.name, hsn_sac=data.hsn_sac, description=data.description, sort_order=100))
        await db.flush()
        db.add(TaxPresetRate(preset_key=data.key, effective_from=_utc_naive(data.effective_from), components=split_gst(data.rate),
                             total_rate=data.rate, note="Initial rate"))
        audit.record_platform(db, user, "tax.preset_create", details=data.model_dump(mode="json"))
        await db.commit()
    return await tax_presets(user)

class PresetRateIn(BaseModel):
    rate: float = Field(ge=0, le=100)
    effective_from: datetime
    note: str | None = Field(None, max_length=300)  # e.g. notification number

@router.post("/tax/presets/{key}/rates")
async def publish_rate(key: str, data: PresetRateIn, user: PlatformUser = Depends(require_super_admin)):
    """Government changed a rate: publish it with its effective date. Every business class following this preset gets
    the new rate scheduled automatically; bills switch at that moment and older bills keep their original GST."""
    effective = _utc_naive(data.effective_from)
    async with get_shared_session_maker()() as db:
        try:
            result = await publish_preset_rate(db, key, effective, Decimal(str(data.rate)), None, data.note)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        audit.record_platform(db, user, "tax.publish_rate", details={"preset": key, "rate": data.rate,
                                                                     "effective_from": effective.isoformat(), **result})
        await db.commit()
    return {"preset": key, "rate": data.rate, "effective_from": effective.isoformat() + "Z", **result}

# --- Audit -------------------------------------------------------------------------------------------------------------

@router.get("/audit")
async def platform_audit(business_id: uuid.UUID | None = None, limit: int = Query(100, ge=1, le=500),
                         user: PlatformUser = Depends(get_platform_user)):
    async with get_shared_session_maker()() as db:
        query = select(PlatformAuditLog).order_by(PlatformAuditLog.created_at.desc()).limit(limit)
        if business_id:
            query = query.where(PlatformAuditLog.target_tenant_id == business_id)
        rows = (await db.execute(query)).scalars().all()
    return [{"id": str(r.id), "actor_email": r.actor_email, "action": r.action, "business_id": str(r.target_tenant_id) if r.target_tenant_id else None,
             "details": r.details, "created_at": r.created_at.isoformat() + "Z"} for r in rows]


# --- Demo & development access ---------------------------------------------------------------------------------------

class DemoIn(BaseModel):
    days: int = Field(ge=1, le=365)
    plan_key: str | None = Field(None, max_length=40)  # which plan's features the demo shows (default: the business's plan)
    note: str | None = Field(None, max_length=200)

@router.post("/businesses/{business_id}/demo")
async def give_demo(business_id: uuid.UUID, data: DemoIn, user: PlatformUser = Depends(require_super_admin)):
    """Give (or extend) a free demo of N days — unlocks a locked business straight away."""
    async with get_shared_session_maker()() as db:
        await _ensure_plans(db)
        await _load_business(db, business_id)
        if data.plan_key and await db.get(Plan, data.plan_key) is None:
            raise HTTPException(status_code=404, detail="Plan not found")
        result = await subs.start_trial(db, business_id, plan_key=data.plan_key, days=data.days, recorded_by=user.email,
                                        note=data.note or f"{data.days}-day demo given by Tallyko")
        audit.record_platform(db, user, "subscription.demo", tenant_id=business_id, details={"days": data.days, "plan": data.plan_key})
        await db.commit()
    await _drop_tenant_cache(business_id)
    return result

class DevelopmentIn(BaseModel):
    enabled: bool
    note: str | None = Field(None, max_length=200)

@router.post("/businesses/{business_id}/development")
async def development_access(business_id: uuid.UUID, data: DevelopmentIn, user: PlatformUser = Depends(require_super_admin)):
    """Development access: the business works with no expiry until this is switched off (testing, pilots)."""
    async with get_shared_session_maker()() as db:
        await _load_business(db, business_id)
        await subs.set_development_access(db, business_id, data.enabled, user.email, data.note)
        audit.record_platform(db, user, "subscription.development", tenant_id=business_id, details={"enabled": data.enabled, "note": data.note})
        await db.commit()
    await _drop_tenant_cache(business_id)
    return await business_detail(business_id, user)

# --- Subscription offers (promotions on Tallyko plans) ------------------------------------------------------------------

class SubOfferIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(None, max_length=300)
    code: str | None = Field(None, pattern=r"^$|^[A-Za-z0-9_-]{3,30}$")
    discount_type: Literal["percent", "flat", "none"] = "percent"
    discount_value: float = Field(0, ge=0, le=1_000_000)
    extra_days: int = Field(0, ge=0, le=730)
    plan_keys: list[str] | None = None
    min_months: int = Field(1, ge=1, le=60)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_redemptions: int | None = Field(None, ge=1)
    new_businesses_only: bool = False
    show_to_owners: bool = True
    is_active: bool = True

def _apply_sub_offer(offer: SubscriptionOffer, data: SubOfferIn) -> None:
    if data.discount_type == "percent" and data.discount_value > 100:
        raise HTTPException(status_code=422, detail="A percentage can't be more than 100")
    if data.discount_type == "none" and not data.extra_days:
        raise HTTPException(status_code=422, detail="Give a discount or extra free days")
    if data.starts_at and data.ends_at and data.ends_at <= data.starts_at:
        raise HTTPException(status_code=422, detail="The offer must end after it starts")
    for key, value in data.model_dump().items():
        setattr(offer, key, value)
    offer.code = (data.code or "").upper() or None
    offer.starts_at = _utc_naive(data.starts_at) if data.starts_at else None
    offer.ends_at = _utc_naive(data.ends_at) if data.ends_at else None
    offer.plan_keys = sorted(set(data.plan_keys)) if data.plan_keys else None

@router.get("/subscription-offers")
async def list_sub_offers(user: PlatformUser = Depends(get_platform_user)):
    async with get_shared_session_maker()() as db:
        rows = (await db.execute(select(SubscriptionOffer).order_by(SubscriptionOffer.is_active.desc(), SubscriptionOffer.created_at.desc()))).scalars().all()
    return [subs.serialize_offer(o) for o in rows]

async def _save_sub_offer(db, offer: SubscriptionOffer, data: SubOfferIn, user: PlatformUser, action: str) -> dict:
    _apply_sub_offer(offer, data)
    unknown = [k for k in (offer.plan_keys or []) if await db.get(Plan, k) is None]
    if unknown:
        raise HTTPException(status_code=404, detail=f"Unknown plans: {', '.join(unknown)}")
    if offer.code and (await db.execute(select(SubscriptionOffer.id).where(SubscriptionOffer.code == offer.code,
                                                                           SubscriptionOffer.id != offer.id))).first():
        raise HTTPException(status_code=409, detail="Another offer uses this code")
    audit.record_platform(db, user, action, details={"name": offer.name, "code": offer.code, "summary": subs.describe_offer(offer)})
    await db.commit()
    return subs.serialize_offer(offer)

@router.post("/subscription-offers")
async def create_sub_offer(data: SubOfferIn, user: PlatformUser = Depends(require_super_admin)):
    async with get_shared_session_maker()() as db:
        offer = SubscriptionOffer(id=uuid.uuid4())
        db.add(offer)
        return await _save_sub_offer(db, offer, data, user, "subscription_offer.create")

@router.put("/subscription-offers/{offer_id}")
async def update_sub_offer(offer_id: uuid.UUID, data: SubOfferIn, user: PlatformUser = Depends(require_super_admin)):
    async with get_shared_session_maker()() as db:
        offer = await db.get(SubscriptionOffer, offer_id)
        if offer is None:
            raise HTTPException(status_code=404, detail="Offer not found")
        return await _save_sub_offer(db, offer, data, user, "subscription_offer.update")

# --- Payment requests ("I've paid" from the renewal screen) -------------------------------------------------------------

@router.get("/subscription-requests")
async def list_payment_requests(response: Response, status: str | None = Query("pending", pattern="^(pending|approved|rejected|all)$"),
                                q: str | None = Query(None, max_length=80), limit: int = Query(100, ge=1, le=500),
                                offset: int = Query(0, ge=0), user: PlatformUser = Depends(get_platform_user)):
    async with get_shared_session_maker()() as db:
        query = select(SubscriptionRequest, GlobalVendor.name).join(GlobalVendor, GlobalVendor.id == SubscriptionRequest.vendor_id)
        if status != "all":
            query = query.where(SubscriptionRequest.status == status)
        if q:
            like = f"%{q.strip()}%"
            query = query.where(or_(GlobalVendor.name.ilike(like), SubscriptionRequest.reference.ilike(like), SubscriptionRequest.requested_by.ilike(like)))
        import json
        response.headers["X-Total-Count"] = str((await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
        by_status = dict((await db.execute(select(SubscriptionRequest.status, func.count()).group_by(SubscriptionRequest.status))).all())
        response.headers["X-Counts"] = json.dumps({**{k: int(v) for k, v in by_status.items()}, "all": int(sum(by_status.values()))})
        rows = (await db.execute(query.order_by(SubscriptionRequest.created_at.desc()).limit(limit).offset(offset))).all()
        quotes = {}
        for r, _ in rows:
            if r.status == "pending":
                q = await subs.quote(db, r.vendor_id, r.plan_key, r.months, r.offer_code)
                quotes[r.id] = {"expected_amount": q["amount"], "offer_error": q["offer_error"]}
    return [{"id": str(r.id), "business_id": str(r.vendor_id), "business_name": name, "plan_key": r.plan_key, "months": r.months,
             "offer_code": r.offer_code, "amount": float(r.amount), "method": r.method, "reference": r.reference, "note": r.note,
             "status": r.status, "requested_by": r.requested_by, "reviewed_by": r.reviewed_by, "review_note": r.review_note,
             "created_at": r.created_at.isoformat() + "Z", "reviewed_at": r.reviewed_at.isoformat() + "Z" if r.reviewed_at else None,
             **quotes.get(r.id, {})} for r, name in rows]

class ReviewIn(BaseModel):
    note: str | None = Field(None, max_length=300)
    amount_paid: float | None = Field(None, ge=0, le=10_000_000)  # what actually arrived (defaults to the claimed amount)
    ignore_offer: bool = False  # the claimed offer has ended / is used up: approve at the amount paid without it

@router.post("/subscription-requests/{request_id}/approve")
async def approve_payment(request_id: uuid.UUID, data: ReviewIn, user: PlatformUser = Depends(require_super_admin)):
    async with get_shared_session_maker()() as db:
        req = await db.get(SubscriptionRequest, request_id)
        if req is None:
            raise HTTPException(status_code=404, detail="Request not found")
        if req.status != "pending":
            raise HTTPException(status_code=409, detail=f"This request was already {req.status}")
        plan = await db.get(Plan, req.plan_key)
        offer = await subs.find_offer(db, code=req.offer_code) if req.offer_code and not data.ignore_offer else None
        result = await subs.record_subscription(db, req.vendor_id, plan, req.months,
                                                amount_paid=data.amount_paid if data.amount_paid is not None else float(req.amount),
                                                method=req.method, recorded_by=user.email, reference=req.reference,
                                                note=data.note or req.note, offer=offer)
        req.status, req.reviewed_by, req.review_note, req.reviewed_at = "approved", user.email, data.note, datetime.utcnow()
        audit.record_platform(db, user, "subscription.approve_request", tenant_id=req.vendor_id,
                              details={"reference": req.reference, "amount": float(req.amount), "paid_until": result["paid_until"]})
        await db.commit()
    await _drop_tenant_cache(req.vendor_id)
    return {"status": "approved", **result}

@router.post("/subscription-requests/{request_id}/reject")
async def reject_payment(request_id: uuid.UUID, data: ReviewIn, user: PlatformUser = Depends(require_super_admin)):
    if not (data.note or "").strip():
        raise HTTPException(status_code=422, detail="Tell the owner why (shown on their renewal screen)")
    async with get_shared_session_maker()() as db:
        req = await db.get(SubscriptionRequest, request_id)
        if req is None or req.status != "pending":
            raise HTTPException(status_code=409, detail="Only pending requests can be rejected")
        req.status, req.reviewed_by, req.review_note, req.reviewed_at = "rejected", user.email, data.note.strip(), datetime.utcnow()
        audit.record_platform(db, user, "subscription.reject_request", tenant_id=req.vendor_id, details={"reference": req.reference, "note": data.note})
        await db.commit()
    return {"status": "rejected"}

# --- Sessions (signed-in devices) -------------------------------------------------------------------------------------

@router.get("/businesses/{business_id}/sessions")
async def business_sessions(business_id: uuid.UUID, include_ended: bool = False, user: PlatformUser = Depends(get_platform_user)):
    async with get_shared_session_maker()() as db:
        query = select(UserSession).where(UserSession.tenant_id == business_id)
        if not include_ended:
            query = query.where(UserSession.revoked_at.is_(None))
        rows = (await db.execute(query.order_by(UserSession.last_seen_at.desc().nullslast()).limit(200))).scalars().all()
        staff = {s.id: s for s in (await db.execute(select(TenantUser).where(TenantUser.tenant_id == business_id))).scalars().all()}
    out = []
    for r in rows:
        member = staff.get(r.staff_id)
        out.append({**session_service.serialize_session(r), "name": (member.full_name or member.username) if member else None,
                    "email": member.username if member else None, "role": member.role if member else None})
    return out

class SignOutIn(BaseModel):
    reason: str = Field("Signed out by Tallyko", min_length=2, max_length=120)

@router.post("/businesses/{business_id}/sign-out")
async def sign_out_business(business_id: uuid.UUID, data: SignOutIn, user: PlatformUser = Depends(require_super_admin)):
    """Sign out every device of a business now. Bills waiting on a device stay there and sync after the next sign-in."""
    async with get_shared_session_maker()() as db:
        await _load_business(db, business_id)
        count = await session_service.sign_out_business(db, business_id, data.reason)
        audit.record_platform(db, user, "business.sign_out", tenant_id=business_id, details={"devices": count, "reason": data.reason})
        await db.commit()
    return {"signed_out": count}

@router.post("/sessions/{session_id}/revoke")
async def revoke_session(session_id: uuid.UUID, data: SignOutIn, user: PlatformUser = Depends(require_super_admin)):
    async with get_shared_session_maker()() as db:
        row = await db.get(UserSession, session_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Session not found")
        count = await session_service.revoke(db, reason=data.reason, session_ids=[session_id])
        audit.record_platform(db, user, "session.revoke", tenant_id=row.tenant_id, details={"device": row.device, "reason": data.reason})
        await db.commit()
    return {"signed_out": count}

# --- Platform settings & jobs -----------------------------------------------------------------------------------------

class PaymentSettings(BaseModel):
    upi_id: str = Field("", max_length=80)
    payee_name: str = Field("Tallyko", max_length=80)
    bank_details: str = Field("", max_length=400)
    support_phone: str = Field("", max_length=30)
    support_email: str = Field("", max_length=120)
    instructions: str = Field("", max_length=600)

class PlatformSettingsIn(BaseModel):
    trial_days: int = Field(7, ge=0, le=365)  # free demo for new businesses; 0 = none
    grace_days: int = Field(0, ge=0, le=60)  # days a business keeps working after its paid period ends
    reminder_days: int = Field(7, ge=0, le=60)
    payment: PaymentSettings

@router.get("/settings")
async def platform_settings(user: PlatformUser = Depends(get_platform_user)):
    data = await subs.get_platform_settings(fresh=True)
    return {k: v for k, v in data.items() if not k.startswith("jobs.")}

@router.put("/settings")
async def save_platform_settings(data: PlatformSettingsIn, user: PlatformUser = Depends(require_super_admin)):
    async with get_shared_session_maker()() as db:
        for key, value in data.model_dump().items():
            await subs.save_platform_setting(db, key, value)
        audit.record_platform(db, user, "platform.settings", details=data.model_dump())
        await db.commit()
    return await platform_settings(user)

@router.get("/jobs")
async def jobs(user: PlatformUser = Depends(get_platform_user)):
    settings_data = await subs.get_platform_settings(fresh=True)
    return {"subscription_check": {"schedule": "Every day at 01:00 India time", "next_run_at": subs.next_run_utc().isoformat() + "Z",
                                   "last_run": settings_data.get(subs.JOB_KEY), "enabled": subs.scheduler_enabled()}}

@router.post("/jobs/subscription-check")
async def run_subscription_check_now(user: PlatformUser = Depends(require_super_admin)):
    result = await subs.run_subscription_check(actor=f"{user.email} (run now)")
    async with get_shared_session_maker()() as db:
        audit.record_platform(db, user, "jobs.subscription_check", details={k: v for k, v in result.items() if k != "locked_business_ids"})
        await db.commit()
    return result


# --- Business records: archive / permanently delete (only Tallyko can; businesses never delete) ------------------------

@router.get("/businesses/{business_id}/orders")
async def business_orders(business_id: uuid.UUID, q: str | None = Query(None, max_length=60),
                          status: str | None = Query(None, pattern="^(placed|open|completed|cancelled|merged)$"),
                          include_archived: bool = True, limit: int = Query(100, ge=1, le=500),
                          ids: str | None = Query(None, max_length=20000, description="comma-separated bill ids"),
                          user: PlatformUser = Depends(get_platform_user)):
    order_ids = None
    if ids:
        try:
            order_ids = [uuid.UUID(x.strip()) for x in ids.split(",") if x.strip()][:500]
        except ValueError:
            raise HTTPException(status_code=422, detail="Bad bill id")
    async with get_shared_session_maker()() as db:
        return await records_admin.search_orders(db, business_id, q, status, include_archived, limit, order_ids)

class RecordsAction(BaseModel):
    order_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    reason: str = Field(min_length=3, max_length=200)
    confirm: str | None = None  # "DELETE" for permanent deletion

async def _do_records(business_id, data: RecordsAction, action: str, user: PlatformUser) -> dict:
    if action == "delete" and data.confirm != "DELETE":
        raise HTTPException(status_code=422, detail='Type DELETE to confirm permanent deletion')
    async with get_shared_session_maker()() as db:
        await _load_business(db, business_id)
        owned = {oid for (oid,) in (await db.execute(select(Order.id).where(Order.tenant_id == business_id, Order.id.in_(data.order_ids)))).all()}
        if not owned:
            raise HTTPException(status_code=404, detail="None of these bills exist for this business (already deleted?)")
        missing = [str(o) for o in data.order_ids if o not in owned]
        data = RecordsAction(order_ids=[o for o in data.order_ids if o in owned], reason=data.reason, confirm=data.confirm)
        if action == "delete":
            snapshots = await records_admin.hard_delete_orders(db, business_id, data.order_ids, data.reason)
        else:
            snapshots = await records_admin.archive_orders(db, business_id, data.order_ids, data.reason, undo=action == "unarchive")
        audit.record_platform(db, user, f"records.{action}", tenant_id=business_id, details={"reason": data.reason, "bills": snapshots})
        await db.commit()
    invoices = [s["invoice_no"] for s in snapshots if s.get("invoice_no")]
    return {action: len(snapshots), "skipped_missing": missing, "warning": ("Deleted tax invoices leave gaps in the invoice number series; keep this "
                                                "record for GST purposes.") if action == "delete" and invoices else None}

@router.post("/businesses/{business_id}/orders/archive")
async def archive_bills(business_id: uuid.UUID, data: RecordsAction, user: PlatformUser = Depends(require_super_admin)):
    return await _do_records(business_id, data, "archive", user)

@router.post("/businesses/{business_id}/orders/unarchive")
async def unarchive_bills(business_id: uuid.UUID, data: RecordsAction, user: PlatformUser = Depends(require_super_admin)):
    return await _do_records(business_id, data, "unarchive", user)

@router.post("/businesses/{business_id}/orders/delete")
async def delete_bills(business_id: uuid.UUID, data: RecordsAction, user: PlatformUser = Depends(require_super_admin)):
    """Permanent. Stock, loyalty and offer usage are reversed first; a full snapshot stays in the platform audit log."""
    return await _do_records(business_id, data, "delete", user)

@router.get("/owner-requests")
async def owner_requests(response: Response, status: str = Query("pending", pattern="^(pending|done|rejected|all)$"), q: str | None = Query(None, max_length=80), limit: int = Query(100, ge=1, le=500),
                                offset: int = Query(0, ge=0), user: PlatformUser = Depends(get_platform_user)):
    async with get_shared_session_maker()() as db:
        query = select(OwnerRequest, GlobalVendor.name).join(GlobalVendor, GlobalVendor.id == OwnerRequest.vendor_id)
        if status != "all":
            query = query.where(OwnerRequest.status == status)
        if q:
            like = f"%{q.strip()}%"
            query = query.where(or_(GlobalVendor.name.ilike(like), OwnerRequest.message.ilike(like), OwnerRequest.requested_by.ilike(like)))
        import json
        response.headers["X-Total-Count"] = str((await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
        by_status = dict((await db.execute(select(OwnerRequest.status, func.count()).group_by(OwnerRequest.status))).all())
        response.headers["X-Counts"] = json.dumps({**{k: int(v) for k, v in by_status.items()}, "all": int(sum(by_status.values()))})
        rows = (await db.execute(query.order_by(OwnerRequest.created_at.desc()).limit(limit).offset(offset))).all()
    return [{"id": str(r.id), "business_id": str(r.vendor_id), "business_name": name, "kind": r.kind, "order_ids": r.order_ids or [],
             "message": r.message, "status": r.status, "requested_by": r.requested_by, "handled_by": r.handled_by,
             "action_taken": r.action_taken, "response": r.response, "created_at": r.created_at.isoformat() + "Z",
             "handled_at": r.handled_at.isoformat() + "Z" if r.handled_at else None} for r, name in rows]

class ResolveIn(BaseModel):
    action: Literal["archive", "delete", "none"]
    response: str = Field(min_length=2, max_length=500)  # shown to the owner
    confirm: str | None = None

@router.post("/owner-requests/{request_id}/resolve")
async def resolve_owner_request(request_id: uuid.UUID, data: ResolveIn, user: PlatformUser = Depends(require_super_admin)):
    async with get_shared_session_maker()() as db:
        req = await db.get(OwnerRequest, request_id)
        if req is None or req.status != "pending":
            raise HTTPException(status_code=409, detail="Only pending requests can be resolved")
        vendor_id, order_ids = req.vendor_id, [uuid.UUID(o) for o in (req.order_ids or [])]
    result = {}
    if data.action in ("archive", "delete") and order_ids:
        result = await _do_records(vendor_id, RecordsAction(order_ids=order_ids, reason=f"Owner request: {data.response}"[:200],
                                                            confirm=data.confirm), data.action, user)
    async with get_shared_session_maker()() as db:
        req = await db.get(OwnerRequest, request_id)
        req.status = "done" if data.action != "none" else "rejected"
        req.action_taken = {"archive": "archived", "delete": "deleted"}.get(data.action, "none")
        req.response, req.handled_by, req.handled_at = data.response, user.email, datetime.utcnow()
        audit.record_platform(db, user, "owner_request.resolve", tenant_id=vendor_id, details={"action": data.action, "response": data.response})
        await db.commit()
    return {"status": req.status, **result}
