from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from pydantic import BaseModel
from app.core.tenant import get_db_session
from app.models.models import Product, InventoryLog
from typing import List

router = APIRouter(prefix="/inventory", tags=["Inventory"])

class ReceiveStockRequest(BaseModel):
    product_id: str
    quantity: int
    location_id: str

@router.get("/")
async def get_inventory(db: AsyncSession = Depends(get_db_session)):
    query = select(
        Product,
        func.coalesce(func.sum(InventoryLog.quantity_change), 0).label('stock_count')
    ).outerjoin(
        InventoryLog, Product.id == InventoryLog.product_id
    ).group_by(Product.id)

    result = await db.execute(query)
    rows = result.all()
    
    inventory_data = []
    for product, stock_count in rows:
        inventory_data.append({
            "id": str(product.id),
            "name": product.name,
            "category_id": str(product.category_id) if product.category_id else "Uncategorized",
            "barcode": product.barcode,
            "stock_count": int(stock_count),
            "low_stock_threshold": 20
        })
    return inventory_data

@router.post("/receive")
async def receive_inventory(data: ReceiveStockRequest, request: Request, db: AsyncSession = Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    log = InventoryLog(
        tenant_id=tenant_id,
        product_id=data.product_id,
        location_id=data.location_id,
        quantity_change=data.quantity,
        reason='restock'
    )
    db.add(log)
    await db.commit()
    return {"message": "Inventory received successfully"}
