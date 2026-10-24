"""Shared building blocks for seeders (all idempotent)."""
import random
from datetime import datetime, timedelta
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.security import get_password_hash
from app.core.tenant import get_shared_session_maker
from app.models import GlobalUser, TenantUser
from app.schemas.auth import VendorSignupRequest
from app.schemas.billing import OrderCreate, OrderItemIn, PaymentIn
from app.services import auth_service, order_service

async def find_account(session: AsyncSession, email: str) -> GlobalUser | None:
    return (await session.execute(select(GlobalUser).where(func.lower(GlobalUser.email) == email.lower()))).scalars().first()

async def ensure_business(email: str, owner_name: str, phone: str, business_name: str, business_type: str, password: str,
                          development: bool = True) -> tuple[str, bool]:
    """Create a business through the real signup flow, or reset its owner's password if it exists.
    Returns (tenant_id, created)."""
    async with get_shared_session_maker()() as session:
        account = await find_account(session, email)
        if account:
            member = (await session.execute(select(TenantUser).where(func.lower(TenantUser.username) == email.lower()))).scalars().first()
            hashed = get_password_hash(password)
            account.password_hash, account.is_active = hashed, True
            member.password_hash, member.is_active = hashed, True
            await session.commit()
            if development:
                await ensure_demo_subscription(member.tenant_id)
            return str(member.tenant_id), False
    tokens = await auth_service.register_vendor(VendorSignupRequest(
        vendor_name=business_name, owner_name=owner_name, email=email, phone=phone, password=password, business_type=business_type))
    if development:
        await ensure_demo_subscription(tokens.tenant_id)
    return str(tokens.tenant_id), True

async def ensure_demo_subscription(tenant_id) -> None:
    """Demo businesses get development access (no expiry) so the demo never locks."""
    from app.services.subscription import set_development_access
    async with get_shared_session_maker()() as session:
        await set_development_access(session, tenant_id, True, "demo seed", "Demo business")
        await session.commit()

async def ensure_staff_member(tenant_id: str, email: str, full_name: str, role: str, phone: str | None, password: str) -> bool:
    """Create or update a staff login for a business. Returns True if created."""
    hashed = get_password_hash(password)
    async with get_shared_session_maker()() as session:  # global accounts are not tenant data
        created = False
        account = await find_account(session, email)
        if account is None:
            session.add(GlobalUser(email=email, phone=phone, full_name=full_name, password_hash=hashed))
            created = True
        else:
            account.password_hash, account.is_active, account.full_name = hashed, True, full_name
        member = (await session.execute(select(TenantUser).where(func.lower(TenantUser.username) == email.lower(),
                                                                 TenantUser.tenant_id == tenant_id))).scalars().first()
        if member is None:
            session.add(TenantUser(tenant_id=tenant_id, username=email, full_name=full_name, role=role, password_hash=hashed))
        else:
            member.role, member.full_name, member.password_hash, member.is_active = role, full_name, hashed, True
        await session.commit()
        return created

async def generate_sales_history(db: AsyncSession, tenant_id: str, products: list, order_types: list[str], channels: list[str],
                                 customers: list[tuple[str, str]], days: int = 7) -> int:
    """Completed bills spread over the last `days` days, through the real order service (GST, stock, loyalty)."""
    rng = random.Random(tenant_id)
    count = 0
    for day in range(days - 1, -1, -1):
        for _ in range(rng.randint(6, 12)):
            body = OrderCreate(
                order_type=rng.choice(order_types), channel=rng.choice(channels),
                items=[OrderItemIn(product_id=p.id, quantity=rng.randint(1, 3)) for p in rng.sample(products, rng.randint(1, min(4, len(products))))],
                send_to_kitchen=False, created_at=datetime.utcnow() - timedelta(days=day, hours=rng.randint(0, 9)),
            )
            if customers and rng.random() < 0.3:
                body.customer_name, body.customer_phone = rng.choice(customers)
            order, _ = await order_service.create_order(db, tenant_id, body)
            await order_service.pay(db, tenant_id, order.id,
                                    [PaymentIn(method=rng.choice(["CASH", "UPI", "UPI", "CARD"]), amount=float(order.total_amount))], None, None)
            await db.commit()
            count += 1
    return count

async def attribute_demo_orders(tenant_id: str) -> int:
    """Demo sales are generated before staff exist; spread them over the demo waiters (dine-in) and cashiers."""
    from app.models import Order
    async with get_shared_session_maker()() as session:
        staff = (await session.execute(select(TenantUser).where(TenantUser.tenant_id == tenant_id, TenantUser.is_active == True))).scalars().all()
        waiters = sorted((s.id for s in staff if s.role == "waiter"), key=str)
        cashiers = sorted((s.id for s in staff if s.role == "cashier"), key=str)
        if not waiters or not cashiers:
            return 0
        orders = (await session.execute(select(Order).where(Order.tenant_id == tenant_id, Order.waiter_id.is_(None))
                                        .order_by(Order.created_at))).scalars().all()
        for n, order in enumerate(orders):
            cashier = cashiers[n % len(cashiers)]
            order.waiter_id = waiters[n % len(waiters)] if order.type == "DINE_IN" else cashier
            if order.status == "completed" and not order.settled_by:
                order.settled_by = cashier
        await session.commit()
        return len(orders)
