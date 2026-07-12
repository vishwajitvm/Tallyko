from fastapi import APIRouter, Depends, Request
from typing import List
from sqlalchemy.future import select
from app.core.tenant import get_db_session
from app.models.models import TableEntity, Location
from app.schemas.tables import TableCreate, TableResponse
import logging
from uuid import UUID

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/tables", tags=["Tables"])

@router.get("/", response_model=List[TableResponse])
async def get_tables(request: Request, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    result = await db.execute(select(TableEntity).where(TableEntity.tenant_id == tenant_id))
    tables = result.scalars().all()
    # Add fake is_active for the frontend response mapping
    for t in tables:
        t.is_active = True
    return tables

@router.post("/", response_model=TableResponse)
async def create_table(request: Request, data: TableCreate, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    
    # Ensure there is a location for the tenant
    loc_result = await db.execute(select(Location).where(Location.tenant_id == tenant_id))
    location = loc_result.scalars().first()
    if not location:
        location = Location(tenant_id=tenant_id, name="Default Location")
        db.add(location)
        await db.commit()
        await db.refresh(location)
        
    new_table = TableEntity(tenant_id=tenant_id, location_id=location.id, table_number=data.table_number, capacity=data.capacity)
    db.add(new_table)
    await db.commit()
    await db.refresh(new_table)
    new_table.is_active = True
    return new_table
