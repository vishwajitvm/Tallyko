from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.tenant import get_db_session
from app.models.models import Product

router = APIRouter(prefix="/qr-menu", tags=["QR Menu"])

@router.get("/{tenant_id}")
async def get_qr_menu(tenant_id: str, db: AsyncSession = Depends(get_db_session)):
    # Returns products for a tenant directly (public access for QR menus)
    result = await db.execute(select(Product).where(Product.tenant_id == tenant_id, Product.is_active == True))
    products = result.scalars().all()
    
    return [
        {
            "id": str(p.id),
            "name": p.name,
            "base_price": float(p.base_price),
            "category_id": str(p.category_id) if p.category_id else None
        }
        for p in products
    ]
