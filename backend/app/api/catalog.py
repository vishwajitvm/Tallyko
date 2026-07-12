from fastapi import APIRouter, Depends, Request
from typing import List
from sqlalchemy.future import select
from app.core.tenant import get_db_session
from app.models.models import Product, ProductCategory
from app.schemas.catalog import ProductCreate, ProductUpdate, ProductResponse, CategoryCreate, CategoryResponse
import logging
from fastapi import HTTPException

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/catalog", tags=["Catalog"])

@router.post("/categories", response_model=CategoryResponse)
async def create_category(request: Request, data: CategoryCreate, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    logger.info(f"[Catalog] Creating category '{data.name}' for tenant {tenant_id}")
    new_cat = ProductCategory(tenant_id=tenant_id, name=data.name)
    db.add(new_cat)
    await db.commit()
    await db.refresh(new_cat)
    logger.info(f"[Catalog] Successfully created category {new_cat.id}")
    return new_cat

@router.get("/products", response_model=List[ProductResponse])
async def get_products(request: Request, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    result = await db.execute(select(Product).where(Product.tenant_id == tenant_id).where(Product.is_active == True))
    return result.scalars().all()

@router.post("/products", response_model=ProductResponse)
async def create_product(request: Request, data: ProductCreate, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    new_prod = Product(tenant_id=tenant_id, name=data.name, base_price=data.base_price, category_id=data.category_id, barcode=data.barcode, print_to_kitchen=data.print_to_kitchen)
    db.add(new_prod)
    await db.commit()
    await db.refresh(new_prod)
    logger.info(f"[Catalog] Product created: {new_prod.id} for tenant {tenant_id}")
    return new_prod

@router.put("/products/{product_id}", response_model=ProductResponse)
async def update_product(product_id: str, request: Request, data: ProductUpdate, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    result = await db.execute(select(Product).where(Product.id == product_id).where(Product.tenant_id == tenant_id))
    product = result.scalars().first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    update_data = data.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(product, key, value)
        
    await db.commit()
    await db.refresh(product)
    logger.info(f"[Catalog] Product updated: {product_id} for tenant {tenant_id}")
    return product

@router.delete("/products/{product_id}")
async def delete_product(product_id: str, request: Request, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    result = await db.execute(select(Product).where(Product.id == product_id).where(Product.tenant_id == tenant_id))
    product = result.scalars().first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
        
    # Soft delete
    product.is_active = False
    await db.commit()
    logger.info(f"[Catalog] Product soft-deleted: {product_id} for tenant {tenant_id}")
    return {"success": True, "message": "Product deleted successfully"}
