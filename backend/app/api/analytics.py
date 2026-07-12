from fastapi import APIRouter

router = APIRouter(prefix="/analytics", tags=["Analytics"])

@router.get("/")
def get_analytics():
    return {"message": "analytics endpoint scaffolding"}
