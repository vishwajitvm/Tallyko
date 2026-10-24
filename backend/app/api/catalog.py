import logging
import uuid
from decimal import Decimal
from typing import List, Literal, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from app.core.tenant import get_tenant_db
from app.services.access import Access, get_access, require
from app.models import Product, ProductCategory, ProductVariant, Brand, InventoryLog, TaxClass
from app.schemas.catalog import (ProductCreate, ProductUpdate, ProductResponse, CategoryCreate, CategoryUpdate,
                                 CategoryResponse, BulkImportRequest, VariantIn)
from app.services import counters
from app.services.settings_service import CHANNEL_CODES, get_default_location
from app.services import channel_menu, menu_history

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/catalog", tags=["Catalog"])

def serialize_product(p: Product) -> dict:
    base = Decimal(p.base_price)
    return {
        "id": p.id, "name": p.name, "description": p.description, "base_price": float(base),
        "cost_price": float(p.cost_price) if p.cost_price is not None else None,
        "tax_rate": float(p.tax_rate) if p.tax_rate is not None else None, "tax_class_id": p.tax_class_id, "channel_prices": p.channel_prices or {},
        "category_id": p.category_id, "brand_id": p.brand_id, "barcode": p.barcode, "sku": p.sku, "unit": p.unit or "pcs",
        "is_veg": p.is_veg, "is_active": p.is_active, "print_to_kitchen": p.print_to_kitchen, "track_stock": p.track_stock,
        "low_stock_threshold": p.low_stock_threshold, "sort_order": p.sort_order or 0,
        "variants": [{"id": v.id, "name": v.variant_name, "price": float(base + Decimal(v.price_modifier))}
                     for v in p.variants if v.is_active],
    }

async def _get_product(db, tenant_id: str, product_id) -> Product:
    result = await db.execute(select(Product).options(selectinload(Product.variants))
                              .where(Product.id == product_id, Product.tenant_id == tenant_id)
                              .execution_options(populate_existing=True))
    product = result.scalars().first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product

async def _check_refs(db, tenant_id: str, category_id, brand_id) -> None:
    # FK checks bypass RLS, so confirm references belong to this tenant
    if category_id is not None:
        found = await db.execute(select(ProductCategory.id).where(ProductCategory.id == category_id, ProductCategory.tenant_id == tenant_id))
        if found.first() is None:
            raise HTTPException(status_code=404, detail="Category not found")
    if brand_id is not None:
        found = await db.execute(select(Brand.id).where(Brand.id == brand_id, Brand.tenant_id == tenant_id))
        if found.first() is None:
            raise HTTPException(status_code=404, detail="Brand not found")

async def _check_barcode_unique(db, tenant_id: str, barcode: str | None, exclude_id=None) -> None:
    if not barcode:
        return
    query = select(Product.id).where(Product.tenant_id == tenant_id, Product.barcode == barcode, Product.is_active == True)
    if exclude_id:
        query = query.where(Product.id != exclude_id)
    if (await db.execute(query)).first():
        raise HTTPException(status_code=409, detail="Another product already uses this barcode")

def _sync_variants(product: Product, variants: list[VariantIn]) -> None:
    base = Decimal(product.base_price)
    existing = {v.id: v for v in product.variants}
    keep = set()
    for index, v in enumerate(variants):
        modifier = Decimal(str(v.price)) - base
        if v.id and v.id in existing:
            row = existing[v.id]
            row.variant_name, row.price_modifier, row.sort_order, row.is_active = v.name, modifier, index, True
            keep.add(v.id)
        else:
            row = ProductVariant(id=uuid.uuid4(), product_id=product.id, variant_name=v.name, price_modifier=modifier, sort_order=index)
            product.variants.append(row)
            keep.add(row.id)
    for vid, row in existing.items():
        if vid not in keep:
            row.is_active = False  # keep for order history

# --- Categories ---

@router.get("/categories", response_model=List[CategoryResponse])
async def get_categories(include_inactive: bool = False, access: Access = Depends(require("menu.view")), db=Depends(get_tenant_db)):
    query = select(ProductCategory).where(ProductCategory.tenant_id == access.tenant_id)
    if not include_inactive:
        query = query.where(ProductCategory.is_active == True)
    result = await db.execute(query.order_by(ProductCategory.sort_order, ProductCategory.name))
    return result.scalars().all()

