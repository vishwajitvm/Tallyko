"""Business settings, sales channels (aggregators), cloud-kitchen brands and staff accounts."""
import secrets
import uuid
from typing import Literal
from fastapi import Query, APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import or_, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.catalog import FEATURES
from app.core.security import get_password_hash, hash_password_async
from app.core.tenant import get_tenant_db, get_shared_session_maker
from app.models import BusinessSettings, SalesChannel, Brand, GlobalUser, TenantUser, Role, TaxClass, Location
from app.services import audit
from app.services.access import Access, check_limit, entitlements, get_access, invalidate, require
from app.services.settings_service import get_settings, ensure_channels, get_channel
from app.schemas.billing import PHONE_PATTERN
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(tags=["Admin"])

# --- Settings ---

class SettingsUpdate(BaseModel):
    business_name: str | None = Field(None, min_length=1, max_length=100)
    business_type: Literal["restaurant", "retail", "cloud_kitchen", "cafe"] | None = None
    address: str | None = Field(None, max_length=300)
    phone: str | None = Field(None, max_length=20)
    email: EmailStr | None = None
    gstin: str | None = Field(None, max_length=20)  # validated (format, state code, check character) in update_settings
    fssai: str | None = Field(None, pattern=r"^$|^[0-9]{14}$")
    upi_id: str | None = Field(None, pattern=r"^$|^[A-Za-z0-9._\-]{2,64}@[A-Za-z]{2,32}$")
    currency_symbol: str | None = Field(None, min_length=1, max_length=4)
    prices_include_tax: bool | None = None
    default_tax_rate: float | None = Field(None, ge=0, le=40)
    gst_registration: Literal["regular", "composition", "unregistered"] | None = None
    default_tax_class_id: uuid.UUID | None = None
    invoice_prefix: str | None = Field(None, pattern=r"^[A-Za-z0-9\-]{1,10}$")
    receipt_footer: str | None = Field(None, max_length=300)
    loyalty_enabled: bool | None = None
    loyalty_points_per_100: int | None = Field(None, ge=0, le=100)
    loyalty_point_value: float | None = Field(None, ge=0, le=100)
    store_enabled: bool | None = None
    qr_ordering_enabled: bool | None = None
    qr_payment_mode: Literal["counter", "upi", "both"] | None = None
    ops_thresholds: dict[str, int] | None = None  # floor alert minutes, see OPS_DEFAULTS
    low_stock_default: int | None = Field(None, ge=0, le=100000)
    email_enabled: bool | None = None
    email_sender_name: str | None = Field(None, max_length=80)
    email_reply_to: EmailStr | None = None

# Floor screens' warning times (minutes): table seated, kitchen ticket age, online order waiting to be accepted
OPS_DEFAULTS = {"table_amber_min": 45, "table_red_min": 75, "kitchen_amber_min": 10, "kitchen_red_min": 20, "online_wait_min": 3}

def _clean_thresholds(raw: dict) -> dict:
    unknown = [k for k in raw if k not in OPS_DEFAULTS]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown alert settings: {', '.join(unknown)}")
    if any(not 1 <= int(v) <= 600 for v in raw.values()):
        raise HTTPException(status_code=422, detail="Alert times must be between 1 and 600 minutes")
    merged = {**OPS_DEFAULTS, **raw}
    if merged["table_red_min"] <= merged["table_amber_min"] or merged["kitchen_red_min"] <= merged["kitchen_amber_min"]:
        raise HTTPException(status_code=422, detail="The red alert must come after the amber one")
    return {k: int(v) for k, v in raw.items()}

def _charges_gst(s) -> bool:
    from app.core.gstin import charges_gst
    return charges_gst(s.gst_registration, s.gstin)

def _gstin_state(s) -> str | None:
    from app.core.gstin import state_of
    return state_of(s.gstin)

