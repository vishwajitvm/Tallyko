"""Business tax setup: GST classes, dated rate changes, assigning classes to items, registration type."""
import uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from app.core.catalog import GST_REGISTRATION_TYPES, split_gst
from app.core.gstin import charges_gst
from app.core.tenant import get_tenant_db
from app.models import Product, TaxClass, TaxClassRate, TaxPreset, TaxPresetRate
from app.services import audit
from app.services.access import Access, get_access, require
from app.services.settings_service import get_settings
from app.services.tax import ensure_tax_classes, rate_at

router = APIRouter(prefix="/taxes", tags=["Taxes"])

def _naive(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None) if dt.tzinfo is None else (dt - dt.utcoffset()).replace(tzinfo=None)

def serialize_class(c: TaxClass, product_counts: dict, default_id) -> dict:
    now = datetime.utcnow()
    current = rate_at(c.rates, now)
    return {
        "id": str(c.id), "name": c.name, "code": c.code, "hsn_sac": c.hsn_sac, "preset_key": c.preset_key, "follow_preset": c.follow_preset,
        "is_active": c.is_active, "is_default": c.id == default_id, "products": int(product_counts.get(c.id, 0)),
        "current_rate": float(current.total_rate) if current else None,
        "current_components": current.components if current else [],
        "rates": [{"id": str(r.id), "effective_from": r.effective_from.isoformat() + "Z", "total_rate": float(r.total_rate),
                   "components": r.components, "note": r.note, "source": r.source, "upcoming": r.effective_from > now,
                   "current": current is not None and r.id == current.id} for r in c.rates],
    }

@router.get("")
async def list_tax_classes(access: Access = Depends(get_access), db: AsyncSession = Depends(get_tenant_db)):
    settings = await get_settings(db, access.tenant_id)
    await ensure_tax_classes(db, access.tenant_id, settings.business_type, settings)
    await db.commit()
    classes = (await db.execute(select(TaxClass).options(selectinload(TaxClass.rates)).where(TaxClass.tenant_id == access.tenant_id)
                                .order_by(TaxClass.is_active.desc(), TaxClass.name)
                                .execution_options(populate_existing=True))).scalars().all()  # fresh rates after an edit
    counts = dict((await db.execute(select(Product.tax_class_id, func.count()).where(Product.tenant_id == access.tenant_id, Product.is_active == True)
                                    .group_by(Product.tax_class_id))).all())
    return {
        "registration": settings.gst_registration, "registration_types": GST_REGISTRATION_TYPES,
        "charges_gst": charges_gst(settings.gst_registration, settings.gstin), "gstin": settings.gstin,
        "gst_note": None if charges_gst(settings.gst_registration, settings.gstin) else (
            "No GST is charged: add a valid GSTIN in Business settings to bill as a GST-registered business"
            if settings.gst_registration == "regular" else "No GST is charged on your bills (Bill of Supply)"),
        "prices_include_tax": settings.prices_include_tax, "default_tax_class_id": str(settings.default_tax_class_id) if settings.default_tax_class_id else None,
        "products_without_class": int(counts.get(None, 0)),
        "classes": [serialize_class(c, counts, settings.default_tax_class_id) for c in classes],
    }

@router.get("/presets")
async def presets(access: Access = Depends(get_access), db: AsyncSession = Depends(get_tenant_db)):
    """The platform GST library (read-only) to create classes from."""
    rows = (await db.execute(select(TaxPreset).where(TaxPreset.is_active == True).order_by(TaxPreset.sort_order))).scalars().all()
    rates = (await db.execute(select(TaxPresetRate))).scalars().all()
    now = datetime.utcnow()
    return [{"key": p.key, "name": p.name, "hsn_sac": p.hsn_sac, "description": p.description,
             "current_rate": float(cur.total_rate) if (cur := rate_at([r for r in rates if r.preset_key == p.key], now)) else None} for p in rows]

class ClassIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    code: str | None = Field(None, pattern=r"^[A-Za-z0-9_]{2,30}$")
    hsn_sac: str | None = Field(None, pattern=r"^$|^[0-9]{4,8}$")
    rate: float | None = Field(None, ge=0, le=100)  # for custom classes
    preset_key: str | None = None  # or copy from the platform library
    follow_preset: bool = True

@router.post("")
async def create_class(data: ClassIn, access: Access = Depends(require("settings.manage")), db: AsyncSession = Depends(get_tenant_db)):
    if data.preset_key is None and data.rate is None:
        raise HTTPException(status_code=422, detail="Choose a GST slab from the library or enter a rate")
    code = (data.code or data.preset_key or f"GST_{str(data.rate).rstrip('0').rstrip('.')}").upper()
    if (await db.execute(select(TaxClass.id).where(TaxClass.tenant_id == access.tenant_id, TaxClass.code == code))).first():
        code = f"{code}_{uuid.uuid4().hex[:4].upper()}"
    tax_class = TaxClass(id=uuid.uuid4(), tenant_id=access.tenant_id, name=data.name.strip(), code=code, hsn_sac=data.hsn_sac or None,
                         preset_key=data.preset_key, follow_preset=bool(data.preset_key) and data.follow_preset)
    db.add(tax_class)
    if data.preset_key:
        versions = (await db.execute(select(TaxPresetRate).where(TaxPresetRate.preset_key == data.preset_key))).scalars().all()
        if not versions:
            raise HTTPException(status_code=404, detail="GST slab not found")
        for v in versions:
            db.add(TaxClassRate(tax_class_id=tax_class.id, effective_from=v.effective_from, components=v.components,
                                total_rate=v.total_rate, note=v.note, source="preset"))
    else:
        db.add(TaxClassRate(tax_class_id=tax_class.id, effective_from=datetime(2017, 7, 1), components=split_gst(data.rate),
                            total_rate=data.rate, note="Set by business", source="manual"))
    audit.record(db, access, "tax.class_update", entity_type="tax_class", entity_id=tax_class.id, summary=f"Created {tax_class.name}")
    await db.commit()
    return await list_tax_classes(access, db)

class ClassUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=80)
    hsn_sac: str | None = Field(None, pattern=r"^$|^[0-9]{4,8}$")
    follow_preset: bool | None = None
    is_active: bool | None = None

async def _get_class(db: AsyncSession, tenant_id: str, class_id) -> TaxClass:
    c = (await db.execute(select(TaxClass).options(selectinload(TaxClass.rates)).where(TaxClass.id == class_id, TaxClass.tenant_id == tenant_id))).scalars().first()
    if c is None:
        raise HTTPException(status_code=404, detail="Tax class not found")
    return c

@router.put("/{class_id}")
async def update_class(class_id: uuid.UUID, data: ClassUpdate, access: Access = Depends(require("settings.manage")), db: AsyncSession = Depends(get_tenant_db)):
    c = await _get_class(db, access.tenant_id, class_id)
    settings = await get_settings(db, access.tenant_id)
    if data.is_active is False and settings.default_tax_class_id == c.id:
        raise HTTPException(status_code=409, detail="Choose another default tax class before turning this one off")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(c, key, (value or None) if key == "hsn_sac" else value)
    audit.record(db, access, "tax.class_update", entity_type="tax_class", entity_id=c.id, summary=c.name)
    await db.commit()
    return await list_tax_classes(access, db)

class RateIn(BaseModel):
    rate: float = Field(ge=0, le=100)
    effective_from: datetime
    note: str | None = Field(None, max_length=300)
    igst_only: bool = False

