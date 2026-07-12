from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool
from app.core.config import settings
from typing import AsyncGenerator
import redis.asyncio as aioredis
import json
import sys

# Global state for lazy initialization
_shared_engine = None
_SharedSessionLocal = None
_dedicated_engines = {}
_DedicatedSessionLocal_map = {}

def is_testing():
    return "pytest" in sys.modules

def get_shared_session_maker():
    global _shared_engine, _SharedSessionLocal
    if _shared_engine is None:
        pool_kwargs = {"poolclass": NullPool} if is_testing() else {"pool_pre_ping": True}
        _shared_engine = create_async_engine(settings.DATABASE_URL, **pool_kwargs)
        _SharedSessionLocal = sessionmaker(
            bind=_shared_engine,
            class_=AsyncSession,
            expire_on_commit=False
        )
    return _SharedSessionLocal

def get_dedicated_session_maker(db_url: str):
    global _dedicated_engines, _DedicatedSessionLocal_map
    if db_url not in _dedicated_engines:
        pool_kwargs = {"poolclass": NullPool} if is_testing() else {"pool_pre_ping": True}
        _dedicated_engines[db_url] = create_async_engine(db_url, **pool_kwargs)
        _DedicatedSessionLocal_map[db_url] = sessionmaker(
            bind=_dedicated_engines[db_url],
            class_=AsyncSession,
            expire_on_commit=False
        )
    return _DedicatedSessionLocal_map[db_url]

async def get_redis_client():
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)

async def get_tenant_db_url(tenant_id: str) -> str | None:
    # 1. Try Redis cache
    redis = await get_redis_client()
    cache_key = f"tenant:config:{tenant_id}"
    try:
        cached_config = await redis.get(cache_key)
        if cached_config:
            config = json.loads(cached_config)
            return config.get("db_url")
    except Exception:
        pass  # Fallback to DB if Redis fails

    # 2. Query Global DB
    from app.models.models import TenantConfig
    from sqlalchemy.future import select
    
    maker = get_shared_session_maker()
    async with maker() as session:
        result = await session.execute(
            select(TenantConfig).where(TenantConfig.vendor_id == tenant_id)
        )
        config = result.scalars().first()
        if config:
            # Cache config in Redis for 10 minutes
            try:
                await redis.setex(
                    cache_key,
                    600,
                    json.dumps({"db_url": config.db_url, "status": config.status})
                )
            except Exception:
                pass
            return config.db_url

    return None

async def get_db_session(tenant_id: str | None = None) -> AsyncGenerator[AsyncSession, None]:
    if not tenant_id:
        maker = get_shared_session_maker()
        async with maker() as session:
            yield session
            return

    db_url = await get_tenant_db_url(tenant_id)
    
    if db_url:
        maker = get_dedicated_session_maker(db_url)
        async with maker() as session:
            yield session
    else:
        maker = get_shared_session_maker()
        async with maker() as session:
            await session.execute(
                f"SET LOCAL app.current_tenant_id = '{tenant_id}'"
            )
            yield session
