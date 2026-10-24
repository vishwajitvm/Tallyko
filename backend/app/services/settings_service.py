import secrets
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models import BusinessSettings, SalesChannel, Location

DEFAULT_CHANNELS = [
    # code, name, enabled, commission %
    ("POS", "Counter / Dine-in", True, 0),
    ("QR", "QR table ordering", False, 0),
    ("ONLINE", "Own online store", False, 0),
    ("SWIGGY", "Swiggy", False, 0),
    ("ZOMATO", "Zomato", False, 0),
    ("ONDC", "ONDC", False, 0),
    ("MAGICPIN", "magicpin", False, 0),
    ("OTHER", "Other / Phone orders", True, 0),
]
CHANNEL_CODES = {c[0] for c in DEFAULT_CHANNELS}
AGGREGATOR_CHANNELS = {"SWIGGY", "ZOMATO", "ONDC", "MAGICPIN", "OTHER"}

async def get_settings(db: AsyncSession, tenant_id: str) -> BusinessSettings:
    result = await db.execute(select(BusinessSettings).where(BusinessSettings.tenant_id == tenant_id))
    settings = result.scalars().first()
    if settings is None:
        # Accounts created before settings existed get defaults on first use
        settings = BusinessSettings(tenant_id=tenant_id, business_name="My Business")
        db.add(settings)
        await db.flush()
    return settings

async def ensure_channels(db: AsyncSession, tenant_id: str) -> list[SalesChannel]:
    result = await db.execute(select(SalesChannel).where(SalesChannel.tenant_id == tenant_id))
    existing = {c.code: c for c in result.scalars().all()}
    for code, name, enabled, commission in DEFAULT_CHANNELS:
        if code not in existing:
            channel = SalesChannel(tenant_id=tenant_id, code=code, name=name, enabled=enabled,
                                   commission_pct=commission, webhook_secret=secrets.token_urlsafe(32))
            db.add(channel)
            existing[code] = channel
    await db.flush()
    return [existing[c[0]] for c in DEFAULT_CHANNELS] + [c for code, c in existing.items() if code not in CHANNEL_CODES]

async def get_channel(db: AsyncSession, tenant_id: str, code: str) -> SalesChannel | None:
    result = await db.execute(select(SalesChannel).where(SalesChannel.tenant_id == tenant_id, SalesChannel.code == code))
    channel = result.scalars().first()
    if channel is None and code in CHANNEL_CODES:
        await ensure_channels(db, tenant_id)
        return await get_channel(db, tenant_id, code)
    return channel

async def ensure_roles(db: AsyncSession, tenant_id: str) -> None:
    """Built-in roles (owner, manager, cashier, waiter, kitchen) as editable rows for a business (idempotent)."""
    from app.core.catalog import SYSTEM_ROLES
    from app.models import Role
    existing = {r.key for r in (await db.execute(select(Role).where(Role.tenant_id == tenant_id))).scalars().all()}
    for key, spec in SYSTEM_ROLES.items():
        if key not in existing:
            db.add(Role(tenant_id=tenant_id, key=key, name=spec["name"], description=spec["description"],
                        permissions=list(spec["permissions"]), is_system=True))
    await db.flush()

async def get_default_location(db: AsyncSession, tenant_id: str) -> Location:
    result = await db.execute(select(Location).where(Location.tenant_id == tenant_id))
    location = result.scalars().first()
    if location is None:
        location = Location(tenant_id=tenant_id, name="Main Branch")
        db.add(location)
        await db.flush()
    return location
