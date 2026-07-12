from fastapi import APIRouter, File, UploadFile
import asyncio

router = APIRouter(prefix="/ai", tags=["AI"])

@router.post("/upload-menu")
async def upload_menu(file: UploadFile = File(...)):
    # Mocking AI processing delay to simulate real OCR and NLP extraction
    await asyncio.sleep(2)
    return {
        "message": "Menu processed successfully",
        "extracted_items": [
            {"category": "Appetizers", "name": "Loaded Fries", "price": 5.99, "description": "Crispy fries loaded with cheese and bacon."},
            {"category": "Appetizers", "name": "Mozzarella Sticks", "price": 6.99, "description": "Golden fried mozzarella sticks with marinara."},
            {"category": "Mains", "name": "Classic Burger", "price": 12.99, "description": "Juicy beef patty with lettuce, tomato, and cheese."},
            {"category": "Mains", "name": "Veggie Pizza", "price": 14.99, "description": "Wood-fired pizza with fresh seasonal vegetables."},
            {"category": "Drinks", "name": "Craft Cola", "price": 2.99, "description": "Locally brewed refreshing cola."}
        ]
    }
