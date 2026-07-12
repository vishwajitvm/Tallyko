from fastapi import APIRouter, Depends, Request
from typing import List
from sqlalchemy.future import select
from app.core.tenant import get_db_session
from app.models.models import Product, ProductCategory
from app.schemas.catalog import ProductCreate, ProductResponse, CategoryCreate, CategoryResponse
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/catalog", tags=["Catalog"])

@router.post("/categories", response_model=CategoryResponse)
async def create_category(request: Request, data: CategoryCreate, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "default-tenant-uuid"
    logger.info(f"[Catalog] Creating category '{data.name}' for tenant {tenant_id}")
    new_cat = ProductCategory(tenant_id=tenant_id, name=data.name)
    db.add(new_cat)
    await db.commit()
    await db.refresh(new_cat)
    logger.info(f"[Catalog] Successfully created category {new_cat.id}")
    return new_cat

@router.get("/products", response_model=List[ProductResponse])
async def get_products(request: Request, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "default-tenant-uuid"
    result = await db.execute(select(Product).where(Product.tenant_id == tenant_id))
    return result.scalars().all()

@router.post("/products", response_model=ProductResponse)
async def create_product(request: Request, data: ProductCreate, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "default-tenant-uuid"
    new_prod = Product(tenant_id=tenant_id, name=data.name, price=data.price, category_id=data.category_id, sku=data.sku, barcode=data.barcode)
    db.add(new_prod)
    await db.commit()
    await db.refresh(new_prod)
    return new_prod
