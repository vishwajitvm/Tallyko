"""Offline sync.

pull: the app caches the menu, tables, settings, channels, brands and recent customers so billing works without internet.
push: orders created offline (with client-generated ids) are replayed here; each one is idempotent, so retrying is safe.
"""
from datetime import datetime, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from app.core.tenant import get_tenant_db
from app.services.access import Access, get_access, require
from app.models import Product, ProductCategory, TableEntity, Customer, Brand, TaxClass
from app.schemas.billing import OrderCreate
from app.services import order_service
from app.services.settings_service import get_settings, ensure_channels
from app.api.catalog import serialize_product
from app.api.admin import serialize_settings, serialize_channel
from app.api.crm import serialize_customer
from app.core.gstin import charges_gst
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/sync", tags=["Sync"])

class SyncPullRequest(BaseModel):
    since: datetime | None = None  # last server_time the client received; null = full snapshot

class SyncPushRequest(BaseModel):
    orders: List[OrderCreate] = Field(default_factory=list, max_length=200)

@router.post("/pull")
async def sync_pull(data: SyncPullRequest, access: Access = Depends(get_access), db: AsyncSession = Depends(get_tenant_db)):
    tenant_id = access.tenant_id
    server_time = datetime.utcnow()
    since = data.since
    if since is not None and since.tzinfo is not None:
        since = (since - since.utcoffset()).replace(tzinfo=None)
    if since is not None:
        since -= timedelta(seconds=5)  # overlap guards against clock skew between app servers

    def changed(model):
        query = select(model).where(model.tenant_id == tenant_id)
        return query.where(model.updated_at > since) if since else query

    products = (await db.execute(changed(Product).options(selectinload(Product.variants)))).scalars().all()
    categories = (await db.execute(changed(ProductCategory))).scalars().all()
    tables = (await db.execute(changed(TableEntity))).scalars().all()
    brands = (await db.execute(changed(Brand))).scalars().all()
    customers_query = changed(Customer).order_by(Customer.updated_at.desc()).limit(2000)
    customers = (await db.execute(customers_query)).scalars().all()
    settings = await get_settings(db, tenant_id)
    channels = await ensure_channels(db, tenant_id)
    # Always the full (small) set: a scheduled rate change takes effect without any row changing
    tax_classes = (await db.execute(select(TaxClass).options(selectinload(TaxClass.rates)).where(TaxClass.tenant_id == tenant_id))).scalars().all()
    await db.commit()

    return {
        "server_time": server_time.isoformat() + "Z",
        "full": since is None,
        "settings": serialize_settings(settings),
        "channels": [serialize_channel(c) for c in channels],
        "categories": [{"id": str(c.id), "name": c.name, "sort_order": c.sort_order, "is_active": c.is_active} for c in categories],
        "products": [serialize_product(p) for p in products],
        "tables": [{"id": str(t.id), "table_number": t.table_number, "section": t.section, "capacity": t.capacity, "is_active": t.is_active}
                   for t in tables],
        "brands": [{"id": str(b.id), "name": b.name, "is_active": b.is_active} for b in brands],
        "customers": [serialize_customer(c) for c in customers],
        # Lets the device preview the right GST offline: product.tax_class_id → rate in effect now (server re-prices anyway)
        "tax": {
            # what bills actually do: "regular" only with a valid GSTIN
            "registration": settings.gst_registration if charges_gst(settings.gst_registration, settings.gstin) or settings.gst_registration != "regular" else "unregistered",
            "default_tax_class_id": str(settings.default_tax_class_id) if settings.default_tax_class_id else None,
            "classes": [{"id": str(c.id), "name": c.name, "is_active": c.is_active,
                         "rates": [{"effective_from": r.effective_from.isoformat() + "Z", "total_rate": float(r.total_rate)} for r in c.rates]}
                        for c in tax_classes],
        },
    }

@router.post("/push")
async def sync_push(data: SyncPushRequest, access: Access = Depends(require("orders.create")), db: AsyncSession = Depends(get_tenant_db)):
    tenant_id = access.tenant_id
    results = []
    for order_in in data.orders:
        if order_in.id is None:
            results.append({"id": None, "status": "error", "error": "Offline orders need a client id", "code": 400})
            continue
        if order_in.payments and not access.can("orders.pay"):
            results.append({"id": str(order_in.id), "status": "error", "error": "Only cashiers can take payments", "code": 403})
            continue
        order_in.new_bill = True  # an offline bill on a table that got another bill meanwhile becomes a separate bill
        if "auto_offers" not in order_in.model_fields_set:
            order_in.auto_offers = False  # an offline bill was paid at its offline total; never discount it afterwards
        try:
            async with db.begin_nested():  # one bad order must not undo the others
                order, created = await order_service.create_order(db, tenant_id, order_in, user_id=access.user_id, staff_id=access.staff_id)
            results.append({"id": str(order.id), "status": "ok", "created": created, "order": order_service.serialize_order(order)})
        except HTTPException as exc:
            results.append({"id": str(order_in.id), "status": "error", "error": exc.detail, "code": exc.status_code})
        except Exception:
            logger.exception(f"[Sync] Failed to sync offline order {order_in.id}", extra={"tenant_id": tenant_id})
            results.append({"id": str(order_in.id), "status": "error", "error": "Server error while saving this order", "code": 500})
    await db.commit()
    ok = sum(1 for r in results if r["status"] == "ok")
    logger.info(f"[Sync] order_synced {ok}/{len(results)}", extra={"tenant_id": tenant_id})
    return {"results": results}
