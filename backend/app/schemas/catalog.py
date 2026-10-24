from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from uuid import UUID

TAX_RATES = (0, 0.25, 3, 5, 12, 18, 28)

class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    sort_order: int = Field(0, ge=0, le=100000)

class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=60)
    sort_order: Optional[int] = Field(None, ge=0, le=100000)
    is_active: Optional[bool] = None

class CategoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    sort_order: int = 0
    is_active: bool = True

class VariantIn(BaseModel):
    id: Optional[UUID] = None
    name: str = Field(min_length=1, max_length=40)
    price: float = Field(ge=0, le=1_000_000)  # absolute price of this option

class ProductBase(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=500)
    base_price: Optional[float] = Field(None, ge=0, le=1_000_000)
    cost_price: Optional[float] = Field(None, ge=0, le=1_000_000)
    tax_rate: Optional[float] = Field(None, ge=0, le=40)  # deprecated: prefer tax_class_id
    tax_class_id: Optional[UUID] = None  # GST class; empty = business default
    channel_prices: Optional[dict] = None  # {"SWIGGY": {"price": 260}, "ONLINE": {"available": false}}
    category_id: Optional[UUID] = None
    brand_id: Optional[UUID] = None
    barcode: Optional[str] = Field(None, max_length=48, pattern=r"^[0-9A-Za-z\-\. ]*$")
    sku: Optional[str] = Field(None, max_length=48)
    unit: Optional[str] = Field(None, max_length=12)
    is_veg: Optional[bool] = None
    print_to_kitchen: Optional[bool] = None
    track_stock: Optional[bool] = None
    low_stock_threshold: Optional[int] = Field(None, ge=0, le=1_000_000)
    sort_order: Optional[int] = Field(None, ge=0, le=100000)
    variants: Optional[List[VariantIn]] = Field(None, max_length=20)

class ProductCreate(ProductBase):
    name: str = Field(min_length=1, max_length=120)
    base_price: float = Field(ge=0, le=1_000_000)
    print_to_kitchen: bool = False
    opening_stock: Optional[int] = Field(None, ge=0, le=1_000_000)

class ProductUpdate(ProductBase):
    is_active: Optional[bool] = None

class VariantResponse(BaseModel):
    id: UUID
    name: str
    price: float

class ProductResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    base_price: float
    cost_price: Optional[float] = None
    tax_rate: Optional[float] = None
    tax_class_id: Optional[UUID] = None
    channel_prices: Optional[dict] = None
    category_id: Optional[UUID] = None
    brand_id: Optional[UUID] = None
    barcode: Optional[str] = None
    sku: Optional[str] = None
    unit: str = "pcs"
    is_veg: Optional[bool] = None
    is_active: bool = True
    print_to_kitchen: bool = False
    track_stock: bool = False
    low_stock_threshold: Optional[int] = None
    sort_order: int = 0
    variants: List[VariantResponse] = []

class BulkImportItem(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    price: float = Field(ge=0, le=1_000_000)
    category: Optional[str] = Field(None, max_length=60)
    tax_rate: Optional[float] = Field(None, ge=0, le=40)
    is_veg: Optional[bool] = None
    variants: List[VariantIn] = Field(default_factory=list, max_length=20)

class BulkImportRequest(BaseModel):
    items: List[BulkImportItem] = Field(min_length=1, max_length=500)
    print_to_kitchen: bool = True
    skip_duplicates: bool = True
