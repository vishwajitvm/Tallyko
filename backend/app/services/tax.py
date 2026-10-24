"""GST resolution: which rate (and CGST/SGST or IGST split) applies to a product at a moment in time.

Flow when the government changes a rate:
  1. Super admin publishes a new preset rate with its effective date (POST /platform/tax/presets/{key}/rates).
  2. Every business tax class that follows that preset gets the same dated version (publish_preset_rate).
  3. Bills created on/after the date use it automatically; earlier bills keep their own snapshot
     (order_items.tax_rate / tax_components), so invoices are never rewritten.
Owners can also schedule their own changes per class, or stop following the preset.
"""
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from app.core.catalog import DEFAULT_TAX_CLASSES, DEFAULT_TAX_PRESETS, split_gst

@dataclass(frozen=True)
class TaxRule:
    total_rate: Decimal  # e.g. 5
    components: tuple  # (("CGST", 2.5), ("SGST", 2.5))
    hsn_sac: str | None = None
    class_id: str | None = None
    class_name: str | None = None

NO_TAX = TaxRule(total_rate=Decimal(0), components=())

def components_for(total, inter_state: bool = False) -> tuple:
    total = float(total or 0)
    if not total:
        return ()
    if inter_state:
        return (("IGST", total),)
    return tuple((c["name"], c["rate"]) for c in split_gst(total))

def _normalise_components(raw: list[dict], total: Decimal, inter_state: bool) -> tuple:
    if inter_state:
        return components_for(total, inter_state=True)
    parts = tuple((c["name"], float(c["rate"])) for c in raw or [] if float(c.get("rate", 0)) > 0)
    return parts or components_for(total)

IST_OFFSET = timedelta(hours=5, minutes=30)

def india_time_to_utc(iso: str) -> datetime:
    """Preset dates in app.core.catalog are Indian local time (notifications take effect at midnight IST)."""
    return datetime.fromisoformat(iso) - IST_OFFSET

def rate_at(rates, at: datetime):
    """Latest rate version effective at `at` (rates: iterable with effective_from)."""
    applicable = [r for r in rates if r.effective_from <= at]
    return max(applicable, key=lambda r: r.effective_from) if applicable else None

class TaxResolver:
    """Loads a business's tax classes once per request and answers "what tax applies to this product now"."""

    def __init__(self, classes: dict, default_class_id, registration: str, default_rate: Decimal, inter_state: bool, at: datetime,
                 gstin: str | None = None):
        self.classes = classes
        self.default_class_id = default_class_id
        self.registration = registration
        self.gstin = gstin
        self.default_rate = default_rate
        self.inter_state = inter_state
        self.at = at

    @classmethod
    async def load(cls, db: AsyncSession, tenant_id: str, settings, at: datetime | None = None, inter_state: bool = False) -> "TaxResolver":
        from app.models import TaxClass
        result = await db.execute(select(TaxClass).options(selectinload(TaxClass.rates)).where(TaxClass.tenant_id == tenant_id))
        classes = {c.id: c for c in result.scalars().all()}
        return cls(classes, getattr(settings, "default_tax_class_id", None), getattr(settings, "gst_registration", "regular") or "regular",
                   Decimal(settings.default_tax_rate or 0), inter_state, at or datetime.utcnow(), getattr(settings, "gstin", None))

    @property
    def charges_tax(self) -> bool:
        # Only a regular GST registration with a valid GSTIN may collect GST; composition dealers and unregistered
        # businesses (or a missing / mistyped GSTIN) issue a Bill of Supply without GST
        from app.core.gstin import charges_gst
        return charges_gst(self.registration, self.gstin)

    def _from_class(self, class_id) -> TaxRule | None:
        tax_class = self.classes.get(class_id)
        if tax_class is None or not tax_class.is_active:
            return None
        version = rate_at(tax_class.rates, self.at)
        if version is None:
            return None
        total = Decimal(version.total_rate)
        return TaxRule(total, _normalise_components(version.components, total, self.inter_state), tax_class.hsn_sac,
                       str(tax_class.id), tax_class.name)

    def for_product(self, product) -> TaxRule:
        if not self.charges_tax:
            return NO_TAX
        rule = None
        if getattr(product, "tax_class_id", None):
            rule = self._from_class(product.tax_class_id)
        if rule is None and product.tax_rate is not None:  # legacy per-product rate
            total = Decimal(product.tax_rate)
            rule = TaxRule(total, components_for(total, self.inter_state))
        if rule is None and self.default_class_id:
            rule = self._from_class(self.default_class_id)
        if rule is None:
            rule = TaxRule(self.default_rate, components_for(self.default_rate, self.inter_state))
        return rule

def component_amounts(rule_components, tax_amount: Decimal) -> list[dict]:
    """Split a line's tax across its components (CGST/SGST or IGST) to the paisa."""
    from app.services.pricing import money
    total_rate = sum(Decimal(str(r)) for _, r in rule_components) or Decimal(1)
    out, remaining = [], Decimal(tax_amount)
    for i, (name, rate) in enumerate(rule_components):
        amount = remaining if i == len(rule_components) - 1 else money(Decimal(tax_amount) * Decimal(str(rate)) / total_rate)
        remaining -= amount
        out.append({"name": name, "rate": float(rate), "amount": float(amount)})
    return out