def serialize_settings(s: BusinessSettings) -> dict:
    return {
        "tenant_id": str(s.tenant_id), "business_name": s.business_name, "business_type": s.business_type, "address": s.address,
        "phone": s.phone, "email": s.email, "gstin": s.gstin, "fssai": s.fssai, "upi_id": s.upi_id,
        "currency_symbol": s.currency_symbol, "prices_include_tax": s.prices_include_tax, "default_tax_rate": float(s.default_tax_rate),
        "gst_registration": s.gst_registration, "charges_gst": _charges_gst(s), "gstin_state": _gstin_state(s), "default_tax_class_id": str(s.default_tax_class_id) if s.default_tax_class_id else None,
        "invoice_prefix": s.invoice_prefix, "receipt_footer": s.receipt_footer, "loyalty_enabled": s.loyalty_enabled,
        "loyalty_points_per_100": s.loyalty_points_per_100, "loyalty_point_value": float(s.loyalty_point_value),
        "store_enabled": s.store_enabled, "qr_ordering_enabled": s.qr_ordering_enabled, "qr_payment_mode": s.qr_payment_mode,
        "ops_thresholds": {**OPS_DEFAULTS, **(s.ops_thresholds or {})}, "low_stock_default": s.low_stock_default,
        "email_enabled": s.email_enabled, "email_sender_name": s.email_sender_name, "email_reply_to": s.email_reply_to,
        "disabled_modules": s.disabled_modules or [],
    }

@router.get("/settings")
async def read_settings(access: Access = Depends(get_access), db: AsyncSession = Depends(get_tenant_db)):
    settings = await get_settings(db, access.tenant_id)
    await db.commit()
    return serialize_settings(settings)

@router.put("/settings")
async def update_settings(data: SettingsUpdate, access: Access = Depends(require("settings.manage")), db: AsyncSession = Depends(get_tenant_db)):
    settings = await get_settings(db, access.tenant_id)
    update = data.model_dump(exclude_unset=True)
    if update.get("default_tax_class_id"):
        found = await db.execute(select(TaxClass.id).where(TaxClass.id == update["default_tax_class_id"], TaxClass.tenant_id == access.tenant_id))
        if found.first() is None:
            raise HTTPException(status_code=404, detail="Tax class not found")
    if "gstin" in update or "gst_registration" in update:
        from app.core import gstin as gst
        if "gstin" in update:
            update["gstin"] = gst.normalize(update["gstin"])
            if update["gstin"]:
                ok, error = gst.validate(update["gstin"])
                if not ok:
                    raise HTTPException(status_code=422, detail=error)
        registration = update.get("gst_registration") or settings.gst_registration
        number = update["gstin"] if "gstin" in update else settings.gstin
        if registration in ("regular", "composition") and not gst.is_valid(number):
            raise HTTPException(status_code=422, detail="Enter your GSTIN to bill as a GST-registered business, "
                                                        "or choose “Not registered”")
    if update.get("qr_ordering_enabled") and not access.has("qr_ordering"):
        raise HTTPException(status_code=403, detail=f"{FEATURES['qr_ordering']} isn't included in your plan")
    if "ops_thresholds" in update:
        update["ops_thresholds"] = _clean_thresholds(update["ops_thresholds"] or {}) or None
    if update.get("qr_payment_mode") in ("upi", "both") and not (update.get("upi_id") or settings.upi_id):
        raise HTTPException(status_code=422, detail="Add your shop's UPI ID first so customers can pay by UPI")
    if update.get("store_enabled") and not access.has("online_store"):
        raise HTTPException(status_code=403, detail=f"{FEATURES['online_store']} isn't included in your plan")
    for key, value in update.items():
        if isinstance(value, str):
            value = value.strip() or None
            if key in ("business_name", "currency_symbol", "invoice_prefix") and value is None:
                continue
            if key == "gstin" and value:
                value = value.upper()
        setattr(settings, key, value)
    # Keep the public channels in step with the store / QR switches
    for code, enabled in (("ONLINE", settings.store_enabled), ("QR", settings.qr_ordering_enabled)):
        channel = await get_channel(db, access.tenant_id, code)
        if channel:
            channel.enabled = enabled
    audit.record(db, access, "settings.update", entity_type="settings", summary=", ".join(sorted(update)) or None)
    await db.commit()
    return serialize_settings(settings)

# --- Modules: what the plan includes and what the owner chose to hide ---

class ModulesUpdate(BaseModel):
    hidden: list[str] = Field(default_factory=list, max_length=len(FEATURES))

@router.get("/modules")
async def read_modules(access: Access = Depends(get_access)):
    ent = await entitlements(access.tenant_id)
    return {
        "plan_key": ent["plan_key"], "plan_name": ent["plan_name"], "limits": ent["limits"],
        "modules": [{"key": k, "name": label, "in_plan": k in ent["plan_features"], "hidden": k in ent["hidden"],
                     "enabled": k in ent["features"]} for k, label in FEATURES.items()],
    }

