from app.core.tenant import get_shared_session_maker
from app.db.seeders.base import Seeder

class PlatformDefaultsSeeder(Seeder):
    name = "platform_defaults"
    description = "Default plans (Basic / Standard / Pro) and the GST rate library — safe to run in production"
    allow_in_production = True

    async def run(self) -> str:
        from app.api.platform import _ensure_plans
        from app.services.tax import ensure_platform_presets
        async with get_shared_session_maker()() as db:
            await _ensure_plans(db)
            added = await ensure_platform_presets(db)
            await db.commit()
        return f"plans ready, {added} new GST presets"
