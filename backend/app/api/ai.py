from fastapi import APIRouter, File, UploadFile
import asyncio

router = APIRouter(prefix="/ai", tags=["AI"])

@router.post("/upload-menu")
async def upload_menu(file: UploadFile = File(...)):
    # Mocking AI processing delay
    await asyncio.sleep(2)
    return {
        "message": "Menu processed successfully",
        "extracted_items": [
            {"name": "Burger", "price": 9.99},
            {"name": "Fries", "price": 3.99}
        ]
    }
