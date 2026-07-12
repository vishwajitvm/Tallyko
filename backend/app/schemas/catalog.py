from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID

class CategoryCreate(BaseModel):
    name: str

class CategoryResponse(BaseModel):
    id: UUID
    name: str
    class Config:
        orm_mode = True

class ProductCreate(BaseModel):
    name: str
    price: float
    category_id: Optional[UUID] = None
    sku: Optional[str] = None
    barcode: Optional[str] = None

class ProductResponse(BaseModel):
    id: UUID
    name: str
    price: float
    category_id: Optional[UUID]
    is_active: bool
    class Config:
        orm_mode = True
