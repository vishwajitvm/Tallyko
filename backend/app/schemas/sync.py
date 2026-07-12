from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from uuid import UUID

class SyncPullRequest(BaseModel):
    last_pulled_at: Optional[int] = None
    schema_version: Optional[int] = None
    migration: Optional[Any] = None

class SyncPushRequest(BaseModel):
    changes: Dict[str, Dict[str, List[Dict[str, Any]]]] # { "products": { "created": [...], "updated": [...], "deleted": [...] } }
    last_pulled_at: int
