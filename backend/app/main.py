import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.config import settings

# Standard library logger, formatted as structured JSON by tracenest
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tallyko")

LOG_DIR = os.getenv("LOG_DIR", "/app/TraceNestLogs")

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

try:
    os.makedirs(LOG_DIR, exist_ok=True)
    file_handler = logging.FileHandler(os.path.join(LOG_DIR, "app.log"))
    file_handler.setFormatter(TraceNestJSONFormatter())
    logging.getLogger().addHandler(file_handler)
except OSError as exc:  # read-only filesystem etc. — stdout logging still works
    logger.warning(f"File logging disabled: {exc}")

class TracingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        trace_id = request.headers.get("X-Trace-ID") or str(uuid.uuid4())
        trace_id = trace_id[:64]
        request.state.trace_id = trace_id
        start_time = time.time()
        try:
            response = await call_next(request)
        except Exception as exc:
            process_time = time.time() - start_time
            logger.error(
                f"Unhandled Exception: {request.method} {request.url.path} - Error: {str(exc)}",
                exc_info=True,
                extra={"trace_id": trace_id, "duration": process_time}
            )
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content={"success": False, "error": {"code": "INTERNAL_SERVER_ERROR", "message": "Something went wrong. Please try again.", "trace_id": trace_id}},
                headers={"X-Trace-ID": trace_id},
            )
        process_time = time.time() - start_time
        if request.url.path != "/health":
            logger.info(
                f"{request.method} {request.url.path} -> {response.status_code} ({process_time:.3f}s)",
                extra={"trace_id": trace_id, "duration": process_time}
            )
        response.headers["X-Trace-ID"] = trace_id
        # Basic hardening; the reverse proxy adds HSTS when serving HTTPS
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        return response

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate_for_production()
    logger.info(f"Tallyko API {settings.APP_VERSION} starting ({settings.ENVIRONMENT})")
    import asyncio
    from app.services.email.service import run_worker
    from app.services.subscription import run_scheduler
    stop, tasks = asyncio.Event(), []
    if settings.EMAIL_WORKER_ENABLED:
        tasks.append(asyncio.create_task(run_worker(stop)))
    if settings.JOB_SCHEDULER_ENABLED:
        tasks.append(asyncio.create_task(run_scheduler(stop)))
    yield
    stop.set()
    if tasks:
        await asyncio.wait(tasks, timeout=10)

from app.api import auth, catalog, orders, reports, kitchen, inventory, tables, crm, ai, sync, admin, public, integrations, access, platform, offers, email, taxes, subscription, owner

app = FastAPI(
    title="Tallyko POS API",
    version=settings.APP_VERSION,
    description="Multi-tenant POS backend for Tallyko",
    lifespan=lifespan,
    docs_url=None if settings.ENVIRONMENT == "production" else "/docs",
    redoc_url=None,
)

def _error(status_code: int, code: str, message, request: Request) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"success": False, "error": {"code": code, "message": message, "trace_id": getattr(request.state, "trace_id", None)}},
    )

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    response = _error(exc.status_code, "HTTP_ERROR", exc.detail, request)
    if getattr(exc, "headers", None):
        response.headers.update(exc.headers)
    return response

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = jsonable_encoder(exc.errors())
    # A readable first message for the app, full detail for developers
    first = errors[0] if errors else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "request"
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"success": False, "error": {"code": "VALIDATION_ERROR", "message": f"{field}: {first.get('msg', 'Invalid input')}", "details": errors}},
    )

app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials="*" not in settings.cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Trace-ID", "X-Tallyko-Signature"],
    expose_headers=["X-Trace-ID", "X-Total-Count", "X-Counts"],
)
app.add_middleware(TracingMiddleware)

for module in (auth, catalog, orders, reports, kitchen, inventory, tables, crm, ai, sync, admin, public, integrations, access, platform, offers, email, taxes, subscription, owner):
    app.include_router(module.router, prefix="/api/v1")

if settings.ENVIRONMENT != "production":
    try:
        from tracenest.ui.router import router as tracenest_ui_router
        app.include_router(tracenest_ui_router)
    except ImportError as e:
        logger.warning(f"Could not load tracenest UI router: {e}")

@app.get("/health", tags=["Health"])
async def health_check():
    """Liveness + dependency check used by Docker healthchecks and the app's server picker."""
    from app.core.tenant import get_shared_session_maker, get_redis_client
    checks = {}
    try:
        async with get_shared_session_maker()() as session:
            await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        logger.error(f"Health check: database unavailable: {exc}")
        checks["database"] = "error"
    try:
        redis = await get_redis_client()
        await redis.ping()
        checks["cache"] = "ok"
    except Exception:
        checks["cache"] = "degraded"  # rate limiting fails open; billing keeps working
    healthy = checks["database"] == "ok"
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"status": "ok" if healthy else "error", "service": "tallyko", "environment": settings.ENVIRONMENT,
                 "version": settings.APP_VERSION, "checks": checks},
    )
