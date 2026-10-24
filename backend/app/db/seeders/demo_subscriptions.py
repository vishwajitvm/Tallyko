from datetime import datetime, timedelta
from sqlalchemy.future import select
from app.core.tenant import get_shared_session_maker
from app.db.seeders import demo_data as data
from app.db.seeders.base import Seeder
from app.db.seeders.helpers import ensure_business, ensure_staff_member
from app.models import Plan, Subscription, SubscriptionOffer, SubscriptionRequest, TenantConfig
from app.services.subscription import get_platform_settings, save_platform_setting

class DemoSubscriptionsSeeder(Seeder):
    name = "demo_subscriptions"
    description = (f"Demo plan prices, subscription offers, UPI payment details, and {data.EXPIRED_NAME} "
                   "(subscription ended, one payment waiting for approval)")
    depends_on = ("platform_defaults",)

    async def run(self) -> str:
        async with get_shared_session_maker()() as db:
            for key, (monthly, options) in data.DEMO_PLAN_PRICES.items():
                plan = await db.get(Plan, key)
                if plan is not None:
                    plan.price_monthly, plan.billing_options = monthly, options
            for spec in data.DEMO_SUB_OFFERS:
                offer = (await db.execute(select(SubscriptionOffer).where(SubscriptionOffer.code == spec["code"]))).scalars().first()
                if offer is None:
                    db.add(SubscriptionOffer(**spec, ends_at=datetime.utcnow() + timedelta(days=60)))
            payment = (await get_platform_settings(db, fresh=True))["payment"]
            if not payment.get("upi_id"):
                await save_platform_setting(db, "payment", {**payment, "upi_id": "tallyko.demo@upi", "payee_name": "Tallyko (demo)",
                                                            "support_phone": "+91 98000 00000", "support_email": "billing@example.com"})
            await db.commit()

        email, owner, phone = data.EXPIRED_OWNER
        tenant_id, _ = await ensure_business(email, owner, phone, data.EXPIRED_NAME, "cafe", data.DEMO_PASSWORD, development=False)
        staff_email, staff_name, role, staff_phone = data.EXPIRED_STAFF
        await ensure_staff_member(tenant_id, staff_email, staff_name, role, staff_phone, data.DEMO_PASSWORD)
        async with get_shared_session_maker()() as db:
            ended = datetime.utcnow() - timedelta(days=2)
            config = await db.get(TenantConfig, tenant_id)
            config.paid_until, config.lapsed_at = ended, ended
            for sub in (await db.execute(select(Subscription).where(Subscription.vendor_id == tenant_id))).scalars().all():
                sub.end_date = min(sub.end_date, ended)
                sub.start_date = min(sub.start_date, sub.end_date - timedelta(days=7))
            if not (await db.execute(select(SubscriptionRequest.id).where(SubscriptionRequest.vendor_id == tenant_id))).first():
                db.add(SubscriptionRequest(vendor_id=tenant_id, plan_key="standard", months=12, offer_code="DIWALI25", amount=5992.5,
                                           method="upi", reference="UTR4092817731", requested_by=email,
                                           note="Paid from PhonePe this morning"))
            await db.commit()
        from app.core.tenant import drop_tenant_cache
        await drop_tenant_cache(tenant_id)
        return f"plan prices, {len(data.DEMO_SUB_OFFERS)} offers, payment details; {data.EXPIRED_NAME} locked (ended 2 days ago)"
