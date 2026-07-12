from fastapi import APIRouter

router = APIRouter(prefix="/inventory", tags=["Inventory"])

@router.get("/")
def get_inventory():
    return {"message": "inventory endpoint scaffolding"}
