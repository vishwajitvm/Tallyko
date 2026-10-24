"""Menu versioning: every change to an item is stored as a new, append-only version (who, when, what changed).

Bills never depend on this (each bill line keeps its own price snapshot); it answers "who changed the price of
Butter Chicken and when?" and lets an owner put an item back as it was (which is itself a new version).
"""
from decimal import Decimal
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models import ProductVersion

FIELDS = ("name", "base_price", "cost_price", "category_id", "brand_id", "tax_class_id", "barcode", "sku", "unit", "is_veg",
          "print_to_kitchen", "track_stock", "is_active", "channel_prices", "description")
LABELS = {"name": "Name", "base_price": "Price", "cost_price": "Cost", "category_id": "Category", "brand_id": "Brand",
          "tax_class_id": "Tax class", "barcode": "Barcode", "sku": "SKU", "unit": "Unit", "is_veg": "Veg/non-veg",
          "print_to_kitchen": "Kitchen ticket", "track_stock": "Stock tracking", "channel_prices": "App prices",
          "description": "Description"}

def _plain(value):
    if isinstance(value, Decimal):
        return float(value)
    if value is not None and not isinstance(value, (str, int, float, bool, dict, list)):
        return str(value)
    return value

def snapshot(product) -> dict:
    data = {f: _plain(getattr(product, f, None)) for f in FIELDS}
    base = Decimal(product.base_price or 0)
    data["variants"] = sorted(([v.variant_name, float(base + Decimal(v.price_modifier or 0))]
                               for v in (product.variants or []) if v.is_active), key=lambda v: v[0])
    return data

def _money(v) -> str:
    return f"₹{float(v):,.2f}".replace(".00", "")

def describe(previous: dict | None, current: dict) -> str:
    if previous is None:
        return "Created"
    parts = []
    if previous.get("is_active") != current.get("is_active"):
        parts.append("Removed from the menu" if not current.get("is_active") else "Back on the menu")
    for field in FIELDS:
        if field == "is_active" or previous.get(field) == current.get(field):
            continue
        if field in ("base_price", "cost_price") and previous.get(field) is not None and current.get(field) is not None:
            parts.append(f"{LABELS[field]} {_money(previous[field])} → {_money(current[field])}")
        elif field == "name":
            parts.append(f"Renamed “{previous[field]}” → “{current[field]}”")
        else:
            parts.append(f"{LABELS[field]} changed")
    if previous.get("variants") != current.get("variants"):
        parts.append("Options/prices changed")
    return "; ".join(parts) or "Saved (no changes)"

async def latest(db: AsyncSession, product_id) -> ProductVersion | None:
    return (await db.execute(select(ProductVersion).where(ProductVersion.product_id == product_id)
                             .order_by(ProductVersion.version.desc()).limit(1))).scalars().first()

async def ensure_baseline(db: AsyncSession, tenant_id: str, product) -> None:
    """Items created before versioning (or by imports/seeders) get their current state saved as version 1 *before* an edit,
    so the first change still shows "₹300 → ₹340". Call before changing the product."""
    if await latest(db, product.id) is None:
        db.add(ProductVersion(tenant_id=tenant_id, product_id=product.id, version=1, snapshot=snapshot(product),
                              change="Existing item (history starts here)", changed_by_name="System"))
        await db.flush()

async def record(db: AsyncSession, tenant_id: str, product, access=None, change: str | None = None) -> ProductVersion | None:
    """Add a version if anything changed (call after the product row is updated; variants must be loaded)."""
    current = snapshot(product)
    previous = await latest(db, product.id)
    text = change or describe(previous.snapshot if previous else None, current)
    if previous is not None and previous.snapshot == current and change is None:
        return None
    row = ProductVersion(tenant_id=tenant_id, product_id=product.id, version=(previous.version + 1) if previous else 1, snapshot=current,
                         change=text[:300], changed_by_staff_id=getattr(access, "staff_id", None),
                         changed_by_name=(getattr(access, "staff_name", None) or getattr(access, "role", None)) if access else "System")
    db.add(row)
    return row

async def changes_count(db: AsyncSession, tenant_id: str, since) -> int:
    return int((await db.execute(select(func.count()).select_from(ProductVersion)
                                 .where(ProductVersion.tenant_id == tenant_id, ProductVersion.created_at >= since,
                                        ProductVersion.version > 1))).scalar_one())

def serialize(v: ProductVersion) -> dict:
    return {"version": v.version, "change": v.change, "changed_by": v.changed_by_name, "changed_by_staff_id": str(v.changed_by_staff_id) if v.changed_by_staff_id else None,
            "created_at": v.created_at.isoformat() + "Z", "snapshot": v.snapshot}
