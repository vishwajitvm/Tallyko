from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.sql import func
from app.db.database import get_db
from app.models.models import Order

router = APIRouter(prefix="/analytics", tags=["Analytics"])

@router.get("/dashboard")
async def get_dashboard(db: AsyncSession = Depends(get_db)):
    # Calculate Total Revenue
    revenue_result = await db.execute(select(func.sum(Order.total_amount)).where(Order.status == 'completed'))
    total_revenue = revenue_result.scalar() or 0.0

    # Calculate Total Orders
    orders_result = await db.execute(select(func.count(Order.id)).where(Order.status == 'completed'))
    total_orders = orders_result.scalar() or 0

    # Calculate Average Order Value
    avg_order_value = (total_revenue / total_orders) if total_orders > 0 else 0.0

    return {
        "total_revenue": float(total_revenue),
        "total_orders": total_orders,
        "average_order_value": float(avg_order_value)
    }
