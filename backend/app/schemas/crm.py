from pydantic import BaseModel, UUID4
from typing import Optional, List
from datetime import datetime

class CustomerCreate(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None

class CustomerResponse(BaseModel):
    id: UUID4
    name: str
    phone: str
    email: Optional[str] = None
    points: int
    tier: str

    class Config:
        from_attributes = True

class OrderHistoryResponse(BaseModel):
    id: UUID4
    total_amount: float
    type: str
    status: str
    created_at: datetime
    
    class Config:
        from_attributes = True

class CustomerDetailResponse(CustomerResponse):
    orders: List[OrderHistoryResponse] = []
