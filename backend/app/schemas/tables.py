from pydantic import BaseModel
from typing import Optional
from uuid import UUID

class TableCreate(BaseModel):
    table_number: str
    capacity: int

class TableResponse(BaseModel):
    id: UUID
    table_number: str
    capacity: int
    is_active: bool

    class Config:
        orm_mode = True
