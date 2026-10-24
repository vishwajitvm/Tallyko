from fastapi import Depends, HTTPException
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool
from app.core.config import settings
from app.core.security import TokenData, get_current_user
from typing import AsyncGenerator
from uuid import UUID
import redis.asyncio as aioredis
import json
import sys
import logging

logger = logging.getLogger("tallyko")

# Global state for lazy initialization
_shared_engine = None
_SharedSessionLocal = None
_dedicated_engines = {}
_DedicatedSessionLocal_map = {}
_redis_client = None

def is_testing():
    return "pytest" in sys.modules

def _engine_kwargs() -> dict:
    return {"poolclass": NullPool} if is_testing() else {"pool_pre_ping": True, "pool_size": 10, "max_overflow": 20}

def get_shared_session_maker():
    global _shared_engine, _SharedSessionLocal
    if _shared_engine is None:
        _shared_engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs())
        _SharedSessionLocal = sessionmaker(
            bind=_shared_engine,
            class_=AsyncSession,
            expire_on_commit=False
        )
    return _SharedSessionLocal

def get_dedicated_session_maker(db_url: str):
    global _dedicated_engines, _DedicatedSessionLocal_map
    if db_url not in _dedicated_engines:
        _dedicated_engines[db_url] = create_async_engine(db_url, **_engine_kwargs())
        _DedicatedSessionLocal_map[db_url] = sessionmaker(
            bind=_dedicated_engines[db_url],
            class_=AsyncSession,
            expire_on_commit=False
        )
    return _DedicatedSessionLocal_map[db_url]

async def get_redis_client():
    global _redis_client
    # Under pytest each test may run on a fresh event loop, so don't share a pooled client there
    if is_testing():
        return aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    if _redis_client is None:
        _redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True, socket_timeout=2, socket_connect_timeout=2)
    return _redis_client

def _config_key(tenant_id) -> str:
    return f"tenant:config:v2:{tenant_id}"

async def drop_tenant_cache(tenant_id) -> None:
    """Call after changing a tenant's status, paid-until or session version."""
    try:
        redis = await get_redis_client()
        await redis.delete(_config_key(tenant_id), f"tenant:config:{tenant_id}")
    except Exception:
        pass

async def get_tenant_config(tenant_id: str) -> dict | None:
    """{"db_url", "status", "paid_until" (ISO, UTC), "session_version"} for a tenant, cached in Redis for 10 minutes."""
    cache_key = _config_key(tenant_id)
    redis = None
    try:
        redis = await get_redis_client()
        cached_config = await redis.get(cache_key)
        if cached_config:
            return json.loads(cached_config)
    except Exception:
        redis = None  # Fall back to the DB if Redis is down

    from app.models import TenantConfig
    from sqlalchemy.future import select

    maker = get_shared_session_maker()
    async with maker() as session:
        result = await session.execute(select(TenantConfig).where(TenantConfig.vendor_id == tenant_id))
        config = result.scalars().first()
        if not config:
            return None
        data = {"db_url": config.db_url, "status": config.status, "session_version": config.session_version or 1,
                "paid_until": config.paid_until.isoformat() if config.paid_until else None}
    if redis is not None:
        try:
            await redis.setex(cache_key, 600, json.dumps(data))
        except Exception:
            pass
    return data

async def get_tenant_db_url(tenant_id: str) -> str | None:
    config = await get_tenant_config(tenant_id)
    return config.get("db_url") if config else None

# Non-superuser role created by the RLS migration. Tenant sessions switch to it so that
# PostgreSQL Row-Level Security applies even when the app connects as a superuser.
TENANT_DB_ROLE = "tallyko_app"

def scope_session_to_tenant(session: AsyncSession, tenant_id: str) -> None:
    # SET LOCAL / set_config(..., true) only last for one transaction, and a session may run
    # several (e.g. commit then refresh), so re-apply the scope every time a transaction begins.
    @event.listens_for(session.sync_session, "after_begin")
    def _apply_tenant_scope(sync_session, transaction, connection):
        connection.execute(text(f"SET LOCAL ROLE {TENANT_DB_ROLE}"))
        connection.execute(
            text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
            {"tenant_id": str(tenant_id)}
        )

async def open_tenant_session(tenant_id: str) -> AsyncGenerator[AsyncSession, None]:
    config = await get_tenant_config(tenant_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Business not found")
    if config.get("status") != "active":
        raise HTTPException(status_code=403, detail="This business account is suspended")
    from app.services.subscription import LAPSED_MESSAGE, is_locked
    if await is_locked(config):
        raise HTTPException(status_code=402, detail=LAPSED_MESSAGE)
    db_url = config.get("db_url")
    maker = get_dedicated_session_maker(db_url) if db_url else get_shared_session_maker()
    async with maker() as session:
        scope_session_to_tenant(session, tenant_id)
        yield session

async def get_tenant_db(current_user: TokenData = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    """DB session for authenticated routes, scoped to the tenant in the caller's JWT."""
    async for session in open_tenant_session(current_user.tenant_id):
        yield session

async def get_public_tenant_db(tenant_id: UUID) -> AsyncGenerator[AsyncSession, None]:
    """DB session for public routes (QR menu, online store) scoped to the `tenant_id` path parameter."""
    async for session in open_tenant_session(str(tenant_id)):
        yield session
