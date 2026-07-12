from fastapi import FastAPI
from app.core.config import settings

app = FastAPI(
    title="Tallyko POS Backend",
    version="0.1.0",
    description="Multi-tenant POS backend for Tallyko"
)

# Placeholder routers to be registered here

@app.get("/health", tags=["Health"])
async def health_check():
    """
    Health check endpoint to verify service status.
    """
    return {
        "status": "ok",
        "environment": settings.ENVIRONMENT,
        "version": "0.1.0"
    }
