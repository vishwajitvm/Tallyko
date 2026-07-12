from fastapi import APIRouter, Depends, Request, HTTPException
from sqlalchemy.future import select
from app.core.tenant import get_db_session
from app.models.models import GlobalVendor, GlobalUser
from app.schemas.auth import VendorSignupRequest, LoginRequest, TokenResponse
from app.services.auth_service import register_vendor, authenticate_user
from tracenest import trace
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/auth", tags=["Auth"])

@router.post("/signup", response_model=TokenResponse)
@trace(name="auth_vendor_signup")
async def signup(request: Request, data: VendorSignupRequest, db=Depends(get_db_session)):
    logger.info(f"[Auth] Attempting signup for vendor: {data.vendor_name}")
    try:
        token = await register_vendor(db, data)
        logger.info(f"[Auth] Signup successful for vendor: {data.vendor_name}")
        return {"access_token": token, "token_type": "bearer"}
    except Exception as e:
        logger.error(f"[Auth] Signup failed: {str(e)}")
        raise

@router.post("/login", response_model=TokenResponse)
@trace(name="auth_user_login")
async def login(request: Request, data: LoginRequest, db=Depends(get_db_session)):
    logger.info(f"[Auth] Attempting login for user: {data.email}")
    try:
        user = await authenticate_user(db, data.email, data.password)
        if not user:
            logger.warning(f"[Auth] Invalid credentials for user: {data.email}")
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        # Determine tenant_id from user's tenant role or default
        tenant_id = "demo-tenant-uuid" # In real app, derived from user.tenant_roles
        
        from app.services.auth_service import create_access_token
        token = create_access_token({"sub": str(user.id), "tenant_id": tenant_id})
        logger.info(f"[Auth] Login successful for user: {data.email}, tenant: {tenant_id}")
        return {"access_token": token, "token_type": "bearer", "tenant_id": tenant_id}
    except Exception as e:
        logger.error(f"[Auth] Login error: {str(e)}")
        raise
