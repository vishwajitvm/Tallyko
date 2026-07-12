from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.sql import func, desc
from app.core.tenant import get_db_session
from app.models.models import Order, OrderItem, Product, InventoryLog, TenantUser

router = APIRouter(prefix="/analytics", tags=["Analytics"])

@router.get("/dashboard")
async def get_dashboard(request: Request, db: AsyncSession = Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    
    # Calculate Total Revenue
    revenue_result = await db.execute(
        select(func.sum(Order.total_amount))
        .where(Order.status == 'completed')
        .where(Order.tenant_id == tenant_id)
    )
    total_revenue = revenue_result.scalar() or 0.0

    # Calculate Total Orders
    orders_result = await db.execute(
        select(func.count(Order.id))
        .where(Order.status == 'completed')
        .where(Order.tenant_id == tenant_id)
    )
    total_orders = orders_result.scalar() or 0

    # Calculate Average Order Value
    avg_order_value = (total_revenue / total_orders) if total_orders > 0 else 0.0

    # Calculate Top Products
    top_products_result = await db.execute(
        select(Product.name, func.sum(OrderItem.quantity).label('total_sold'))
        .join(OrderItem, OrderItem.product_id == Product.id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.status == 'completed')
        .where(Order.tenant_id == tenant_id)
        .group_by(Product.name)
        .order_by(desc('total_sold'))
        .limit(5)
    )
    top_products = [{"name": row.name, "sold": row.total_sold} for row in top_products_result]

    return {
        "total_revenue": float(total_revenue),
        "total_orders": total_orders,
        "average_order_value": float(avg_order_value),
        "top_products": top_products
    }

@router.get("/reports/sales")
async def get_sales_report(request: Request, db: AsyncSession = Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    
    result = await db.execute(
        select(Order.id, Order.total_amount, Order.type, Order.status)
        .where(Order.tenant_id == tenant_id)
        .where(Order.status == 'completed')
    )
    orders = result.all()
    return [{"id": str(r.id), "amount": float(r.total_amount), "type": r.type, "status": r.status} for r in orders]

@router.get("/reports/wastage")
async def get_wastage_report(request: Request, db: AsyncSession = Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    
    result = await db.execute(
        select(InventoryLog.reason, InventoryLog.quantity_change, Product.name)
        .join(Product, Product.id == InventoryLog.product_id)
        .where(InventoryLog.tenant_id == tenant_id)
        .where(InventoryLog.reason == 'wastage')
    )
    logs = result.all()
    return [{"product": r.name, "quantity_change": r.quantity_change, "reason": r.reason} for r in logs]

@router.get("/reports/staff")
async def get_staff_report(request: Request, db: AsyncSession = Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    
    result = await db.execute(
        select(TenantUser.username, TenantUser.role)
        .where(TenantUser.tenant_id == tenant_id)
    )
    users = result.all()
    return [{"username": r.username, "role": r.role} for r in users]