@router.post("/categories", response_model=CategoryResponse)
async def create_category(data: CategoryCreate, access: Access = Depends(require("menu.manage")), db=Depends(get_tenant_db)):
    tenant_id = access.tenant_id
    existing = await db.execute(select(ProductCategory).where(ProductCategory.tenant_id == tenant_id,
                                                              func.lower(ProductCategory.name) == data.name.strip().lower()))
    category = existing.scalars().first()
    if category:
        if not category.is_active:
            category.is_active = True
            await db.commit()
        return category
    category = ProductCategory(tenant_id=tenant_id, name=data.name.strip(), sort_order=data.sort_order)
    db.add(category)
    await db.commit()
    await db.refresh(category)
    logger.info(f"[Catalog] Category created {category.id}", extra={"tenant_id": tenant_id})
    return category

@router.put("/categories/{category_id}", response_model=CategoryResponse)
async def update_category(category_id: uuid.UUID, data: CategoryUpdate, access: Access = Depends(require("menu.manage")), db=Depends(get_tenant_db)):
    result = await db.execute(select(ProductCategory).where(ProductCategory.id == category_id, ProductCategory.tenant_id == access.tenant_id))
    category = result.scalars().first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(category, key, value.strip() if isinstance(value, str) else value)
    await db.commit()
    await db.refresh(category)
    return category

@router.delete("/categories/{category_id}")
async def delete_category(category_id: uuid.UUID, access: Access = Depends(require("menu.manage")), db=Depends(get_tenant_db)):
    result = await db.execute(select(ProductCategory).where(ProductCategory.id == category_id, ProductCategory.tenant_id == access.tenant_id))
    category = result.scalars().first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    category.is_active = False
    await db.commit()
    return {"success": True}

# --- Products ---

