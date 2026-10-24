from typing import Literal
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from app.core.config import settings
from app.core.rate_limit import rate_limit, client_ip
import uuid
from fastapi import HTTPException
from sqlalchemy.future import select
from app.core.security import TokenData, decode_token, get_current_user_allow_lapsed, oauth2_scheme
from app.core.tenant import get_shared_session_maker
from app.services import sessions as session_service
from app.schemas.auth import VendorSignupRequest, LoginRequest, TokenResponse, RefreshRequest, ChangePasswordRequest
from app.services import auth_service
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/auth", tags=["Auth"])

@router.post("/register", response_model=TokenResponse)
async def register(request: Request, data: VendorSignupRequest):
    await rate_limit(request, requests=5, window=300)
    logger.info("[Auth] Attempting signup")
    return await auth_service.register_vendor(data, request.headers.get("user-agent"), client_ip(request))

@router.post("/login", response_model=TokenResponse)
async def login(request: Request, data: LoginRequest):
    # A whole shop (many tills, tablets, waiters' phones) shares one public IP: the IP limit is generous;
    # brute force is stopped per account below
    await rate_limit(request, requests=60, window=60)
    # Also limit per account so a botnet can't brute-force one password from many IPs
    per_account = 20 if settings.ENVIRONMENT == "production" else 300
    await rate_limit(request, requests=per_account, window=900, key=f"login-account:{data.email.strip().lower()}")
    try:
        result = await auth_service.authenticate_user(data, request.headers.get("user-agent"), client_ip(request))
        logger.info("[Auth] login_success")
        return result
    except Exception:
        logger.warning(f"[Auth] login_failed from {client_ip(request)}")
        raise

@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, data: RefreshRequest):
    await rate_limit(request, requests=300, window=60)  # every device of a busy shop refreshes through one IP
    return await auth_service.refresh_token(data)

@router.get("/me")
async def me(current_user: TokenData = Depends(get_current_user_allow_lapsed)):
    return await auth_service.me(current_user.user_id)

class DeleteAccountRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    confirm: Literal["DELETE"]

@router.post("/delete-account")
async def delete_account(request: Request, data: DeleteAccountRequest, current_user: TokenData = Depends(get_current_user_allow_lapsed)):
    await rate_limit(request, requests=5, window=300, key=f"delete-account:{current_user.user_id}")
    return await auth_service.delete_account(current_user.user_id, data.password)

@router.post("/change-password")
async def change_password(request: Request, data: ChangePasswordRequest, current_user: TokenData = Depends(get_current_user_allow_lapsed)):
    await rate_limit(request, requests=5, window=300, key=f"change-password:{current_user.user_id}")
    await auth_service.change_password(current_user.user_id, data, keep_session_id=current_user.session_id)
    return {"success": True}

@router.post("/logout")
async def logout(token: str = Depends(oauth2_scheme)):
    """Sign this device out on the server too (its tokens stop working everywhere). Works for business and platform logins,
    and for a business that is locked or was signed out already."""
    try:
        session_id = decode_token(token, "access").get("sid")
    except HTTPException:
        return {"success": True}  # already expired / invalid: nothing to end
    if session_id:
        async with get_shared_session_maker()() as db:
            await session_service.revoke(db, reason="Signed out", session_ids=[session_id])
            await db.commit()
    return {"success": True}

@router.get("/sessions")
async def my_sessions(current_user: TokenData = Depends(get_current_user_allow_lapsed)):
    """Devices where this login is signed in."""
    from app.models import UserSession
    async with get_shared_session_maker()() as db:
        rows = (await db.execute(select(UserSession).where(UserSession.user_id == current_user.user_id, UserSession.revoked_at.is_(None))
                                 .order_by(UserSession.last_seen_at.desc().nullslast()).limit(50))).scalars().all()
    return [{**session_service.serialize_session(r), "current": str(r.id) == str(current_user.session_id)} for r in rows]

@router.delete("/sessions/{session_id}")
async def end_session(session_id: uuid.UUID, current_user: TokenData = Depends(get_current_user_allow_lapsed)):
    async with get_shared_session_maker()() as db:
        n = await session_service.revoke(db, reason="Signed out from another device", session_ids=[session_id], user_id=current_user.user_id)
        await db.commit()
    if not n:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True}
