from fastapi import APIRouter, Depends, Request
from sqlalchemy.future import select
from app.core.tenant import get_db_session
from app.models.models import Order, OrderItem
from app.schemas.billing import OrderCreate, OrderResponse
from tracenest import trace
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/billing", tags=["Billing"])

@router.post("/orders", response_model=OrderResponse)
@trace(name="billing_create_order")
async def create_order(request: Request, data: OrderCreate, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "default-tenant-uuid"
    logger.info(f"[Billing] Creating new order for tenant {tenant_id} at location {data.location_id}")
    
    # Calculate totals
    subtotal = sum(item.price * item.quantity for item in data.items)
    tax_total = subtotal * 0.05 # Mock 5% tax
    total = subtotal + tax_total

    new_order = Order(
        tenant_id=tenant_id,
        location_id=data.location_id,
        type=data.order_type,
        total_amount=total
    )
    db.add(new_order)
    await db.flush() # get ID

    for item in data.items:
        db.add(OrderItem(
            order_id=new_order.id,
            product_id=item.product_id,
            quantity=item.quantity,
            price=item.price
        ))
    
    await db.commit()
    await db.refresh(new_order)
    return new_order
