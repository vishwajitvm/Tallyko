from fastapi import Request, HTTPException, status
from app.core.tenant import get_redis_client
import time

async def rate_limit(request: Request, requests: int = 10, window: int = 60):
    """
    Simple Redis-based rate limiter dependency.
    """
    redis = await get_redis_client()
    
    # Use X-Forwarded-For if behind proxy, else client.host
    forwarded = request.headers.get("X-Forwarded-For")
    client_ip = forwarded.split(",")[0] if forwarded else request.client.host
    
    key = f"rate_limit:{request.url.path}:{client_ip}"
    
    current_time = int(time.time())
    
    async with redis.pipeline(transaction=True) as pipe:
        # Clean up old records
        pipe.zremrangebyscore(key, 0, current_time - window)
        # Add new request
        pipe.zadd(key, {str(current_time): current_time})
        # Count requests in window
        pipe.zcard(key)
        # Set expiry on the key to avoid memory leak
        pipe.expire(key, window)
        
        results = await pipe.execute()
        request_count = results[2]
        
        if request_count > requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please try again later."
            )
