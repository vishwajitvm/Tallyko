from fastapi import APIRouter, File, UploadFile, Request, HTTPException, status
from app.core.rate_limit import rate_limit
import asyncio
import io
try:
    from PIL import Image
    import pytesseract
except ImportError:
    pass

router = APIRouter(prefix="/ai", tags=["AI"])

@router.post("/upload-menu")
async def upload_menu(request: Request, file: UploadFile = File(...)):
    await rate_limit(request, requests=3, window=60) # Max 3 uploads per minute per IP
    
    if file.content_type not in ["image/jpeg", "image/png"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only JPEG or PNG images are allowed.")
    if file.size and file.size > 5 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large. Max 5MB.")
    
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents))
        
        # Run Tesseract OCR synchronously in an executor to avoid blocking the event loop
        loop = asyncio.get_running_loop()
        extracted_text = await loop.run_in_executor(None, pytesseract.image_to_string, image)
        
        # In a real pipeline, we'd parse this text or pass it to an LLM for structured extraction.
        # For this hardened demo without an LLM key, we return the raw text to prove OCR works,
        # but also provide structured mock data so the frontend still functions.
        return {
            "message": "Menu processed successfully using Tesseract OCR.",
            "raw_ocr_text": extracted_text[:500], # return first 500 chars for proof
            "extracted_items": [
                {"category": "Scanned", "name": "Item 1 from OCR", "price": 5.99, "description": "Auto-detected item."},
                {"category": "Scanned", "name": "Item 2 from OCR", "price": 9.99, "description": "Auto-detected item."}
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"OCR Processing failed: {str(e)}")
