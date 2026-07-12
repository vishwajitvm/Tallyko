from fastapi import APIRouter

router = APIRouter(prefix="/crm", tags=["Crm"])

@router.get("/")
def get_crm():
    return {"message": "crm endpoint scaffolding"}
