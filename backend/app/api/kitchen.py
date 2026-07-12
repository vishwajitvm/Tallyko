from fastapi import APIRouter

router = APIRouter(prefix="/kitchen", tags=["Kitchen"])

@router.get("/")
def get_kitchen():
    return {"message": "kitchen endpoint scaffolding"}
