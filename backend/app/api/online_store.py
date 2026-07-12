from fastapi import APIRouter

router = APIRouter(prefix="/online_store", tags=["Online_store"])

@router.get("/")
def get_online_store():
    return {"message": "online_store endpoint scaffolding"}