# --- provisioning ---------------------------------------------------------------------------------------------

def _preset(key: str) -> dict:
    return next(p for p in DEFAULT_TAX_PRESETS if p["key"] == key)

async def ensure_tax_classes(db: AsyncSession, tenant_id: str, business_type: str, settings=None) -> list:
    """Create the default tax classes for a business (idempotent) and set its default class."""
    from app.models import TaxClass, TaxClassRate, TaxPresetRate
    existing = (await db.execute(select(TaxClass).where(TaxClass.tenant_id == tenant_id))).scalars().all()
    if existing:
        return list(existing)
    created = []
    for key in DEFAULT_TAX_CLASSES.get(business_type, DEFAULT_TAX_CLASSES["restaurant"]):
        preset = _preset(key)
        tax_class = TaxClass(id=uuid.uuid4(), tenant_id=tenant_id, name=preset["name"], code=key, hsn_sac=preset["hsn_sac"],
                             preset_key=key, follow_preset=True)
        db.add(tax_class)
        # Prefer the published platform versions (they may be newer than the built-in defaults)
        versions = (await db.execute(select(TaxPresetRate).where(TaxPresetRate.preset_key == key))).scalars().all()
        rows = [(v.effective_from, v.components, v.total_rate, v.note) for v in versions] or \
               [(india_time_to_utc(eff), split_gst(rate), rate, note) for eff, rate, note in preset["rates"]]
        for effective_from, components, total, note in rows:
            db.add(TaxClassRate(tax_class_id=tax_class.id, effective_from=effective_from, components=components,
                                total_rate=total, note=note, source="preset"))
        created.append(tax_class)
    await db.flush()
    if settings is not None and not getattr(settings, "default_tax_class_id", None) and created:
        settings.default_tax_class_id = created[0].id
    return created

async def publish_preset_rate(system_db: AsyncSession, preset_key: str, effective_from: datetime, total_rate: Decimal,
                              components: list[dict] | None, note: str | None) -> dict:
    """Platform action (system session, crosses tenants): add a dated preset rate and schedule it for every
    business class that follows the preset. Idempotent per (preset, effective_from)."""
    from app.models import TaxClass, TaxClassRate, TaxPreset, TaxPresetRate
    preset = await system_db.get(TaxPreset, preset_key)
    if preset is None:
        raise ValueError("Unknown tax preset")
    components = components or split_gst(float(total_rate))
    existing = (await system_db.execute(select(TaxPresetRate).where(TaxPresetRate.preset_key == preset_key,
                                                                    TaxPresetRate.effective_from == effective_from))).scalars().first()
    if existing:
        existing.total_rate, existing.components, existing.note = total_rate, components, note
    else:
        system_db.add(TaxPresetRate(preset_key=preset_key, effective_from=effective_from, components=components,
                                    total_rate=total_rate, note=note))
    classes = (await system_db.execute(select(TaxClass).where(TaxClass.preset_key == preset_key, TaxClass.follow_preset == True))).scalars().all()
    scheduled = 0
    for tax_class in classes:
        row = (await system_db.execute(select(TaxClassRate).where(TaxClassRate.tax_class_id == tax_class.id,
                                                                  TaxClassRate.effective_from == effective_from))).scalars().first()
        if row is None:
            system_db.add(TaxClassRate(tax_class_id=tax_class.id, effective_from=effective_from, components=components,
                                       total_rate=total_rate, note=note, source="preset"))
            scheduled += 1
        elif row.source == "preset":
            row.components, row.total_rate, row.note = components, total_rate, note
    await system_db.flush()
    return {"businesses_updated": scheduled, "classes_following": len(classes)}

async def ensure_platform_presets(system_db: AsyncSession) -> int:
    """Insert the built-in GST presets and their versions if missing (production-safe, idempotent)."""
    from app.models import TaxPreset, TaxPresetRate
    added = 0
    for p in DEFAULT_TAX_PRESETS:
        if await system_db.get(TaxPreset, p["key"]) is None:
            system_db.add(TaxPreset(key=p["key"], name=p["name"], hsn_sac=p["hsn_sac"], description=p["description"], sort_order=p["sort_order"]))
            added += 1
        await system_db.flush()
        for eff, rate, note in p["rates"]:
            effective_from = india_time_to_utc(eff)
            exists = (await system_db.execute(select(TaxPresetRate).where(TaxPresetRate.preset_key == p["key"],
                                                                          TaxPresetRate.effective_from == effective_from))).scalars().first()
            if exists is None:
                system_db.add(TaxPresetRate(preset_key=p["key"], effective_from=effective_from, components=split_gst(rate),
                                            total_rate=rate, note=note))
    await system_db.flush()
    return added
