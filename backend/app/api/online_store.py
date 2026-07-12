from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/online-store", tags=["Online Store"])

# Mock state for MVP
store_enabled = True

class StoreSettings(BaseModel):
    enabled: bool

@router.get("/settings")
def get_store_settings():
    return {"enabled": store_enabled, "link": "https://tallyko.com/store/mock-tenant"}

@router.put("/settings")
def update_store_settings(settings: StoreSettings):
    global store_enabled
    store_enabled = settings.enabled
    return {"message": "Settings updated", "enabled": store_enabled}
