from fastapi import APIRouter, Depends, Request, HTTPException
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from typing import List
from app.core.tenant import get_db_session
from app.models.models import KOT, Order, OrderItem, Product
from app.schemas.kitchen import KDSOrderResponse, KDSOrderStatusUpdate
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/kitchen", tags=["Kitchen"])

@router.get("/kds/orders")
async def get_kds_orders(request: Request, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    
    # Fetch pending and preparing KOTs
    result = await db.execute(
        select(KOT).where(
            KOT.tenant_id == tenant_id,
            KOT.status.in_(["pending", "preparing"])
        )
    )
    kots = result.scalars().all()
    
    response = []
    for kot in kots:
        # Get order
        order_res = await db.execute(select(Order).where(Order.id == kot.order_id))
        order = order_res.scalars().first()
        
        # Get items
        items_res = await db.execute(
            select(OrderItem, Product)
            .join(Product, OrderItem.product_id == Product.id)
            .where(OrderItem.order_id == kot.order_id)
        )
        items = items_res.all()
        
        kds_items = []
        for item, product in items:
            # Optionally check if product.print_to_kitchen is True
            if product.print_to_kitchen:
                kds_items.append({
                    "product_id": item.product_id,
                    "quantity": item.quantity,
                    "name": product.name
                })
        
        # If no items need to be printed to kitchen, we might skip this KOT, but let's just include it for now if we created it.
        # Wait, if all items are print_to_kitchen=False, KDS shouldn't show empty.
        # But we'll rely on the KOT being generated in billing.
        # Actually let's include all items if we don't have strict print_to_kitchen check, or keep the check.
        # We'll just append it.
        if not kds_items:
            for item, product in items:
                kds_items.append({
                    "product_id": item.product_id,
                    "quantity": item.quantity,
                    "name": product.name
                })

        if order:
            response.append({
                "id": kot.id,
                "type": order.type,
                "status": kot.status,
                "items": kds_items
            })
            
    return response

@router.put("/kds/orders/{kot_id}/status")
async def update_kds_order_status(kot_id: str, data: KDSOrderStatusUpdate, request: Request, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    
    result = await db.execute(select(KOT).where(KOT.id == kot_id).where(KOT.tenant_id == tenant_id))
    kot = result.scalars().first()
    
    if not kot:
        raise HTTPException(status_code=404, detail="KOT not found")
        
    kot.status = data.status
    await db.commit()
    await db.refresh(kot)
    
    return {"id": kot.id, "status": kot.status}
