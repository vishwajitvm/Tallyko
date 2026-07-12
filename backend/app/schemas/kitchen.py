from pydantic import BaseModel
from uuid import UUID
from typing import List

class KDSItem(BaseModel):
    product_id: UUID
    quantity: int
    name: str

class KDSOrderResponse(BaseModel):
    id: UUID
    type: str
    status: str
    items: List[KDSItem]

    class Config:
        orm_mode = True

class KDSOrderStatusUpdate(BaseModel):
    status: str
