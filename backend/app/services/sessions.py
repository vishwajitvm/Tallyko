"""Signed-in devices. Every login creates a session; tokens carry its id (`sid`) and the business's session version (`sv`).

- Sign out one device: the session is marked revoked and its id is put in Redis, so the access token stops working on the
  next request (the refresh token is refused from the database).
- Sign out a whole business (super admin, or the daily subscription check): every session is revoked and the business's
  session version is bumped, which invalidates all its tokens even if Redis is unavailable.
Offline bills are never on the server's side of this: they stay in the device's outbox and sync after the next sign-in.
"""
import logging
import re
from datetime import datetime, timedelta
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.config import settings
from app.core.tenant import drop_tenant_cache, get_redis_client

logger = logging.getLogger("tallyko")

def _revoked_key(session_id) -> str:
    return f"session:revoked:{session_id}"

def describe_device(user_agent: str | None) -> str:
    ua = user_agent or ""
    if not ua:
        return "Unknown device"
    app = "Tallyko app" if ("okhttp" in ua.lower() or "expo" in ua.lower() or "tallyko" in ua.lower()) else None
    os_name = next((name for pattern, name in ((r"Android", "Android"), (r"iPhone|iPad|iOS", "iPhone/iPad"), (r"Windows", "Windows"),
                                               (r"Mac OS X|Macintosh", "Mac"), (r"Linux", "Linux")) if re.search(pattern, ua)), "")
    browser = next((name for pattern, name in ((r"Edg/", "Edge"), (r"OPR/|Opera", "Opera"), (r"Chrome/", "Chrome"),
                                               (r"Firefox/", "Firefox"), (r"Safari/", "Safari")) if re.search(pattern, ua)), "")
    label = app or browser or "Browser"
    return f"{label} on {os_name}" if os_name else label

async def start_session(db: AsyncSession, user_id, tenant_id=None, staff_id=None, kind: str = "business",
                        user_agent: str | None = None, ip: str | None = None):
    from app.models import UserSession
    now = datetime.utcnow()
    row = UserSession(user_id=user_id, tenant_id=tenant_id, staff_id=staff_id, kind=kind, device=describe_device(user_agent)[:120],
                      ip=(ip or "")[:64] or None, created_at=now, last_seen_at=now)
    db.add(row)
    await db.flush()
    return row

async def is_revoked_fast(session_id) -> bool:
    """Redis check on every request; fails open (the session version still covers whole-business sign-outs)."""
    if not session_id:
        return False
    try:
        return bool(await (await get_redis_client()).exists(_revoked_key(session_id)))
    except Exception:
        return False

async def _mark_revoked_in_cache(session_ids) -> None:
    ttl = int(timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES).total_seconds()) + 60
    try:
        redis = await get_redis_client()
        for sid in session_ids:
            await redis.setex(_revoked_key(sid), ttl, "1")
    except Exception as exc:
        logger.warning(f"[Auth] could not cache revoked sessions: {exc}")

async def revoke(db: AsyncSession, *, reason: str, session_ids=None, tenant_id=None, user_id=None, staff_id=None,
                 keep_session_id=None) -> int:
    """Revoke matching active sessions. Returns how many were signed out."""
    from app.models import UserSession
    query = select(UserSession.id).where(UserSession.revoked_at.is_(None))
    if session_ids is not None:
        query = query.where(UserSession.id.in_(list(session_ids) or [None]))
    if tenant_id is not None:
        query = query.where(UserSession.tenant_id == tenant_id)
    if user_id is not None:
        query = query.where(UserSession.user_id == user_id)
    if staff_id is not None:
        query = query.where(UserSession.staff_id == staff_id)
    if keep_session_id is not None:
        query = query.where(UserSession.id != keep_session_id)
    ids = [sid for (sid,) in (await db.execute(query)).all()]
    if not ids:
        return 0
    await db.execute(update(UserSession).where(UserSession.id.in_(ids)).values(revoked_at=datetime.utcnow(), revoked_reason=reason[:120]))
    await _mark_revoked_in_cache(ids)
    return len(ids)

async def sign_out_business(db: AsyncSession, tenant_id, reason: str) -> int:
    """Every device of a business, including tokens from before session tracking (via the session version)."""
    from app.models import TenantConfig
    count = await revoke(db, reason=reason, tenant_id=tenant_id)
    config = await db.get(TenantConfig, tenant_id)
    if config is not None:
        config.session_version = (config.session_version or 1) + 1
    await db.flush()
    await drop_tenant_cache(tenant_id)
    return count

async def check_refreshable(db: AsyncSession, session_id) -> None:
    """Refresh tokens of revoked sessions are refused; the session's last-seen time is updated."""
    from fastapi import HTTPException
    from app.models import UserSession
    if not session_id:
        return  # tokens from before session tracking: covered by the session version
    row = await db.get(UserSession, session_id)
    if row is None or row.revoked_at is not None:
        raise HTTPException(status_code=401, detail="You were signed out on this device. Please sign in again.")
    row.last_seen_at = datetime.utcnow()

def serialize_session(row, names: dict | None = None) -> dict:
    return {"id": str(row.id), "user_id": str(row.user_id), "staff_id": str(row.staff_id) if row.staff_id else None,
            "name": (names or {}).get(row.user_id), "device": row.device, "ip": row.ip, "kind": row.kind,
            "created_at": row.created_at.isoformat() + "Z",
            "last_seen_at": row.last_seen_at.isoformat() + "Z" if row.last_seen_at else None,
            "revoked_at": row.revoked_at.isoformat() + "Z" if row.revoked_at else None, "revoked_reason": row.revoked_reason}
