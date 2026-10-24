import uuid
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.tenant import get_tenant_db
from app.services.access import Access, get_access, require
from app.models import Product, InventoryLog
from app.services.settings_service import get_default_location, get_settings
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/inventory", tags=["Inventory"])

class StockAdjustment(BaseModel):
    product_id: uuid.UUID
    quantity: int = Field(ge=-1_000_000, le=1_000_000)
    reason: Literal["restock", "wastage", "adjustment", "return"]
    note: str | None = Field(None, max_length=200)
    unit_cost: float | None = Field(None, ge=0, le=1_000_000)

class ReceiveStockRequest(BaseModel):  # legacy shape
    product_id: uuid.UUID
    quantity: int = Field(gt=0, le=1_000_000)
    location_id: uuid.UUID | None = None

async def _stock_levels(db: AsyncSession, tenant_id: str) -> list[dict]:
    settings = await get_settings(db, tenant_id)
    query = select(
        Product, func.coalesce(func.sum(InventoryLog.quantity_change), 0).label("stock")
    ).outerjoin(
        InventoryLog, (Product.id == InventoryLog.product_id) & (InventoryLog.tenant_id == tenant_id)
    ).where(Product.tenant_id == tenant_id, Product.is_active == True, Product.track_stock == True).group_by(Product.id).order_by(Product.name)
    rows = (await db.execute(query)).all()
    data = []
    for product, stock in rows:
        threshold = product.low_stock_threshold if product.low_stock_threshold is not None else settings.low_stock_default
        data.append({
            "id": str(product.id), "name": product.name, "category_id": str(product.category_id) if product.category_id else None,
            "barcode": product.barcode, "unit": product.unit, "stock": int(stock), "low_stock_threshold": threshold,
            "is_low": int(stock) <= threshold, "cost_price": float(product.cost_price) if product.cost_price is not None else None,
            "stock_value": float((product.cost_price or 0) * max(int(stock), 0)),
        })
    return data

@router.get("")
async def get_inventory(response: Response, q: str | None = Query(None, max_length=60),
                        filter: str | None = Query(None, pattern="^(low|out)$"),
                        limit: int | None = Query(None, ge=1, le=1000), offset: int = Query(0, ge=0),
                        access: Access = Depends(require("inventory.view", feature="inventory")), db: AsyncSession = Depends(get_tenant_db)):
    """All tracked items by default; `q`, `filter=low|out` and paging for big stores. Counts in `X-Counts` (all/low/out)."""
    import json
    rows = await _stock_levels(db, access.tenant_id)
    response.headers["X-Counts"] = json.dumps({"all": len(rows), "low": sum(1 for r in rows if r["is_low"]),
                                               "out": sum(1 for r in rows if r["stock"] <= 0)})
    if q:
        term = q.strip().lower()
        rows = [r for r in rows if term in r["name"].lower() or (r["barcode"] or "") == q.strip()]
    if filter == "low":
        rows = [r for r in rows if r["is_low"]]
    elif filter == "out":
        rows = [r for r in rows if r["stock"] <= 0]
    response.headers["X-Total-Count"] = str(len(rows))
    return rows[offset:offset + limit] if limit is not None else rows

@router.get("/low-stock")
async def low_stock(access: Access = Depends(require("inventory.view", feature="inventory")), db: AsyncSession = Depends(get_tenant_db)):
    return [row for row in await _stock_levels(db, access.tenant_id) if row["is_low"]]

@router.get("/logs")
async def stock_logs(product_id: uuid.UUID | None = None, limit: int = Query(100, ge=1, le=500),
                     access: Access = Depends(require("inventory.view", feature="inventory")), db: AsyncSession = Depends(get_tenant_db)):
    query = select(InventoryLog, Product.name).join(Product, Product.id == InventoryLog.product_id).where(InventoryLog.tenant_id == access.tenant_id)
    if product_id:
        query = query.where(InventoryLog.product_id == product_id)
    rows = (await db.execute(query.order_by(InventoryLog.created_at.desc()).limit(limit))).all()
    return [{"id": str(log.id), "product_id": str(log.product_id), "product_name": name, "quantity_change": log.quantity_change,
             "reason": log.reason, "note": log.note, "created_at": log.created_at.isoformat() + "Z"} for log, name in rows]

@router.post("/adjust")
async def adjust_stock(data: StockAdjustment, access: Access = Depends(require("inventory.manage", feature="inventory")), db: AsyncSession = Depends(get_tenant_db)):
    tenant_id = access.tenant_id
    result = await db.execute(select(Product).where(Product.id == data.product_id, Product.tenant_id == tenant_id))
    product = result.scalars().first()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    if data.quantity == 0:
        raise HTTPException(status_code=400, detail="Quantity cannot be zero")
    quantity = data.quantity
    if data.reason == "wastage" and quantity > 0:
        quantity = -quantity  # wastage always reduces stock
    location = await get_default_location(db, tenant_id)
    product.track_stock = True
    if data.unit_cost is not None and data.reason == "restock":
        product.cost_price = data.unit_cost
    db.add(InventoryLog(tenant_id=tenant_id, product_id=product.id, location_id=location.id, quantity_change=quantity,
                        reason=data.reason, note=data.note, unit_cost=data.unit_cost))
    await db.commit()
    logger.info(f"[Inventory] {data.reason} {quantity} of {product.id}", extra={"tenant_id": tenant_id})
    return {"success": True}

@router.post("/receive")
async def receive_inventory(data: ReceiveStockRequest, access: Access = Depends(require("inventory.manage", feature="inventory")), db: AsyncSession = Depends(get_tenant_db)):
    return await adjust_stock(StockAdjustment(product_id=data.product_id, quantity=data.quantity, reason="restock"), access, db)
