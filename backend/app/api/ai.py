from fastapi import APIRouter

router = APIRouter(prefix="/ai", tags=["Ai"])

@router.get("/")
def get_ai():
    return {"message": "ai endpoint scaffolding"}
