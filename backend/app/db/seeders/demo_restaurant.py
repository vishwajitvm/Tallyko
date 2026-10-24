import uuid
from sqlalchemy.future import select
from app.core.tenant import open_tenant_session
from app.models import BusinessSettings, Product, ProductCategory, ProductVariant, TableEntity
from app.services.settings_service import get_default_location
from app.db.seeders.base import Seeder
from app.db.seeders import demo_data as data
from app.db.seeders.helpers import ensure_business, generate_sales_history

class DemoRestaurantSeeder(Seeder):
    name = "demo_restaurant"
    description = f"{data.RESTAURANT_NAME}: owner login, full menu with Half/Full items, 12 tables, a week of sales"

    async def run(self) -> str:
        email, owner, phone = data.RESTAURANT_OWNER
        tenant_id, created = await ensure_business(email, owner, phone, data.RESTAURANT_NAME, "restaurant", data.DEMO_PASSWORD)
        if not created:
            return f"{data.RESTAURANT_NAME} already exists (owner password reset)"

        async for db in open_tenant_session(tenant_id):
            settings = (await db.execute(select(BusinessSettings).where(BusinessSettings.tenant_id == tenant_id))).scalars().first()
            settings.address = "NH-44, Murthal, Sonipat, Haryana 131027"
            settings.gstin = "06ABCDE1234F1Z4"
            settings.fssai = "10821999000123"
            settings.upi_id = "sharmadhaba@upi"
            settings.receipt_footer = "Thank you! Visit again."
            settings.qr_ordering_enabled = True
            settings.qr_payment_mode = "both"  # table QR: pay by UPI or at the counter
            settings.store_enabled = True

            products = []
            for sort, (category_name, items) in enumerate(data.RESTAURANT_MENU.items()):
                category = ProductCategory(id=uuid.uuid4(), tenant_id=tenant_id, name=category_name, sort_order=sort)
                db.add(category)
                for i, (name, price, veg, variants) in enumerate(items):
                    base = min(v[1] for v in variants) if variants else price
                    product = Product(id=uuid.uuid4(), tenant_id=tenant_id, category_id=category.id, name=name, base_price=base,
                                      is_veg=veg, print_to_kitchen=category_name != "Beverages", sort_order=i)
                    db.add(product)
                    for j, (variant_name, variant_price) in enumerate(variants or []):
                        db.add(ProductVariant(product_id=product.id, variant_name=variant_name, price_modifier=variant_price - base, sort_order=j))
                    products.append(product)

            location = await get_default_location(db, tenant_id)
            for section, numbers in data.RESTAURANT_SECTIONS:
                for number in numbers:
                    db.add(TableEntity(tenant_id=tenant_id, location_id=location.id, table_number=str(number), section=section, capacity=4))
            await db.commit()

            bills = await generate_sales_history(db, tenant_id, products, ["DINE_IN", "TAKEAWAY", "TAKEAWAY", "DELIVERY"],
                                                 ["POS", "POS", "POS", "OTHER"], data.DEMO_CUSTOMERS)
        return f"{data.RESTAURANT_NAME}: {len(products)} menu items, 12 tables, {bills} bills"
