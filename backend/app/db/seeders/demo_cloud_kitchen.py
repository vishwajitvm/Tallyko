import random
import uuid
from datetime import datetime, timedelta
from sqlalchemy.future import select
from app.core.tenant import open_tenant_session
from app.db.seeders import demo_data as data
from app.db.seeders.base import Seeder
from app.db.seeders.helpers import ensure_business, ensure_staff_member
from app.models import Brand, BusinessSettings, Product, ProductCategory, SalesChannel
from app.schemas.billing import OrderCreate, OrderItemIn, PaymentIn
from app.services import order_service
from app.services.channel_menu import available_on

class DemoCloudKitchenSeeder(Seeder):
    name = "demo_cloud_kitchen"
    description = (f"{data.CLOUD_NAME}: Swiggy / Zomato / ONDC with different prices and menus per app, two virtual brands, "
                   "a week of aggregator orders and new orders waiting to be accepted")

    async def run(self) -> str:
        email, owner, phone = data.CLOUD_OWNER
        tenant_id, created = await ensure_business(email, owner, phone, data.CLOUD_NAME, "cloud_kitchen", data.DEMO_PASSWORD)
        for staff_email, name, role, staff_phone in data.CLOUD_STAFF:
            await ensure_staff_member(tenant_id, staff_email, name, role, staff_phone, data.DEMO_PASSWORD)
        if not created:
            return f"{data.CLOUD_NAME} already exists (passwords reset)"

        async for db in open_tenant_session(tenant_id):
            settings = (await db.execute(select(BusinessSettings).where(BusinessSettings.tenant_id == tenant_id))).scalars().first()
            settings.address = "Unit 4, Kitchen Hub, Sector 18, Gurugram 122015"
            settings.gstin = "06ABCDE9012H1ZS"
            settings.fssai = "10821999000456"
            settings.store_enabled = True
            channels = {c.code: c for c in (await db.execute(select(SalesChannel).where(SalesChannel.tenant_id == tenant_id))).scalars().all()}
            for code, (enabled, commission, markup, store_id, auto) in data.CLOUD_CHANNELS.items():
                if code in channels:
                    c = channels[code]
                    c.enabled, c.commission_pct, c.price_adjust_pct, c.external_store_id, c.auto_accept = enabled, commission, markup, store_id, auto

            products = []
            sort = 0
            for brand_name, categories in data.CLOUD_MENU.items():
                brand = None
                if brand_name:
                    brand = Brand(id=uuid.uuid4(), tenant_id=tenant_id, name=brand_name)
                    db.add(brand)
                for category_name, items in categories.items():
                    category = ProductCategory(id=uuid.uuid4(), tenant_id=tenant_id, name=category_name, sort_order=sort)
                    sort += 1
                    db.add(category)
                    for i, (name, price, veg, per_channel) in enumerate(items):
                        product = Product(id=uuid.uuid4(), tenant_id=tenant_id, category_id=category.id, brand_id=brand.id if brand else None,
                                          name=name, base_price=price, is_veg=veg, print_to_kitchen=category_name != "Beverages",
                                          sort_order=i, channel_prices=per_channel or None)
                        db.add(product)
                        products.append(product)
            await db.commit()

            rng = random.Random(str(tenant_id))
            bills = 0
            for day in range(6, -1, -1):
                for _ in range(rng.randint(8, 14)):
                    code = rng.choice(["SWIGGY", "SWIGGY", "ZOMATO", "ZOMATO", "ONDC"])
                    menu = [p for p in products if available_on(p, code)]
                    picks = rng.sample(menu, rng.randint(1, 3))
                    order, _ = await order_service.create_order(db, tenant_id, OrderCreate(
                        channel=code, order_type="DELIVERY", external_order_id=f"{code[:2]}-{rng.randint(10**7, 10**8 - 1)}",
                        items=[OrderItemIn(product_id=p.id, quantity=rng.randint(1, 2)) for p in picks], send_to_kitchen=False,
                        brand_id=picks[0].brand_id, customer_name=rng.choice(["Aditi", "Karan", "Meher", "Zoya", "Rahul", "Ishaan"]),
                        created_at=datetime.utcnow() - timedelta(days=day, hours=rng.randint(0, 10))))
                    await order_service.pay(db, tenant_id, order.id, [PaymentIn(method="AGGREGATOR", amount=float(order.total_amount))], None, None)
                    await db.commit()
                    bills += 1
            # Fresh orders in the Online Orders inbox, waiting to be accepted
            by_name = {p.name: p for p in products}
            for code, picks in (("SWIGGY", ["Chicken Dum Biryani", "Raita"]), ("ZOMATO", ["Biryani Family Pack (serves 4)", "Coke 300ml"])):
                await order_service.create_order(db, tenant_id, OrderCreate(
                    channel=code, order_type="DELIVERY", external_order_id=f"{code[:2]}-NEW-{rng.randint(1000, 9999)}",
                    items=[OrderItemIn(product_id=by_name[n].id, quantity=1) for n in picks], customer_name="Neha (new order)",
                    delivery_address="Tower B, DLF Phase 3, Gurugram"), public=True)
                await db.commit()
        return f"{data.CLOUD_NAME}: {len(products)} items, 2 brands, {bills} aggregator bills, 2 orders waiting to be accepted"
