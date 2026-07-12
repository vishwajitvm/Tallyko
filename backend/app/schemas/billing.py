from pydantic import BaseModel
from typing import List
from uuid import UUID

class OrderItemCreate(BaseModel):
    product_id: UUID
    quantity: int
    price: float

class OrderCreate(BaseModel):
    location_id: UUID
    order_type: str
    items: List[OrderItemCreate]

class OrderResponse(BaseModel):
    id: UUID
    status: str
    total: float
    class Config:
        orm_mode = True

class PaymentCreate(BaseModel):
    order_id: UUID
    amount: float
    method: str