@router.get("/products", response_model=List[ProductResponse])
async def get_products(response: Response, q: str | None = Query(None, max_length=60), category_id: uuid.UUID | None = None,
                       include_inactive: bool = False, only_inactive: bool = False,
                       limit: int | None = Query(None, ge=1, le=1000), offset: int = Query(0, ge=0),
                       access: Access = Depends(require("menu.view")), db=Depends(get_tenant_db)):
    """Everything by default (the offline cache needs it); `limit`/`offset` page big menus, total in `X-Total-Count`."""
    query = select(Product).options(selectinload(Product.variants)).where(Product.tenant_id == access.tenant_id)
    if only_inactive:
        query = query.where(Product.is_active == False)
    elif not include_inactive:
        query = query.where(Product.is_active == True)
    if category_id:
        query = query.where(Product.category_id == category_id)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(Product.name.ilike(like), Product.barcode == q.strip(), Product.sku.ilike(like)))
    if limit is not None:
        response.headers["X-Total-Count"] = str((await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
        query = query.limit(limit).offset(offset)
    result = await db.execute(query.order_by(Product.sort_order, Product.name))
    return [serialize_product(p) for p in result.scalars().all()]

@router.get("/products/by-barcode/{code}", response_model=ProductResponse)
async def get_product_by_barcode(code: str, access: Access = Depends(require("menu.view")), db=Depends(get_tenant_db)):
    result = await db.execute(select(Product).options(selectinload(Product.variants))
                              .where(Product.tenant_id == access.tenant_id, Product.is_active == True,
                                     or_(Product.barcode == code.strip(), Product.sku == code.strip())))
    product = result.scalars().first()
    if not product:
        raise HTTPException(status_code=404, detail="No product with this barcode")
    return serialize_product(product)

async def _check_tax_class(db, tenant_id: str, tax_class_id) -> None:
    if tax_class_id and not (await db.execute(select(TaxClass.id).where(TaxClass.id == tax_class_id, TaxClass.tenant_id == tenant_id,
                                                                        TaxClass.is_active == True))).first():
        raise HTTPException(status_code=404, detail="Tax class not found")

@router.get("/products/{product_id}", response_model=ProductResponse)
async def get_product(product_id: uuid.UUID, access: Access = Depends(require("menu.view")), db=Depends(get_tenant_db)):
    return serialize_product(await _get_product(db, access.tenant_id, product_id))

@router.post("/products", response_model=ProductResponse)
async def create_product(data: ProductCreate, access: Access = Depends(require("menu.manage")), db=Depends(get_tenant_db)):
    tenant_id = access.tenant_id
    await _check_refs(db, tenant_id, data.category_id, data.brand_id)
    await _check_barcode_unique(db, tenant_id, data.barcode)
    await _check_tax_class(db, tenant_id, data.tax_class_id)
    product = Product(
        id=uuid.uuid4(), tenant_id=tenant_id, name=data.name.strip(), description=data.description, base_price=data.base_price,
        cost_price=data.cost_price, tax_rate=data.tax_rate, tax_class_id=data.tax_class_id, category_id=data.category_id,
        channel_prices=channel_menu.clean_overrides(data.channel_prices, CHANNEL_CODES),
        brand_id=data.brand_id, barcode=data.barcode or None, sku=data.sku, unit=data.unit or "pcs", is_veg=data.is_veg,
        print_to_kitchen=data.print_to_kitchen, track_stock=bool(data.track_stock), low_stock_threshold=data.low_stock_threshold,
        sort_order=data.sort_order or 0,
    )
    product.variants = []
    db.add(product)
    if data.variants:
        _sync_variants(product, data.variants)
    if data.opening_stock:
        location = await get_default_location(db, tenant_id)
        product.track_stock = True
        await db.flush()
        db.add(InventoryLog(tenant_id=tenant_id, product_id=product.id, location_id=location.id,
                            quantity_change=data.opening_stock, reason="restock", note="Opening stock", unit_cost=data.cost_price))
    await db.flush()
    await menu_history.record(db, tenant_id, product, access)
    await db.commit()
    logger.info(f"[Catalog] Product created: {product.id}", extra={"tenant_id": tenant_id})
    return serialize_product(await _get_product(db, tenant_id, product.id))

@router.put("/products/{product_id}", response_model=ProductResponse)
async def update_product(product_id: uuid.UUID, data: ProductUpdate, access: Access = Depends(require("menu.manage")), db=Depends(get_tenant_db)):
    tenant_id = access.tenant_id
    product = await _get_product(db, tenant_id, product_id)
    await menu_history.ensure_baseline(db, tenant_id, product)
    update = data.model_dump(exclude_unset=True)
    await _check_refs(db, tenant_id, update.get("category_id"), update.get("brand_id"))
    if "tax_class_id" in update and update["tax_class_id"] != product.tax_class_id:
        await _check_tax_class(db, tenant_id, update["tax_class_id"])  # an unchanged class may since have been turned off
    if "channel_prices" in update:
        update["channel_prices"] = channel_menu.clean_overrides(update["channel_prices"], CHANNEL_CODES)
    if "barcode" in update:
        update["barcode"] = update["barcode"] or None
        await _check_barcode_unique(db, tenant_id, update["barcode"], exclude_id=product.id)
    variants = update.pop("variants", None)
    old_base = Decimal(product.base_price)
    for key, value in update.items():
        setattr(product, key, value.strip() if key == "name" and isinstance(value, str) else value)
    if variants is not None:
        _sync_variants(product, data.variants or [])
    elif "base_price" in update and Decimal(str(update["base_price"])) != old_base:
        # Variant prices are absolute for the user; keep them unchanged when the base price moves
        delta = old_base - Decimal(str(update["base_price"]))
        for v in product.variants:
            v.price_modifier = Decimal(v.price_modifier) + delta
    await db.flush()
    await menu_history.record(db, tenant_id, await _get_product(db, tenant_id, product.id), access)
    await db.commit()
    logger.info(f"[Catalog] Product updated: {product_id}", extra={"tenant_id": tenant_id})
    return serialize_product(await _get_product(db, tenant_id, product.id))

@router.delete("/products/{product_id}")
async def delete_product(product_id: uuid.UUID, access: Access = Depends(require("menu.manage")), db=Depends(get_tenant_db)):
    product = await _get_product(db, access.tenant_id, product_id)
    await menu_history.ensure_baseline(db, access.tenant_id, product)
    product.is_active = False  # soft delete keeps old bills intact
    await db.flush()
    await menu_history.record(db, access.tenant_id, product, access)
    await db.commit()
    logger.info(f"[Catalog] Product soft-deleted: {product_id}", extra={"tenant_id": access.tenant_id})
    return {"success": True, "message": "Product deleted successfully"}

@router.post("/products/{product_id}/barcode", response_model=ProductResponse)
async def generate_barcode(product_id: uuid.UUID, access: Access = Depends(require("menu.manage")), db=Depends(get_tenant_db)):
    """Assign an in-store EAN-13 (prefix 2xx, reserved for internal use) to a product without a barcode."""
    tenant_id = access.tenant_id
    product = await _get_product(db, tenant_id, product_id)
    await menu_history.ensure_baseline(db, tenant_id, product)
    if product.barcode:
        raise HTTPException(status_code=409, detail="Product already has a barcode")
    for _ in range(5):
        seq = await counters.next_value(db, tenant_id, "barcode")
        code = ean13_with_check(f"2{seq % 10**11:011d}")
        exists = await db.execute(select(Product.id).where(Product.tenant_id == tenant_id, Product.barcode == code))
        if exists.first() is None:
            product.barcode = code
            break
    else:
        raise HTTPException(status_code=500, detail="Could not allocate a barcode, try again")
    await db.flush()
    await menu_history.record(db, tenant_id, product, access)
    await db.commit()
    return serialize_product(await _get_product(db, tenant_id, product.id))

def ean13_with_check(twelve: str) -> str:
    digits = [int(c) for c in twelve]
    total = sum(d * (3 if i % 2 else 1) for i, d in enumerate(digits))
    return twelve + str((10 - total % 10) % 10)

@router.post("/bulk-import")
async def bulk_import(data: BulkImportRequest, access: Access = Depends(require("menu.manage")), db=Depends(get_tenant_db)):
    """Create categories and products in one go (used by the menu-photo scanner)."""
    tenant_id = access.tenant_id
    cats = await db.execute(select(ProductCategory).where(ProductCategory.tenant_id == tenant_id))
    categories = {c.name.strip().lower(): c for c in cats.scalars().all()}
    prods = await db.execute(select(Product.name).where(Product.tenant_id == tenant_id, Product.is_active == True))
    existing_names = {n.strip().lower() for (n,) in prods.all()}

    created, skipped, new_products = 0, [], []
    for item in data.items:
        name = item.name.strip()
        if data.skip_duplicates and name.lower() in existing_names:
            skipped.append(name)
            continue
        category = None
        if item.category and item.category.strip():
            key = item.category.strip().lower()
            category = categories.get(key)
            if category is None:
                category = ProductCategory(id=uuid.uuid4(), tenant_id=tenant_id, name=item.category.strip(), sort_order=len(categories))
                db.add(category)
                categories[key] = category
            elif not category.is_active:
                category.is_active = True
        base = item.price
        if item.variants:
            base = min(v.price for v in item.variants)
        product = Product(id=uuid.uuid4(), tenant_id=tenant_id, name=name, base_price=base, tax_rate=item.tax_rate,
                          category_id=category.id if category else None, is_veg=item.is_veg,
                          print_to_kitchen=data.print_to_kitchen, sort_order=created)
        product.variants = []
        db.add(product)
        if item.variants:
            _sync_variants(product, item.variants)
        existing_names.add(name.lower())
        created += 1
        new_products.append(product)
    await db.flush()
    for product in new_products:
        await menu_history.record(db, tenant_id, product, access, change="Created (menu import)")
    await db.commit()
    logger.info(f"[Catalog] Bulk import created {created}, skipped {len(skipped)}", extra={"tenant_id": tenant_id})
    return {"created": created, "skipped": skipped}


# --- Menu history (every change is a version; nothing is overwritten) ---

@router.get("/products/{product_id}/history")
async def product_history(product_id: uuid.UUID, access: Access = Depends(require("menu.manage")), db=Depends(get_tenant_db)):
    from app.models import ProductVersion
    await _get_product(db, access.tenant_id, product_id)
    rows = (await db.execute(select(ProductVersion).where(ProductVersion.product_id == product_id, ProductVersion.tenant_id == access.tenant_id)
                             .order_by(ProductVersion.version.desc()).limit(200))).scalars().all()
    return [menu_history.serialize(v) for v in rows]

@router.post("/products/{product_id}/history/{version}/restore", response_model=ProductResponse)
async def restore_version(product_id: uuid.UUID, version: int, access: Access = Depends(require("menu.manage")), db=Depends(get_tenant_db)):
    """Put an item back as it was in an earlier version (recorded as a new version)."""
    from app.models import ProductVersion
    product = await _get_product(db, access.tenant_id, product_id)
    await menu_history.ensure_baseline(db, access.tenant_id, product)
    row = (await db.execute(select(ProductVersion).where(ProductVersion.product_id == product_id, ProductVersion.version == version,
                                                         ProductVersion.tenant_id == access.tenant_id))).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Version not found")
    snap = row.snapshot
    if snap.get("barcode") and snap["barcode"] != product.barcode:
        await _check_barcode_unique(db, access.tenant_id, snap["barcode"], exclude_id=product.id)
    for field in ("name", "description", "base_price", "cost_price", "is_veg", "print_to_kitchen", "track_stock", "is_active",
                  "unit", "sku", "barcode", "channel_prices"):
        if field in snap:
            setattr(product, field, snap[field])
    for field in ("category_id", "brand_id", "tax_class_id"):
        if field in snap:
            setattr(product, field, uuid.UUID(snap[field]) if snap[field] else None)
    if "variants" in snap:
        from app.schemas.catalog import VariantIn
        _sync_variants(product, [VariantIn(name=name, price=price) for name, price in snap["variants"]])
    await db.flush()
    await menu_history.record(db, access.tenant_id, await _get_product(db, access.tenant_id, product.id), access,
                              change=f"Restored version {version}")
    await db.commit()
    return serialize_product(await _get_product(db, access.tenant_id, product.id))


# --- Bulk menu edits (one request, one transaction; every item still gets its own menu version) ---

class BulkProducts(BaseModel):
    product_ids: List[uuid.UUID] = Field(min_length=1, max_length=2000)
    action: Literal["price_set", "price_pct", "price_add", "category", "channel_hide", "channel_show", "remove", "restore"]
    value: Optional[float] = Field(None, ge=-1_000_000, le=1_000_000)  # price / percent / ₹ change
    round_to_rupee: bool = True
    category_id: Optional[uuid.UUID] = None
    channel: Optional[str] = Field(None, max_length=20)

@router.post("/products/bulk")
async def bulk_products(data: BulkProducts, access: Access = Depends(require("menu.manage")), db=Depends(get_tenant_db)):
    tenant_id = access.tenant_id
    if data.action.startswith("price_") and data.value is None:
        raise HTTPException(status_code=422, detail="Enter the price or the change")
    if data.action in ("channel_hide", "channel_show"):
        code = (data.channel or "").upper()
        if code not in CHANNEL_CODES:
            raise HTTPException(status_code=422, detail="Choose a sales channel")
    if data.action == "category" and data.category_id:
        await _check_refs(db, tenant_id, data.category_id, None)
    products = (await db.execute(select(Product).options(selectinload(Product.variants))
                                 .where(Product.tenant_id == tenant_id, Product.id.in_(data.product_ids)))).scalars().all()
    found = {p.id for p in products}
    skipped = [{"id": str(pid), "reason": "Not found"} for pid in data.product_ids if pid not in found]
    updated = 0
    for product in products:
        await menu_history.ensure_baseline(db, tenant_id, product)
        old_base = Decimal(product.base_price)
        if data.action.startswith("price_"):
            value = Decimal(str(data.value))
            if data.action == "price_set":
                new_base = value
            elif data.action == "price_pct":
                new_base = old_base * (1 + value / 100)
            else:
                new_base = old_base + value
            new_base = new_base.quantize(Decimal("1") if data.round_to_rupee else Decimal("0.01"), rounding="ROUND_HALF_UP")
            if new_base < 0:
                skipped.append({"id": str(product.id), "reason": "Price would go below zero"})
                continue
            if data.action == "price_pct":  # options keep their share: every absolute option price moves by the same %
                for v in product.variants:
                    absolute = (old_base + Decimal(v.price_modifier)) * (1 + value / 100)
                    absolute = absolute.quantize(Decimal("1") if data.round_to_rupee else Decimal("0.01"), rounding="ROUND_HALF_UP")
                    v.price_modifier = absolute - new_base
            # set / ₹ change: every option keeps its difference from the item price, so it moves with it
            product.base_price = new_base
        elif data.action == "category":
            product.category_id = data.category_id
        elif data.action in ("channel_hide", "channel_show"):
            prices = dict(product.channel_prices or {})
            entry = dict(prices.get(code) or {})
            if data.action == "channel_hide":
                entry["available"] = False
            else:
                entry.pop("available", None)
            if entry:
                prices[code] = entry
            else:
                prices.pop(code, None)
            product.channel_prices = prices or None
        elif data.action == "remove":
            product.is_active = False
        elif data.action == "restore":
            product.is_active = True
        await db.flush()
        await menu_history.record(db, tenant_id, product, access)
        updated += 1
    await db.commit()
    logger.info(f"[Catalog] Bulk {data.action}: {updated} updated, {len(skipped)} skipped", extra={"tenant_id": tenant_id})
    fresh = (await db.execute(select(Product).options(selectinload(Product.variants))
                              .where(Product.tenant_id == tenant_id, Product.id.in_(list(found)))
                              .execution_options(populate_existing=True))).scalars().all() if found else []
    return {"updated": updated, "skipped": skipped, "products": [serialize_product(p) for p in fresh]}
