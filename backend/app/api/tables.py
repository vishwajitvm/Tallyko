from fastapi import APIRouter

router = APIRouter(prefix="/tables", tags=["Tables"])

@router.get("/")
def get_tables():
    return {"message": "tables endpoint scaffolding"}
