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

# Initialize tracenest (wires standard logger to JSON/structured format)
try:
    from tracenest import tracenest_init
    tracenest_init()
except ImportError:
    pass

class TracingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        trace_id = request.headers.get("X-Trace-ID", str(uuid.uuid4()))
        request.state.trace_id = trace_id
        
        # In a real app, extract tenant/user from JWT header if exists
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
                f"Request failed: {request.method} {request.url.path} - Error: {str(exc)}",
                exc_info=True,
                extra={"trace_id": trace_id, "tenant_id": tenant_id, "duration": process_time}
            )
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"success": False, "error": {"code": "INTERNAL_SERVER_ERROR", "message": "An unexpected error occurred."}}
            )

app = FastAPI(
    title="Tallyko POS Backend",
    version="0.1.0",
    description="Multi-tenant POS backend for Tallyko"
)

app.add_middleware(TracingMiddleware)

# Health endpoint
@app.get("/health", tags=["Health"])
async def health_check():
    return {
        "status": "ok",
        "environment": settings.ENVIRONMENT,
        "version": "0.1.0"
    }
