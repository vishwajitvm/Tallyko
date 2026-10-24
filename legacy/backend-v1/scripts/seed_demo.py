"""Create demo businesses and demo logins for every role (2 per role).

    docker compose exec backend python -m app.scripts.seed_demo

- "Sharma Da Dhaba" (restaurant): owner, 2 managers, 2 cashiers, 2 waiters, 2 kitchen staff, full menu, tables,
  customers and a week of sales.
- "Gupta General Store" (retail): owner, barcoded products with stock, a week of sales.

All demo logins share one password (DEMO_PASSWORD, default below) and are listed in
frontend/src/features/auth/demoAccounts.ts for the login-screen dropdown — keep the two in sync.
Safe to re-run: missing accounts are added and demo passwords reset. Refuses to run in production.
"""
import asyncio
import os
import random
import uuid
from datetime import datetime, timedelta
from sqlalchemy import func
from sqlalchemy.future import select
from app.core.config import settings
from app.core.security import get_password_hash
from app.core.tenant import get_shared_session_maker, open_tenant_session
from app.models import (GlobalUser, TenantUser, Product, ProductCategory, ProductVariant, TableEntity, BusinessSettings,
                               InventoryLog)
from app.schemas.auth import VendorSignupRequest
from app.schemas.billing import OrderCreate, OrderItemIn, PaymentIn
from app.services import auth_service, order_service
from app.services.settings_service import get_default_location

DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "Demo@1234")

DHABA_OWNER = ("owner.dhaba@example.com", "Rajesh Sharma", "9800000001")
STORE_OWNER = ("owner.store@example.com", "Sunita Gupta", "9800000002")
DHABA_STAFF = [
    # email, name, role, phone
    ("manager1@example.com", "Anil Kumar", "manager", "9800000011"),
    ("manager2@example.com", "Pooja Mehta", "manager", "9800000012"),
    ("cashier1@example.com", "Ravi Yadav", "cashier", "9800000021"),
    ("cashier2@example.com", "Neha Joshi", "cashier", "9800000022"),
    ("waiter1@example.com", "Suresh Pal", "waiter", "9800000031"),
    ("waiter2@example.com", "Mohan Lal", "waiter", "9800000032"),
    ("kitchen1@example.com", "Ramesh (Head chef)", "kitchen", "9800000041"),
    ("kitchen2@example.com", "Imran (Tandoor)", "kitchen", "9800000042"),
]

DHABA_MENU = {
    "Starters": [("Paneer Tikka", 220, True, [("Half", 140), ("Full", 220)]), ("Hara Bhara Kebab", 180, True, None),
                 ("Chicken Tikka", 280, False, [("Half", 170), ("Full", 280)]), ("Veg Manchurian", 160, True, None)],
    "Main Course": [("Dal Makhani", 180, True, [("Half", 110), ("Full", 180)]), ("Shahi Paneer", 240, True, [("Half", 150), ("Full", 240)]),
                    ("Butter Chicken", 320, False, [("Half", 190), ("Full", 320)]), ("Mix Veg", 170, True, None), ("Kadhai Chicken", 300, False, None)],
    "Breads": [("Tandoori Roti", 15, True, None), ("Butter Naan", 45, True, None), ("Lachha Paratha", 50, True, None), ("Garlic Naan", 60, True, None)],
    "Rice": [("Jeera Rice", 120, True, None), ("Veg Biryani", 200, True, None), ("Chicken Biryani", 260, False, [("Half", 160), ("Full", 260)])],
    "Beverages": [("Masala Chai", 20, True, None), ("Sweet Lassi", 60, True, None), ("Cold Coffee", 90, True, None), ("Mineral Water 1L", 20, True, None)],
    "Desserts": [("Gulab Jamun (2 pcs)", 50, True, None), ("Rasmalai", 70, True, None), ("Kulfi", 60, True, None)],
}

