import uuid
from sqlalchemy.future import select
from app.core.tenant import open_tenant_session
from app.models import BusinessSettings, InventoryLog, Product, ProductCategory, TaxClass
from app.services.settings_service import get_default_location
from app.db.seeders.base import Seeder
from app.db.seeders import demo_data as data
from app.db.seeders.helpers import ensure_business, generate_sales_history

class DemoRetailSeeder(Seeder):
    name = "demo_retail"
    description = f"{data.RETAIL_NAME}: owner login, barcoded products with stock (MRP incl. GST), a week of sales"

    async def run(self) -> str:
        email, owner, phone = data.RETAIL_OWNER
        tenant_id, created = await ensure_business(email, owner, phone, data.RETAIL_NAME, "retail", data.DEMO_PASSWORD)
        if not created:
            return f"{data.RETAIL_NAME} already exists (owner password reset)"

        async for db in open_tenant_session(tenant_id):
            settings = (await db.execute(select(BusinessSettings).where(BusinessSettings.tenant_id == tenant_id))).scalars().first()
            settings.address = "Shop 12, Main Bazaar, Karol Bagh, New Delhi 110005"
            settings.gstin = "07ABCDE5678G1ZC"
            settings.upi_id = "guptastore@upi"
            settings.prices_include_tax = True  # retail MRP includes GST
            settings.receipt_footer = "Goods once sold can be exchanged within 7 days with bill."

            location = await get_default_location(db, tenant_id)
            products = []
            classes = {c.code: c.id for c in (await db.execute(select(TaxClass).where(TaxClass.tenant_id == tenant_id))).scalars().all()}
            for sort, (category_name, items) in enumerate(data.RETAIL_ITEMS.items()):
                category = ProductCategory(id=uuid.uuid4(), tenant_id=tenant_id, name=category_name, sort_order=sort)
                db.add(category)
                for i, (name, mrp, tax_code, barcode, stock) in enumerate(items):
                    product = Product(id=uuid.uuid4(), tenant_id=tenant_id, category_id=category.id, name=name, base_price=mrp,
                                      tax_class_id=classes.get(tax_code), barcode=barcode, track_stock=True, low_stock_threshold=10, sort_order=i,
                                      cost_price=round(mrp * 0.82, 2))
                    db.add(product)
                    await db.flush()
                    db.add(InventoryLog(tenant_id=tenant_id, product_id=product.id, location_id=location.id,
                                        quantity_change=stock, reason="restock", note="Opening stock"))
                    products.append(product)
            await db.commit()

            bills = await generate_sales_history(db, tenant_id, products, ["RETAIL_WALKIN"], ["POS"], data.DEMO_CUSTOMERS)
        return f"{data.RETAIL_NAME}: {len(products)} barcoded products, {bills} bills"
