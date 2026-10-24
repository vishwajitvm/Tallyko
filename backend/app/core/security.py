from datetime import datetime, timedelta, timezone
from typing import List
import uuid
import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from app.core.config import settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/v1/auth/login")

ROLES = ("owner", "manager", "cashier", "waiter", "kitchen")
MANAGERS = ["owner", "manager"]
BILLING_ROLES = ["owner", "manager", "cashier"]
FLOOR_ROLES = ["owner", "manager", "cashier", "waiter"]
KITCHEN_ROLES = ["owner", "manager", "cashier", "waiter", "kitchen"]

class TokenData(BaseModel):
    user_id: str
    tenant_id: str
    role: str
    staff_id: str | None = None  # this login's membership row (users.id) in the business
    session_id: str | None = None  # the signed-in device (user_sessions.id)

class PlatformUser(BaseModel):
    user_id: str
    email: str | None = None
    platform_role: str  # super_admin | support

def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8")[:72], hashed_password.encode("utf-8"))
    except ValueError:
        return False

def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")

# bcrypt takes ~0.25 s of CPU on purpose. In request handlers run it in a worker thread so one login (or a whole shop
# signing in at shift change) never freezes billing for everyone else on the same API process.
async def verify_password_async(plain_password: str, hashed_password: str) -> bool:
    import asyncio
    return await asyncio.to_thread(verify_password, plain_password, hashed_password)

async def hash_password_async(password: str) -> str:
    import asyncio
    return await asyncio.to_thread(get_password_hash, password)

def _encode(payload: dict, lifetime: timedelta, token_type: str) -> str:
    now = datetime.now(timezone.utc)
    to_encode = {**payload, "iat": now, "exp": now + lifetime, "type": token_type, "jti": uuid.uuid4().hex}
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    return _encode(data, expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES), "access")

def create_refresh_token(data: dict) -> str:
    return _encode(data, timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS), "refresh")

def decode_token(token: str, expected_type: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.", headers={"WWW-Authenticate": "Bearer"})
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Could not validate credentials", headers={"WWW-Authenticate": "Bearer"})
    if payload.get("type") != expected_type:
        raise HTTPException(status_code=401, detail="Could not validate credentials", headers={"WWW-Authenticate": "Bearer"})
    return payload

SIGNED_OUT = "You were signed out of this device. Please sign in again."

async def _business_user(token: str, allow_lapsed: bool) -> TokenData:
    payload = decode_token(token, "access")
    user_id, tenant_id, role = payload.get("sub"), payload.get("tenant_id"), payload.get("role")
    if not user_id or not tenant_id or not role:
        if payload.get("platform_role"):
            raise HTTPException(status_code=403, detail="Platform admin accounts can't use business screens")
        raise HTTPException(status_code=401, detail="Could not validate credentials", headers={"WWW-Authenticate": "Bearer"})
    from app.core.tenant import get_tenant_config
    from app.services.sessions import is_revoked_fast
    from app.services.subscription import LAPSED_MESSAGE, is_locked
    config = await get_tenant_config(tenant_id)
    if config is None:
        raise HTTPException(status_code=401, detail="Business not found", headers={"WWW-Authenticate": "Bearer"})
    if int(payload.get("sv", 1)) != int(config.get("session_version", 1)) or await is_revoked_fast(payload.get("sid")):
        raise HTTPException(status_code=401, detail=SIGNED_OUT, headers={"WWW-Authenticate": "Bearer"})
    if not allow_lapsed and await is_locked(config):
        raise HTTPException(status_code=402, detail=LAPSED_MESSAGE)
    return TokenData(user_id=user_id, tenant_id=tenant_id, role=role, staff_id=payload.get("staff_id"), session_id=payload.get("sid"))

async def get_current_user(token: str = Depends(oauth2_scheme)) -> TokenData:
    """A signed-in business user whose business has an active subscription (402 otherwise)."""
    return await _business_user(token, allow_lapsed=False)

async def get_current_user_allow_lapsed(token: str = Depends(oauth2_scheme)) -> TokenData:
    """Same, but also when the subscription has ended: renewal screen, profile, account deletion."""
    return await _business_user(token, allow_lapsed=True)

async def get_platform_user(token: str = Depends(oauth2_scheme)) -> PlatformUser:
    """Tallyko staff (super admin / support) — never a business login.
    The account is re-checked on every request (platform traffic is tiny), so removing or demoting an admin
    takes effect immediately instead of when their token expires."""
    payload = decode_token(token, "access")
    if not payload.get("sub") or payload.get("platform_role") not in ("super_admin", "support"):
        raise HTTPException(status_code=403, detail="Platform admin access required")
    from app.services.sessions import is_revoked_fast
    if await is_revoked_fast(payload.get("sid")):
        raise HTTPException(status_code=401, detail=SIGNED_OUT, headers={"WWW-Authenticate": "Bearer"})
    from sqlalchemy import select
    from app.core.tenant import get_shared_session_maker
    from app.models import GlobalUser
    async with get_shared_session_maker()() as db:
        row = (await db.execute(select(GlobalUser.platform_role, GlobalUser.is_active).where(GlobalUser.id == payload["sub"]))).first()
    if row is None or not row.is_active or row.platform_role not in ("super_admin", "support"):
        raise HTTPException(status_code=401, detail="Your platform access was removed. Sign in again.")
    return PlatformUser(user_id=payload["sub"], email=payload.get("email"), platform_role=row.platform_role)

def require_super_admin(user: PlatformUser = Depends(get_platform_user)) -> PlatformUser:
    if user.platform_role != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admins can do this")
    return user

class RoleChecker:
    def __init__(self, allowed_roles: List[str]):
        self.allowed_roles = allowed_roles

    def __call__(self, current_user: TokenData = Depends(get_current_user)) -> TokenData:
        if current_user.role not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operation not permitted for this role"
            )
        return current_user