STORE_ITEMS = {
    # name, MRP, GST %, barcode, opening stock
    "Grocery": [("Aashirvaad Atta 5kg", 285, 5, "8901725181222", 40), ("Tata Salt 1kg", 28, 0, "8901058000290", 120),
                ("Fortune Sunflower Oil 1L", 165, 5, "8906007280017", 36), ("India Gate Basmati 1kg", 145, 5, "8906003250014", 50)],
    "Snacks": [("Parle-G 250g", 25, 18, "8901719101038", 200), ("Lay's Classic 52g", 20, 12, "8901491101830", 150),
               ("Haldiram Bhujia 200g", 55, 12, "8904004400076", 60)],
    "Beverages": [("Amul Taaza Milk 500ml", 27, 0, "8901262010016", 48), ("Coca-Cola 750ml", 40, 28, "8901764012709", 72),
                  ("Red Label Tea 250g", 140, 5, "8901030865275", 30)],
    "Personal Care": [("Colgate Strong Teeth 200g", 105, 18, "8901314010612", 45), ("Dettol Soap 125g", 52, 18, "8901396393559", 80),
                      ("Head & Shoulders 180ml", 210, 18, "4902430401258", 8)],
}

async def _find_user(session, email: str) -> GlobalUser | None:
    return (await session.execute(select(GlobalUser).where(func.lower(GlobalUser.email) == email.lower()))).scalars().first()

async def _ensure_business(email: str, name: str, phone: str, business: str, business_type: str) -> tuple[str, bool]:
    """Returns (tenant_id, created)."""
    async with get_shared_session_maker()() as session:
        user = await _find_user(session, email)
        if user:
            tenant_user = (await session.execute(select(TenantUser).where(func.lower(TenantUser.username) == email.lower()))).scalars().first()
            hashed = get_password_hash(DEMO_PASSWORD)
            user.password_hash, user.is_active = hashed, True
            tenant_user.password_hash, tenant_user.is_active = hashed, True
            await session.commit()
            return str(tenant_user.tenant_id), False
    tokens = await auth_service.register_vendor(VendorSignupRequest(
        vendor_name=business, owner_name=name, email=email, phone=phone, password=DEMO_PASSWORD, business_type=business_type))
    return str(tokens.tenant_id), True

async def _ensure_staff(tenant_id: str) -> None:
    hashed = get_password_hash(DEMO_PASSWORD)
    async with get_shared_session_maker()() as session:  # global accounts are not tenant data
        for email, name, role, phone in DHABA_STAFF:
            user = await _find_user(session, email)
            if user is None:
                session.add(GlobalUser(email=email, phone=phone, full_name=name, password_hash=hashed))
            else:
                user.password_hash, user.is_active, user.full_name = hashed, True, name
            member = (await session.execute(select(TenantUser).where(func.lower(TenantUser.username) == email,
                                                                     TenantUser.tenant_id == tenant_id))).scalars().first()
            if member is None:
                session.add(TenantUser(tenant_id=tenant_id, username=email, full_name=name, role=role, password_hash=hashed))
            else:
                member.role, member.full_name, member.password_hash, member.is_active = role, name, hashed, True
        await session.commit()

async def _seed_dhaba(tenant_id: str) -> None:
    async for db in open_tenant_session(tenant_id):
        biz = (await db.execute(select(BusinessSettings).where(BusinessSettings.tenant_id == tenant_id))).scalars().first()
        biz.address = "NH-44, Murthal, Sonipat, Haryana 131027"
        biz.gstin = "06ABCDE1234F1Z5"
        biz.fssai = "10821999000123"
        biz.upi_id = "sharmadhaba@upi"
        biz.receipt_footer = "Thank you! Visit again."
        biz.qr_ordering_enabled = True
        biz.store_enabled = True

        products = []
        for sort, (category_name, items) in enumerate(DHABA_MENU.items()):
            category = ProductCategory(id=uuid.uuid4(), tenant_id=tenant_id, name=category_name, sort_order=sort)
            db.add(category)
            for i, (name, price, veg, variants) in enumerate(items):
                base = min(v[1] for v in variants) if variants else price
                product = Product(id=uuid.uuid4(), tenant_id=tenant_id, category_id=category.id, name=name, base_price=base,
                                  is_veg=veg, print_to_kitchen=category_name != "Beverages", sort_order=i)
                db.add(product)
                for j, (vname, vprice) in enumerate(variants or []):
                    db.add(ProductVariant(product_id=product.id, variant_name=vname, price_modifier=vprice - base, sort_order=j))
                products.append(product)
        location = await get_default_location(db, tenant_id)
        for section, numbers in (("Garden", range(1, 7)), ("AC Hall", range(7, 13))):
            for n in numbers:
                db.add(TableEntity(tenant_id=tenant_id, location_id=location.id, table_number=str(n), section=section, capacity=4))
        await db.commit()
        await _history(db, tenant_id, products, ["DINE_IN", "TAKEAWAY", "TAKEAWAY", "DELIVERY"], ["POS", "POS", "POS", "OTHER"])