@router.post("/{class_id}/rates")
async def schedule_rate(class_id: uuid.UUID, data: RateIn, access: Access = Depends(require("settings.manage")), db: AsyncSession = Depends(get_tenant_db)):
    """Schedule a rate change (e.g. a government notification) — bills switch automatically at that time.
    Rates already in effect can't be rewritten, because issued invoices must stay as they were."""
    c = await _get_class(db, access.tenant_id, class_id)
    effective = _naive(data.effective_from)
    now = datetime.utcnow()
    if effective < now - timedelta(minutes=5):
        raise HTTPException(status_code=409, detail="A rate change can't start in the past; bills already issued keep their tax")
    effective = max(effective, now)  # "now" from a slightly slow device clock
    current = rate_at(c.rates, now)
    if current and effective <= current.effective_from:
        raise HTTPException(status_code=409, detail="A new rate must start after the rate currently in effect")
    if any(r.effective_from == effective for r in c.rates):
        raise HTTPException(status_code=409, detail="A rate change is already scheduled at that exact time")
    components = [{"name": "IGST", "rate": data.rate}] if data.igst_only else split_gst(data.rate)
    db.add(TaxClassRate(tax_class_id=c.id, effective_from=effective, components=components, total_rate=data.rate,
                        note=data.note, source="manual"))
    c.follow_preset = False  # the owner took control of this class
    audit.record(db, access, "tax.rate_schedule", entity_type="tax_class", entity_id=c.id,
                 summary=f"{c.name}: {data.rate}% from {effective:%d %b %Y %H:%M} UTC", details={"note": data.note})
    await db.commit()
    return await list_tax_classes(access, db)

@router.delete("/{class_id}/rates/{rate_id}")
async def cancel_scheduled_rate(class_id: uuid.UUID, rate_id: uuid.UUID, access: Access = Depends(require("settings.manage")),
                                db: AsyncSession = Depends(get_tenant_db)):
    c = await _get_class(db, access.tenant_id, class_id)
    row = next((r for r in c.rates if r.id == rate_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail="Rate not found")
    if row.effective_from <= datetime.utcnow():
        raise HTTPException(status_code=409, detail="Only upcoming rate changes can be cancelled")
    await db.delete(row)
    audit.record(db, access, "tax.rate_schedule", entity_type="tax_class", entity_id=c.id, summary=f"{c.name}: cancelled scheduled {row.total_rate}%")
    await db.commit()
    return await list_tax_classes(access, db)

class AssignIn(BaseModel):
    tax_class_id: uuid.UUID | None  # null = use the business default
    product_ids: list[uuid.UUID] = Field(default_factory=list, max_length=5000)
    category_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)
    all_products: bool = False

@router.post("/assign")
async def assign_class(data: AssignIn, access: Access = Depends(require("settings.manage", "menu.manage")), db: AsyncSession = Depends(get_tenant_db)):
    """Bulk-assign a tax class to items, whole categories, or everything."""
    if data.tax_class_id:
        await _get_class(db, access.tenant_id, data.tax_class_id)
    if not (data.product_ids or data.category_ids or data.all_products):
        raise HTTPException(status_code=422, detail="Choose items, categories or all items")
    condition = [Product.tenant_id == access.tenant_id]
    if not data.all_products:
        condition.append(or_(Product.id.in_(data.product_ids or [uuid.uuid4()]), Product.category_id.in_(data.category_ids or [uuid.uuid4()])))
    from sqlalchemy.orm import selectinload
    from app.services import menu_history
    affected = (await db.execute(select(Product).options(selectinload(Product.variants)).where(*condition))).scalars().all()
    for product in affected:
        await menu_history.ensure_baseline(db, access.tenant_id, product)
    result = await db.execute(update(Product).where(*condition).values(tax_class_id=data.tax_class_id, tax_rate=None, updated_at=datetime.utcnow())
                              .execution_options(synchronize_session="fetch"))
    for product in affected:
        await menu_history.record(db, access.tenant_id, product, access, change="Tax class changed (bulk)")
    audit.record(db, access, "tax.class_update", entity_type="tax_class", entity_id=data.tax_class_id, summary=f"Assigned to {result.rowcount} items")
    await db.commit()
    return {"updated": result.rowcount}
