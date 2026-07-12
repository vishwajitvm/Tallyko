from fastapi import APIRouter, Depends, Request
from sqlalchemy.future import select
from typing import List
from app.core.tenant import get_db_session
from app.models.models import Order, OrderItem, Location, Payment, KOT
from app.schemas.billing import OrderCreate, OrderResponse, PaymentCreate
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/billing", tags=["Billing"])

@router.get("/orders", response_model=List[OrderResponse])
async def get_orders(request: Request, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    result = await db.execute(select(Order).where(Order.tenant_id == tenant_id))
    return result.scalars().all()

@router.post("/orders", response_model=OrderResponse)
async def create_order(request: Request, data: OrderCreate, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    
    loc_result = await db.execute(select(Location).where(Location.tenant_id == tenant_id))
    location = loc_result.scalars().first()
    if not location:
        location = Location(tenant_id=tenant_id, name="Default Location")
        db.add(location)
        await db.flush()
    
    location_id = location.id

    logger.info(f"[Billing] Creating new order for tenant {tenant_id} at location {location_id}")
    
    # Calculate totals
    subtotal = sum(item.price * item.quantity for item in data.items)
    tax_total = subtotal * 0.05 # Mock 5% tax
    total = subtotal + tax_total

    new_order = Order(
        tenant_id=tenant_id,
        location_id=location_id,
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
            unit_price=item.price,
            subtotal=item.price * item.quantity
        ))
        
    # Generate KOT
    new_kot = KOT(
        tenant_id=tenant_id,
        order_id=new_order.id,
        status="pending"
    )
    db.add(new_kot)
    
    await db.commit()
    await db.refresh(new_order)
    return new_order

@router.post("/payments")
async def create_payment(request: Request, data: PaymentCreate, db=Depends(get_db_session)):
    payment = Payment(
        order_id=data.order_id,
        method=data.method,
        amount=data.amount
    )
    db.add(payment)
    
    result = await db.execute(select(Order).where(Order.id == data.order_id))
    order = result.scalars().first()
    if order:
        order.status = "completed"
        
    await db.commit()
    return {"success": True, "payment_id": payment.id}
