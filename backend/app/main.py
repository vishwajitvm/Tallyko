from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
import time
import uuid
import logging
from app.core.config import settings

# Initialize standard library logger, which will be formatted/managed by tracenest
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tallyko")

import os
import json

# Ensure TraceNest log directory exists
os.makedirs("/app/TraceNestLogs", exist_ok=True)

class TraceNestJSONFormatter(logging.Formatter):
    def format(self, record):
        from tracenest.core.formatter import format_log
        
        # Extract custom fields attached via the `extra` dictionary in standard logging
        tenant_id = getattr(record, "tenant_id", "unknown")
        trace_id = getattr(record, "trace_id", "N/A")
        
        return format_log(
            level=record.levelname,
            message=record.getMessage(),
            metadata={"tenant_id": tenant_id},
            trace_id=trace_id,
            exception=record.exc_info[1] if record.exc_info else None
        )

file_handler = logging.FileHandler("/app/TraceNestLogs/app.log")
file_handler.setFormatter(TraceNestJSONFormatter())
logging.getLogger().addHandler(file_handler)

from fastapi.exceptions import RequestValidationError

class TracingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        trace_id = request.headers.get("X-Trace-ID", str(uuid.uuid4()))
        request.state.trace_id = trace_id
        
        tenant_id = request.headers.get("X-Tenant-ID", "unknown")
        start_time = time.time()
        logger.info(
            f"Request started: {request.method} {request.url.path}",
            extra={"trace_id": trace_id, "tenant_id": tenant_id}
        )
        
        try:
            response = await call_next(request)
            process_time = time.time() - start_time
            logger.info(
                f"Request completed: {request.method} {request.url.path} - Status: {response.status_code} - Duration: {process_time:.4f}s",
                extra={"trace_id": trace_id, "tenant_id": tenant_id, "duration": process_time}
            )
            response.headers["X-Trace-ID"] = trace_id
            return response
        except Exception as exc:
            process_time = time.time() - start_time
            logger.error(
                f"Unhandled Exception: {request.method} {request.url.path} - Error: {str(exc)}",
                exc_info=True,
                extra={"trace_id": trace_id, "tenant_id": tenant_id, "duration": process_time}
            )
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"success": False, "error": {"code": "INTERNAL_SERVER_ERROR", "message": "An unexpected error occurred."}}
            )

from app.api import auth, catalog, billing, analytics, kitchen, inventory, tables, online_store, crm, ai, sync, qr_menu
from fastapi.middleware.cors import CORSMiddleware
from fastapi import HTTPException

app = FastAPI(
    title="Tallyko POS Backend",
    version="1.0.0",
    description="Multi-tenant POS backend for Tallyko"
)

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": {"code": "HTTP_ERROR", "message": exc.detail}}
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"success": False, "error": {"code": "VALIDATION_ERROR", "message": exc.errors()}}
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for MVP; tighten this for prod!
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

app.add_middleware(TracingMiddleware)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(catalog.router, prefix="/api/v1")
app.include_router(billing.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(kitchen.router, prefix="/api/v1")
app.include_router(inventory.router, prefix="/api/v1")
app.include_router(tables.router, prefix="/api/v1")
app.include_router(online_store.router, prefix="/api/v1")
app.include_router(crm.router, prefix="/api/v1")
app.include_router(ai.router, prefix="/api/v1")
app.include_router(sync.router, prefix="/api/v1")
app.include_router(qr_menu.router, prefix="/api/v1")

try:
    from tracenest.ui.router import router as tracenest_ui_router
    app.include_router(tracenest_ui_router)
except ImportError as e:
    logger.warning(f"Could not load tracenest UI router: {e}")

# Health endpoint
@app.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "ok",
        "environment": settings.ENVIRONMENT,
        "version": "0.1.0"
    }
