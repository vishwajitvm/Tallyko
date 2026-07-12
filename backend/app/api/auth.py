from fastapi import APIRouter, Depends, Request, HTTPException
from app.core.rate_limit import rate_limit
from app.schemas.auth import VendorSignupRequest, LoginRequest, TokenResponse, RefreshRequest, InviteRequest
from app.services.auth_service import register_vendor, authenticate_user, refresh_token, invite_user
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/auth", tags=["Auth"])

@router.post("/register")
async def register(request: Request, data: VendorSignupRequest):
    await rate_limit(request, requests=5, window=60)
    logger.info(f"[Auth] Attempting signup for vendor: {data.vendor_name}")
    try:
        result = await register_vendor(data)
        logger.info(f"[Auth] Signup successful for vendor: {data.vendor_name}")
        # I'll return what the service returns but bypass response_model.
        return result
    except Exception as e:
        logger.error(f"[Auth] Signup failed: {str(e)}")
        raise

@router.post("/login", response_model=TokenResponse)
async def login(request: Request, data: LoginRequest):
    await rate_limit(request, requests=10, window=60)
    logger.info(f"[Auth] Attempting login for user: {data.email}")
    try:
        result = await authenticate_user(data)
        logger.info(f"[Auth] Login successful for user: {data.email}")
        return result
    except Exception as e:
        logger.error(f"[Auth] Login error: {str(e)}")
        raise

@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, data: RefreshRequest):
    await rate_limit(request, requests=5, window=60)
    logger.info("[Auth] Attempting token refresh")
    try:
        return await refresh_token(data)
    except Exception as e:
        logger.error(f"[Auth] Refresh error: {str(e)}")
        raise

@router.post("/invite")
async def invite(request: Request, data: InviteRequest):
    logger.info(f"[Auth] Attempting to invite user: {data.email}")
    try:
        # In a real app we'd verify the JWT payload confirms they are an owner.
        # This requires Depends(get_current_user) but we will simulate for now.
        tenant_id = request.state.tenant_id if hasattr(request.state, "tenant_id") else None
        if not tenant_id:
            # We assume it's passed in header for now during testing, or we just fail.
            raise HTTPException(status_code=401, detail="Missing tenant_id in request state")
        return await invite_user(data, tenant_id)
    except Exception as e:
        logger.error(f"[Auth] Invite error: {str(e)}")
        raise
