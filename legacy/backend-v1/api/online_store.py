from fastapi import APIRouter, Depends
from sqlalchemy.future import select
from typing import List
from uuid import UUID
from pydantic import BaseModel
from app.core.security import TokenData, RoleChecker, get_current_user
from app.core.tenant import get_public_tenant_db
from app.models.models import Product, ProductCategory

router = APIRouter(prefix="/online-store", tags=["Online Store"])

# Mock state for MVP
store_enabled = True

class StoreSettings(BaseModel):
    enabled: bool

@router.get("/settings")
def get_store_settings(current_user: TokenData = Depends(get_current_user)):
    return {"enabled": store_enabled, "link": f"https://tallyko.com/store/{current_user.tenant_id}"}

@router.put("/settings")
def update_store_settings(settings: StoreSettings, current_user: TokenData = Depends(RoleChecker(["owner", "manager"]))):
    global store_enabled
    store_enabled = settings.enabled
    return {"message": "Settings updated", "enabled": store_enabled}

@router.get("/{tenant_id}/catalog")
async def get_public_catalog(tenant_id: UUID, db=Depends(get_public_tenant_db)):
    # Fetch public products for the tenant
    result = await db.execute(select(Product).where(Product.tenant_id == tenant_id).where(Product.is_active == True))
    products = result.scalars().all()
    
    cat_result = await db.execute(select(ProductCategory).where(ProductCategory.tenant_id == tenant_id))
    categories = cat_result.scalars().all()
    
    return {
        "tenant_id": tenant_id,
        "store_name": "Demo Tenant Store",
        "categories": [{"id": c.id, "name": c.name} for c in categories],
        "products": [{"id": p.id, "name": p.name, "price": p.base_price, "category_id": p.category_id, "image": "https://via.placeholder.com/150"} for p in products]
    }
