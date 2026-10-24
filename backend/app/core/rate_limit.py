from fastapi import Request, HTTPException, status
from app.core.config import settings
from app.core.tenant import get_redis_client
import logging
import time
import uuid

logger = logging.getLogger("tallyko")

def client_ip(request: Request) -> str:
    # X-Forwarded-For is client-controlled unless our own proxy sets it
    if settings.TRUST_PROXY:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

async def rate_limit(request: Request, requests: int = 10, window: int = 60, key: str | None = None):
    """
    Redis sliding-window rate limiter. Fails open if Redis is unavailable so billing never stops.
    """
    bucket = key or f"{request.url.path}:{client_ip(request)}"
    redis_key = f"rate_limit:{bucket}"
    now = time.time()

    try:
        redis = await get_redis_client()
        async with redis.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(redis_key, 0, now - window)
            pipe.zadd(redis_key, {uuid.uuid4().hex: now})
            pipe.zcard(redis_key)
            pipe.expire(redis_key, window)
            results = await pipe.execute()
    except Exception as exc:
        logger.warning(f"[RateLimit] Redis unavailable, allowing request: {exc}")
        return

    if results[2] > requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again in a minute."
        )
