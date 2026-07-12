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
    base_price: float
    category_id: Optional[UUID] = None
    barcode: Optional[str] = None
    print_to_kitchen: bool = False

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    base_price: Optional[float] = None
    category_id: Optional[UUID] = None
    barcode: Optional[str] = None
    print_to_kitchen: Optional[bool] = None
    is_active: Optional[bool] = None

class ProductResponse(BaseModel):
    id: UUID
    name: str
    base_price: float
    category_id: Optional[UUID]
    is_active: bool
    print_to_kitchen: bool
    class Config:
        orm_mode = True
