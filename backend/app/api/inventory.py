from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db.database import get_db
from app.models.models import Product, InventoryLog
from typing import List

router = APIRouter(prefix="/inventory", tags=["Inventory"])

@router.get("/")
async def get_inventory(db: AsyncSession = Depends(get_db)):
    # Fetch all products and mock inventory sum for MVP
    # In production, this would be a JOIN with SUM(InventoryLog.quantity_change)
    result = await db.execute(select(Product))
    products = result.scalars().all()
    
    inventory_data = []
    for product in products:
        inventory_data.append({
            "id": str(product.id),
            "name": product.name,
            "category_id": str(product.category_id) if product.category_id else "Uncategorized",
            "barcode": product.barcode,
            "stock_count": 42, # Mocked for MVP
            "low_stock_threshold": 20
        })
    return inventory_data

@router.post("/receive")
async def receive_inventory():
    return {"message": "Inventory received successfully"}
