from fastapi import APIRouter, Depends, Request, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.tenant import get_db_session
from app.models.models import Customer, Order
from app.schemas.crm import CustomerCreate, CustomerResponse, CustomerDetailResponse, OrderHistoryResponse
from typing import List

router = APIRouter(prefix="/crm", tags=["Crm"])

def get_tier(points):
    if points >= 500: return 'Gold'
    if points >= 100: return 'Silver'
    return 'Bronze'

@router.get("/customers", response_model=List[CustomerResponse])
async def get_customers(request: Request, db: AsyncSession = Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    result = await db.execute(select(Customer).where(Customer.tenant_id == tenant_id))
    customers = result.scalars().all()
    
    return [
        CustomerResponse(
            id=c.id,
            name=c.name,
            phone=c.phone,
            email=c.email,
            points=c.points,
            tier=get_tier(c.points)
        )
        for c in customers
    ]

@router.post("/customers", response_model=CustomerResponse)
async def create_customer(request: Request, data: CustomerCreate, db: AsyncSession = Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    
    result = await db.execute(select(Customer).where(Customer.phone == data.phone, Customer.tenant_id == tenant_id))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="Customer with this phone already exists")
        
    new_customer = Customer(
        tenant_id=tenant_id,
        name=data.name,
        phone=data.phone,
        email=data.email,
        points=0
    )
    db.add(new_customer)
    await db.commit()
    await db.refresh(new_customer)
    
    return CustomerResponse(
        id=new_customer.id,
        name=new_customer.name,
        phone=new_customer.phone,
        email=new_customer.email,
        points=new_customer.points,
        tier=get_tier(new_customer.points)
    )

@router.get("/customers/{customer_id}", response_model=CustomerDetailResponse)
async def get_customer_detail(customer_id: str, request: Request, db: AsyncSession = Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    result = await db.execute(select(Customer).where(Customer.id == customer_id, Customer.tenant_id == tenant_id))
    customer = result.scalars().first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
        
    orders_result = await db.execute(select(Order).where(Order.customer_id == customer_id, Order.tenant_id == tenant_id).order_by(Order.created_at.desc()))
    orders = orders_result.scalars().all()
    
    return CustomerDetailResponse(
        id=customer.id,
        name=customer.name,
        phone=customer.phone,
        email=customer.email,
        points=customer.points,
        tier=get_tier(customer.points),
        orders=[
            OrderHistoryResponse(
                id=o.id,
                total_amount=float(o.total_amount),
                type=o.type,
                status=o.status,
                created_at=o.created_at
            ) for o in orders
        ]
    )
