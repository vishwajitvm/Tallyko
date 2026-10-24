from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.future import select
from typing import List
from app.core.security import TokenData, get_current_user
from app.core.tenant import get_tenant_db
from app.models.models import Order, OrderItem, Location, Payment, KOT, Product
from app.schemas.billing import OrderCreate, OrderResponse, PaymentCreate
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/billing", tags=["Billing"])

@router.get("/orders", response_model=List[OrderResponse])
async def get_orders(current_user: TokenData = Depends(get_current_user), db=Depends(get_tenant_db)):
    tenant_id = current_user.tenant_id
    result = await db.execute(select(Order).where(Order.tenant_id == tenant_id))
    return result.scalars().all()

@router.post("/orders", response_model=OrderResponse)
async def create_order(data: OrderCreate, current_user: TokenData = Depends(get_current_user), db=Depends(get_tenant_db)):
    tenant_id = current_user.tenant_id
    
    # Reject items that reference another tenant's products (FK checks bypass RLS)
    product_ids = {item.product_id for item in data.items}
    owned = await db.execute(select(Product.id).where(Product.id.in_(product_ids)).where(Product.tenant_id == tenant_id))
    if len(owned.all()) != len(product_ids):
        raise HTTPException(status_code=404, detail="Product not found")

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
async def create_payment(data: PaymentCreate, current_user: TokenData = Depends(get_current_user), db=Depends(get_tenant_db)):
    tenant_id = current_user.tenant_id
    result = await db.execute(select(Order).where(Order.id == data.order_id).where(Order.tenant_id == tenant_id))
    order = result.scalars().first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    payment = Payment(
        order_id=order.id,
        method=data.method,
        amount=data.amount
    )
    db.add(payment)
    order.status = "completed"

    await db.commit()
    return {"success": True, "payment_id": payment.id}
