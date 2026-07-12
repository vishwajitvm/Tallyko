from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.db.database import get_db
from app.models.models import Customer
from typing import List

router = APIRouter(prefix="/crm", tags=["Crm"])

@router.get("/customers")
async def get_customers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Customer))
    customers = result.scalars().all()
    
    # Calculate tiers based on points
    def get_tier(points):
        if points >= 500: return 'Gold'
        if points >= 100: return 'Silver'
        return 'Bronze'
        
    return [
        {
            "id": str(c.id),
            "name": c.name,
            "phone": c.phone,
            "email": c.email,
            "points": c.points,
            "tier": get_tier(c.points)
        }
        for c in customers
    ]

@router.post("/customers")
async def create_customer(name: str, phone: str, db: AsyncSession = Depends(get_db)):
    return {"message": "Customer created"}