async def _seed_store(tenant_id: str) -> None:
    async for db in open_tenant_session(tenant_id):
        biz = (await db.execute(select(BusinessSettings).where(BusinessSettings.tenant_id == tenant_id))).scalars().first()
        biz.address = "Shop 12, Main Bazaar, Karol Bagh, New Delhi 110005"
        biz.gstin = "07ABCDE5678G1Z2"
        biz.upi_id = "guptastore@upi"
        biz.prices_include_tax = True  # retail MRP includes GST
        biz.receipt_footer = "Goods once sold can be exchanged within 7 days with bill."
        location = await get_default_location(db, tenant_id)
        products = []
        for sort, (category_name, items) in enumerate(STORE_ITEMS.items()):
            category = ProductCategory(id=uuid.uuid4(), tenant_id=tenant_id, name=category_name, sort_order=sort)
            db.add(category)
            for i, (name, mrp, gst, barcode, stock) in enumerate(items):
                product = Product(id=uuid.uuid4(), tenant_id=tenant_id, category_id=category.id, name=name, base_price=mrp,
                                  tax_rate=gst, barcode=barcode, track_stock=True, low_stock_threshold=10, sort_order=i,
                                  cost_price=round(mrp * 0.82, 2))
                db.add(product)
                await db.flush()
                db.add(InventoryLog(tenant_id=tenant_id, product_id=product.id, location_id=location.id,
                                    quantity_change=stock, reason="restock", note="Opening stock"))
                products.append(product)
        await db.commit()
        await _history(db, tenant_id, products, ["RETAIL_WALKIN"], ["POS"])

async def _history(db, tenant_id: str, products: list, types: list[str], channels: list[str]) -> None:
    """A week of completed sales so reports and customers aren't empty."""
    rng = random.Random(tenant_id)
    customers = [("Amit Verma", "9811111111"), ("Priya Singh", "9822222222"), ("Rohit Gupta", "9833333333")]
    for day in range(6, -1, -1):
        for _ in range(rng.randint(6, 12)):
            body = OrderCreate(
                order_type=rng.choice(types), channel=rng.choice(channels),
                items=[OrderItemIn(product_id=p.id, quantity=rng.randint(1, 3)) for p in rng.sample(products, rng.randint(1, 4))],
                send_to_kitchen=False, created_at=datetime.utcnow() - timedelta(days=day, hours=rng.randint(0, 9)),
            )
            if rng.random() < 0.3:
                body.customer_name, body.customer_phone = rng.choice(customers)
            order, _ = await order_service.create_order(db, tenant_id, body)
            await order_service.pay(db, tenant_id, order.id,
                                    [PaymentIn(method=rng.choice(["CASH", "UPI", "UPI", "CARD"]), amount=float(order.total_amount))], None, None)
            await db.commit()

async def main() -> None:
    if settings.ENVIRONMENT == "production":
        raise SystemExit("Refusing to seed demo data in production")

    # Older seeds used demo@example.com for the dhaba owner — rename it so the business keeps its data
    async with get_shared_session_maker()() as session:
        legacy = await _find_user(session, "demo@example.com")
        if legacy and not await _find_user(session, DHABA_OWNER[0]):
            legacy.email = DHABA_OWNER[0]
            for member in (await session.execute(select(TenantUser).where(TenantUser.username == "demo@example.com"))).scalars().all():
                member.username = DHABA_OWNER[0]
            await session.commit()

    dhaba_id, created = await _ensure_business(*DHABA_OWNER, "Sharma Da Dhaba", "restaurant")
    if created:
        await _seed_dhaba(dhaba_id)
    await _ensure_staff(dhaba_id)

    store_id, created = await _ensure_business(*STORE_OWNER, "Gupta General Store", "retail")
    if created:
        await _seed_store(store_id)

    print("\nDemo logins (password for all: %s)" % DEMO_PASSWORD)
    print(f"  owner    {DHABA_OWNER[0]:<26} Sharma Da Dhaba (restaurant)")
    print(f"  owner    {STORE_OWNER[0]:<26} Gupta General Store (retail)")
    for email, name, role, _ in DHABA_STAFF:
        print(f"  {role:<8} {email:<26} {name}")

if __name__ == "__main__":
    asyncio.run(main())
