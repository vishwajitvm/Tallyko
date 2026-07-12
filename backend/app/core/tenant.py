from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.core.config import settings
from typing import AsyncGenerator
import redis.asyncio as aioredis
import json

# Global/Shared engine
shared_engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
SharedSessionLocal = sessionmaker(
    bind=shared_engine,
    class_=AsyncSession,
    expire_on_commit=False
)

# Registry to hold dynamic engines for dedicated DBs
# Format: { db_url: Engine }
dedicated_engines = {}

async def get_redis_client():
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)

async def get_tenant_db_url(tenant_id: str) -> str | None:
    """
    Looks up the tenant config. First checks Redis cache, then queries Global DB.
    """
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
    
    async with SharedSessionLocal() as session:
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
    """
    FastAPI dependency that yields an active database session.
    Routes to dedicated tenant DB if a db_url is configured, otherwise routes to shared DB.
    """
    if not tenant_id:
        # No tenant context, yield shared DB session (e.g. for registration, public endpoints)
        async with SharedSessionLocal() as session:
            yield session
            return

    db_url = await get_tenant_db_url(tenant_id)
    
    if db_url:
        # Use dedicated engine
        if db_url not in dedicated_engines:
            # Create a new engine for the dedicated DB
            dedicated_engines[db_url] = create_async_engine(db_url, pool_pre_ping=True)
        
        DedicatedSessionLocal = sessionmaker(
            bind=dedicated_engines[db_url],
            class_=AsyncSession,
            expire_on_commit=False
        )
        async with DedicatedSessionLocal() as session:
            yield session
    else:
        # Use default shared engine
        async with SharedSessionLocal() as session:
            # Row-Level Security setup (SET LOCAL app.current_tenant_id)
            # In a real database RLS environment, we set the session variable:
            await session.execute(
                f"SET LOCAL app.current_tenant_id = '{tenant_id}'"
            )
            yield session
            # Note: Postgres SET LOCAL resets automatically upon transaction commit/rollback.
