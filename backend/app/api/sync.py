from fastapi import APIRouter, Depends, Request
from sqlalchemy.future import select
from app.core.tenant import get_db_session
from app.schemas.sync import SyncPullRequest, SyncPushRequest
import logging
import time

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/sync", tags=["Sync"])

@router.post("/pull")
async def sync_pull(request: Request, data: SyncPullRequest, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    logger.info(f"[Sync] Pull requested for tenant {tenant_id} at {data.last_pulled_at}")
    # Basic stub for WatermelonDB pull format
    return {
        "changes": {},
        "timestamp": int(time.time())
    }

@router.post("/push")
async def sync_push(request: Request, data: SyncPushRequest, db=Depends(get_db_session)):
    tenant_id = request.state.tenant_id if hasattr(request.state, 'tenant_id') else "00000000-0000-0000-0000-000000000000"
    logger.info(f"[Sync] Push received for tenant {tenant_id} with changes: {data.changes}")
    # A real implementation would parse data.changes and apply them to the DB within a transaction.
    # We will just accept it for now as a stub.
    return {"success": True}
