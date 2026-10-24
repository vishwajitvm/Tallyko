from datetime import datetime
from zoneinfo import ZoneInfo
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings

async def next_value(db: AsyncSession, tenant_id: str, name: str) -> int:
    """Atomically increment and return a per-tenant counter (safe under concurrent requests)."""
    result = await db.execute(
        text("""
            INSERT INTO tenant_counters (tenant_id, name, value) VALUES (:tenant_id, :name, 1)
            ON CONFLICT (tenant_id, name) DO UPDATE SET value = tenant_counters.value + 1
            RETURNING value
        """),
        {"tenant_id": str(tenant_id), "name": name},
    )
    return int(result.scalar_one())

def local_now() -> datetime:
    return datetime.now(ZoneInfo(settings.TIMEZONE))

def financial_year(now: datetime | None = None) -> str:
    """Indian financial year label, e.g. '26-27' for Apr 2026 – Mar 2027 (GST invoice series reset)."""
    now = now or local_now()
    start = now.year if now.month >= 4 else now.year - 1
    return f"{start % 100:02d}-{(start + 1) % 100:02d}"

async def next_invoice_no(db: AsyncSession, tenant_id: str, prefix: str) -> str:
    fy = financial_year()
    seq = await next_value(db, tenant_id, f"invoice:{fy}")
    return f"{prefix}/{fy}/{seq:05d}"

async def next_token_no(db: AsyncSession, tenant_id: str) -> int:
    return await next_value(db, tenant_id, f"token:{local_now().date().isoformat()}")

async def next_kot_no(db: AsyncSession, tenant_id: str) -> int:
    return await next_value(db, tenant_id, f"kot:{local_now().date().isoformat()}")