@router.put("/modules")
async def update_modules(data: ModulesUpdate, access: Access = Depends(require("settings.manage")), db: AsyncSession = Depends(get_tenant_db)):
    """Owners hide modules they don't use (e.g. aggregators or staff accounts). They can't enable what the plan lacks."""
    if not access.is_owner:
        raise HTTPException(status_code=403, detail="Only the owner can change which modules are used")
    unknown = [m for m in data.hidden if m not in FEATURES]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown modules: {', '.join(unknown)}")
    settings = await get_settings(db, access.tenant_id)
    settings.disabled_modules = sorted(set(data.hidden))
    audit.record(db, access, "modules.update", entity_type="settings", summary="Hidden: " + (", ".join(settings.disabled_modules) or "none"))
    await db.commit()
    invalidate(access.tenant_id)
    return await read_modules(access)

# --- Sales channels (Swiggy, Zomato, ONDC, magicpin, own store, QR) ---

class ChannelUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=40)
    enabled: bool | None = None
    commission_pct: float | None = Field(None, ge=0, le=100)
    price_adjust_pct: float | None = Field(None, ge=-50, le=100)
    external_store_id: str | None = Field(None, max_length=64)
    auto_accept: bool | None = None

def serialize_channel(c: SalesChannel, include_secret: bool = False) -> dict:
    data = {"id": str(c.id), "code": c.code, "name": c.name, "enabled": c.enabled, "commission_pct": float(c.commission_pct),
            "price_adjust_pct": float(c.price_adjust_pct), "external_store_id": c.external_store_id, "auto_accept": c.auto_accept}
    if include_secret:
        data["webhook_secret"] = c.webhook_secret
    return data

@router.get("/channels")
async def list_channels(access: Access = Depends(get_access), db: AsyncSession = Depends(get_tenant_db)):
    channels = await ensure_channels(db, access.tenant_id)
    await db.commit()
    return [serialize_channel(c, include_secret=access.can("channels.manage")) for c in channels]

@router.get("/channels/{code}/menu")
async def channel_menu_view(code: str, access: Access = Depends(require("menu.view")), db: AsyncSession = Depends(get_tenant_db)):
    """The menu as this channel sells it: per-item channel price (or the channel mark-up), hidden items flagged.
    Use it to keep the Swiggy / Zomato partner portal in step."""
    from sqlalchemy.orm import selectinload
    from app.models import Product, ProductCategory
    from app.services import channel_menu
    channel = await get_channel(db, access.tenant_id, code.upper())
    if channel is None:
        raise HTTPException(status_code=404, detail="Sales channel not found")
    adjust = channel.price_adjust_pct or 0
    categories = {c.id: c.name for c in (await db.execute(select(ProductCategory).where(ProductCategory.tenant_id == access.tenant_id))).scalars().all()}
    products = (await db.execute(select(Product).options(selectinload(Product.variants))
                                 .where(Product.tenant_id == access.tenant_id, Product.is_active == True)
                                 .order_by(Product.sort_order, Product.name))).scalars().all()
    items = []
    for p in products:
        override = (p.channel_prices or {}).get(channel.code, {})
        items.append({"id": str(p.id), "name": p.name, "category": categories.get(p.category_id), "is_veg": p.is_veg,
                      "counter_price": float(p.base_price), "price": float(channel_menu.unit_price(p, channel.code, adjust)),
                      "price_source": "item" if override.get("price") is not None else ("markup" if adjust else "counter"),
                      "available": channel_menu.available_on(p, channel.code),
                      "variants": [{"name": v.variant_name, "price": float(channel_menu.unit_price(p, channel.code, adjust, v.price_modifier))}
                                   for v in p.variants if v.is_active]})
    return {"channel": serialize_channel(channel), "items": items,
            "available_count": sum(1 for i in items if i["available"]), "hidden_count": sum(1 for i in items if not i["available"])}

@router.put("/channels/{code}")
async def update_channel(code: str, data: ChannelUpdate, access: Access = Depends(require("channels.manage")), db: AsyncSession = Depends(get_tenant_db)):
    channel = await get_channel(db, access.tenant_id, code.upper())
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(channel, key, value)
    await db.commit()
    return serialize_channel(channel, include_secret=True)

@router.post("/channels/{code}/rotate-secret")
async def rotate_channel_secret(code: str, access: Access = Depends(require("channels.manage")), db: AsyncSession = Depends(get_tenant_db)):
    if not access.is_owner:
        raise HTTPException(status_code=403, detail="Only the owner can rotate integration secrets")
    channel = await get_channel(db, access.tenant_id, code.upper())
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    channel.webhook_secret = secrets.token_urlsafe(32)
    await db.commit()
    return serialize_channel(channel, include_secret=True)

# --- Brands (cloud kitchens) ---

class BrandIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    is_active: bool = True

@router.get("/brands")
async def list_brands(access: Access = Depends(get_access), db: AsyncSession = Depends(get_tenant_db)):
    rows = (await db.execute(select(Brand).where(Brand.tenant_id == access.tenant_id).order_by(Brand.name))).scalars().all()
    return [{"id": str(b.id), "name": b.name, "is_active": b.is_active} for b in rows]

@router.post("/brands")
async def create_brand(data: BrandIn, access: Access = Depends(require("menu.manage", feature="brands")), db: AsyncSession = Depends(get_tenant_db)):
    dup = await db.execute(select(Brand.id).where(Brand.tenant_id == access.tenant_id, func.lower(Brand.name) == data.name.strip().lower()))
    if dup.first():
        raise HTTPException(status_code=409, detail="A brand with this name already exists")
    brand = Brand(id=uuid.uuid4(), tenant_id=access.tenant_id, name=data.name.strip(), is_active=data.is_active)
    db.add(brand)
    await db.commit()
    return {"id": str(brand.id), "name": brand.name, "is_active": brand.is_active}

@router.put("/brands/{brand_id}")
async def update_brand(brand_id: uuid.UUID, data: BrandIn, access: Access = Depends(require("menu.manage", feature="brands")), db: AsyncSession = Depends(get_tenant_db)):
    brand = (await db.execute(select(Brand).where(Brand.id == brand_id, Brand.tenant_id == access.tenant_id))).scalars().first()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    brand.name, brand.is_active = data.name.strip(), data.is_active
    await db.commit()
    return {"id": str(brand.id), "name": brand.name, "is_active": brand.is_active}

# --- Staff ---

class StaffCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    phone: str | None = Field(None, pattern=PHONE_PATTERN)
    role: str = Field(min_length=2, max_length=40)
    password: str = Field(min_length=8, max_length=64)
    location_id: uuid.UUID | None = None

class StaffUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=1, max_length=80)
    role: str | None = Field(None, min_length=2, max_length=40)
    is_active: bool | None = None
    password: str | None = Field(None, min_length=8, max_length=64)
    location_id: uuid.UUID | None = None

PRIVILEGED_ROLES = ("owner", "manager")

def _can_manage(actor: Access, target_role: str) -> bool:
    """Only owners manage owners/managers; managers handle everyone else."""
    return actor.is_owner or target_role not in PRIVILEGED_ROLES

async def _validate_role(system_db: AsyncSession, tenant_id: str, role_key: str, actor: Access | None = None) -> Role:
    role = (await system_db.execute(select(Role).where(Role.tenant_id == tenant_id, Role.key == role_key))).scalars().first()
    if role is None:
        raise HTTPException(status_code=422, detail="Unknown role. Create it in Staff → Roles first.")
    if actor is not None and not actor.is_owner and set(role.permissions or []) - set(actor.permissions):
        raise HTTPException(status_code=403, detail=f"The {role.name} role can do things you can't, so only the owner can give it out")
    return role

def _serialize_staff(u: TenantUser, roles: dict) -> dict:
    return {"id": str(u.id), "email": u.username, "full_name": u.full_name, "role": u.role,
            "role_name": roles.get(u.role, u.role), "is_active": u.is_active,
            "location_id": str(u.location_id) if u.location_id else None}

@router.get("/staff")
async def list_staff(q: str | None = Query(None, max_length=80), role: str | None = Query(None, max_length=40),
                     active: bool | None = None, limit: int = Query(1000, ge=1, le=5000), offset: int = Query(0, ge=0),
                     access: Access = Depends(require("staff.view", feature="staff"))):
    """Big chains have hundreds of staff: optional search (name / email), role, active filter and paging."""
    async with get_shared_session_maker()() as db:  # global accounts + tenant users, scoped explicitly
        query = select(TenantUser).where(TenantUser.tenant_id == access.tenant_id)
        if q:
            like = f"%{q.strip()}%"
            query = query.where(or_(TenantUser.full_name.ilike(like), TenantUser.username.ilike(like)))
        if role:
            query = query.where(TenantUser.role == role)
        if active is not None:
            query = query.where(TenantUser.is_active == active)
        rows = (await db.execute(query.order_by(TenantUser.created_at).limit(limit).offset(offset))).scalars().all()
        roles = {r.key: r.name for r in (await db.execute(select(Role).where(Role.tenant_id == access.tenant_id))).scalars().all()}
        return [_serialize_staff(u, roles) for u in rows]

