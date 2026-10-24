"""AI menu upload: photograph a printed/board menu and get editable items back.

OCR runs locally (RapidOCR on onnxruntime, CPU) - no paid or external APIs. See app/services/menu_ocr.py.
"""
import logging
import time
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.concurrency import run_in_threadpool

from app.core.rate_limit import rate_limit
from app.core.security import TokenData, get_current_user
from app.services import menu_ocr

logger = logging.getLogger("tallyko")

router = APIRouter(prefix="/ai", tags=["AI"])

MAX_FILES = 5
MAX_FILE_BYTES = 10 * 1024 * 1024
READ_CHUNK = 1024 * 1024
RATE_LIMIT_REQUESTS = 5  # per IP per minute; each request can carry several photos
RATE_LIMIT_WINDOW = 60


def _display_name(file: UploadFile, index: int) -> str:
    name = (file.filename or "").strip()
    return name[:80] if name else f"file {index}"


async def _read_bounded(file: UploadFile, label: str) -> bytes:
    """Read an upload in chunks, refusing anything over MAX_FILE_BYTES without buffering all of it."""
    buf = bytearray()
    while True:
        chunk = await file.read(READ_CHUNK)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > MAX_FILE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"'{label}' is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB.",
            )
    return bytes(buf)


async def _extract(request: Request, files: List[UploadFile], current_user: TokenData) -> dict:
    trace_id = getattr(request.state, "trace_id", "N/A")
    log_extra = {"trace_id": trace_id, "tenant_id": current_user.tenant_id}

    if not files or len(files) > MAX_FILES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Upload between 1 and {MAX_FILES} menu images per request.",
        )

    # Validate every file before spending CPU on OCR.
    images = []
    for index, file in enumerate(files, start=1):
        label = _display_name(file, index)
        data = await _read_bounded(file, label)
        try:
            images.append(await run_in_threadpool(menu_ocr.load_image, data))
        except menu_ocr.MenuImageError as exc:
            logger.info(f"[AI] Rejected menu upload '{label}': {exc}", extra=log_extra)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"'{label}': {exc}")

    started = time.monotonic()
    results = []
    for index, image in enumerate(images, start=1):
        try:
            results.append(await run_in_threadpool(menu_ocr.extract_menu_from_image, image))
        except Exception:
            logger.exception(f"[AI] OCR failed on image {index}", extra=log_extra)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Could not read the menu image. Please try again with a clearer photo.",
            )

    merged = menu_ocr.merge_results(results)
    logger.info(
        f"[AI] Menu extracted: {len(images)} image(s), {len(merged['items'])} item(s), "
        f"{len(merged['categories'])} category(ies) in {time.monotonic() - started:.2f}s",
        extra=log_extra,
    )
    return merged


@router.post("/menu/extract")
async def extract_menu(
    request: Request,
    files: List[UploadFile] = File(..., description="1-5 menu photos (JPEG, PNG, WEBP or HEIC, max 10 MB each)"),
    current_user: TokenData = Depends(get_current_user),
):
    """Extract menu items (name, price, category, Half/Full-style variants) from menu photos.

    Response: ``{"items": [{"name", "price", "category", "variants": [{"name", "price"}], "confidence"}],
    "categories": [...], "lines": [...raw OCR lines], "warnings": [...]}``. ``price`` is null when no
    price was read; for multi-price items it is the highest variant price.
    """
    await rate_limit(request, requests=RATE_LIMIT_REQUESTS, window=RATE_LIMIT_WINDOW)
    return await _extract(request, files, current_user)


@router.post("/upload-menu")
async def upload_menu(
    request: Request,
    file: UploadFile = File(...),
    current_user: TokenData = Depends(get_current_user),
):
    """Single-image alias of ``POST /ai/menu/extract`` (kept for older app builds).

    Returns the same shape plus the legacy ``message`` / ``raw_ocr_text`` / ``extracted_items`` keys.
    """
    await rate_limit(request, requests=RATE_LIMIT_REQUESTS, window=RATE_LIMIT_WINDOW)
    result = await _extract(request, [file], current_user)
    result["message"] = "Menu processed successfully."
    result["raw_ocr_text"] = "\n".join(result["lines"])[:500]
    result["extracted_items"] = [
        {"category": item["category"] or "Scanned", "name": item["name"], "price": item["price"], "description": ""}
        for item in result["items"]
    ]
    return result
