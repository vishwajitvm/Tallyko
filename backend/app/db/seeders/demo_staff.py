from app.db.seeders.base import Seeder
from app.db.seeders import demo_data as data
from app.db.seeders.helpers import attribute_demo_orders, ensure_business, ensure_staff_member

class DemoStaffSeeder(Seeder):
    name = "demo_staff"
    description = f"Two logins for every staff role (manager, cashier, waiter, kitchen) at {data.RESTAURANT_NAME}"
    depends_on = ("demo_restaurant",)

    async def run(self) -> str:
        email, owner, phone = data.RESTAURANT_OWNER
        tenant_id, _ = await ensure_business(email, owner, phone, data.RESTAURANT_NAME, "restaurant", data.DEMO_PASSWORD)
        created = 0
        for staff_email, full_name, role, staff_phone in data.RESTAURANT_STAFF:
            created += await ensure_staff_member(tenant_id, staff_email, full_name, role, staff_phone, data.DEMO_PASSWORD)
        attributed = await attribute_demo_orders(tenant_id)
        return f"{len(data.RESTAURANT_STAFF)} staff logins ready ({created} new), {attributed} demo bills given a waiter/cashier"
