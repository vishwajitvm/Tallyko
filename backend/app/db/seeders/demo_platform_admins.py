from app.core.security import get_password_hash
from app.core.tenant import get_shared_session_maker
from app.db.seeders.base import Seeder
from app.db.seeders import demo_data as data
from app.db.seeders.helpers import find_account
from app.models import GlobalUser

class DemoPlatformAdminsSeeder(Seeder):
    name = "demo_platform_admins"
    description = "Demo super admin and read-only support logins for the platform console"
    depends_on = ("platform_defaults",)

    async def run(self) -> str:
        hashed = get_password_hash(data.DEMO_PASSWORD)
        created = 0
        async with get_shared_session_maker()() as db:
            for email, name, role in data.PLATFORM_ADMINS:
                account = await find_account(db, email)
                if account is None:
                    db.add(GlobalUser(email=email, full_name=name, password_hash=hashed, platform_role=role))
                    created += 1
                else:
                    account.password_hash, account.platform_role, account.is_active = hashed, role, True
            await db.commit()
        return f"{len(data.PLATFORM_ADMINS)} platform logins ready ({created} new)"