@router.post("/staff")
async def create_staff(data: StaffCreate, access: Access = Depends(require("staff.manage", feature="staff"))):
    if not _can_manage(access, data.role):
        raise HTTPException(status_code=403, detail="Only the owner can add managers or owners")
    email = data.email.lower()
    async with get_shared_session_maker()() as db:
        await _validate_role(db, access.tenant_id, data.role, access)
        active = (await db.execute(select(func.count(TenantUser.id)).where(TenantUser.tenant_id == access.tenant_id, TenantUser.is_active == True))).scalar_one()
        check_limit(access, "max_staff", int(active), "staff accounts")
        if data.location_id:
            found = await db.execute(select(Location.id).where(Location.id == data.location_id, Location.tenant_id == access.tenant_id))
            if found.first() is None:
                raise HTTPException(status_code=404, detail="Branch not found")
        existing = (await db.execute(select(GlobalUser).where(func.lower(GlobalUser.email) == email))).scalars().first()
        if existing:
            raise HTTPException(status_code=409, detail="This email is already registered")
        hashed = await hash_password_async(data.password)
        db.add(GlobalUser(email=email, phone=data.phone.replace(" ", "") if data.phone else None, full_name=data.full_name, password_hash=hashed))
        user = TenantUser(tenant_id=access.tenant_id, username=email, full_name=data.full_name, role=data.role, password_hash=hashed,
                          location_id=data.location_id)
        db.add(user)
        audit.record(db, access, "staff.create", entity_type="staff", summary=f"{data.full_name} as {data.role}")
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(status_code=409, detail="This email or phone number is already registered")
        logger.info(f"[Staff] Added {data.role}", extra={"tenant_id": access.tenant_id})
        roles = {r.key: r.name for r in (await db.execute(select(Role).where(Role.tenant_id == access.tenant_id))).scalars().all()}
        return _serialize_staff(user, roles)

@router.put("/staff/{staff_id}")
async def update_staff(staff_id: uuid.UUID, data: StaffUpdate, access: Access = Depends(require("staff.manage", feature="staff"))):
    async with get_shared_session_maker()() as db:
        user = (await db.execute(select(TenantUser).where(TenantUser.id == staff_id, TenantUser.tenant_id == access.tenant_id))).scalars().first()
        if not user:
            raise HTTPException(status_code=404, detail="Staff member not found")
        if not _can_manage(access, user.role) or (data.role and not _can_manage(access, data.role)):
            raise HTTPException(status_code=403, detail="Only the owner can change managers or owners")
        if str(user.id) == str(access.staff_id) and (data.is_active is False or (data.role and data.role != user.role)):
            raise HTTPException(status_code=400, detail="You cannot deactivate or change the role of your own account")
        if data.role:
            await _validate_role(db, access.tenant_id, data.role, access)
        if data.is_active and not user.is_active:
            active = (await db.execute(select(func.count(TenantUser.id)).where(TenantUser.tenant_id == access.tenant_id, TenantUser.is_active == True))).scalar_one()
            check_limit(access, "max_staff", int(active), "staff accounts")
        global_user = (await db.execute(select(GlobalUser).where(func.lower(GlobalUser.email) == user.username.lower()))).scalars().first()
        changes = []
        if data.full_name is not None:
            user.full_name = data.full_name
            if global_user:
                global_user.full_name = data.full_name
        if data.role is not None and data.role != user.role:
            changes.append(f"role {user.role} → {data.role}")
            user.role = data.role
        if data.is_active is not None and data.is_active != user.is_active:
            changes.append("activated" if data.is_active else "deactivated")
            user.is_active = data.is_active
        if "location_id" in data.model_fields_set:
            user.location_id = data.location_id
        if data.password:
            hashed = await hash_password_async(data.password)
            user.password_hash = hashed
            if global_user:
                global_user.password_hash = hashed
            changes.append("password reset")
        if user.is_active is False or "password reset" in changes or any(c.startswith("role ") for c in changes):
            from app.services.sessions import revoke
            await revoke(db, reason="Access changed by " + (access.staff_name or access.role), tenant_id=access.tenant_id, staff_id=user.id)
        if changes:
            audit.record(db, access, "staff.update", entity_type="staff", entity_id=user.id, summary=f"{user.full_name or user.username}: {', '.join(changes)}")
        await db.commit()
        invalidate(access.tenant_id)
        roles = {r.key: r.name for r in (await db.execute(select(Role).where(Role.tenant_id == access.tenant_id))).scalars().all()}
        return _serialize_staff(user, roles)
