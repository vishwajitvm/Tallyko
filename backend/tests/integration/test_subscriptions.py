"""Tallyko subscriptions: trial, lock after the paid period, renewal requests, offers, the daily check, signing devices out."""
import uuid
from datetime import datetime, timedelta
import pytest
import pytest_asyncio
from sqlalchemy import delete
from tests.conftest import create_staff, random_client_ip
from app.core.security import get_password_hash
from app.core.tenant import drop_tenant_cache, get_shared_session_maker
from app.models import GlobalUser, SubscriptionOffer, TenantConfig
from app.services.subscription import run_subscription_check

async def _set_paid_until(tenant_id, when, lapsed=False):
    """Time passes: every period ends at `when`."""
    from sqlalchemy import update
    from app.models import Subscription
    async with get_shared_session_maker()() as db:
        await db.execute(update(Subscription).where(Subscription.vendor_id == tenant_id, Subscription.end_date > when).values(end_date=when))
        config = await db.get(TenantConfig, tenant_id)
        config.paid_until = when
        config.lapsed_at = when if lapsed else None
        await db.commit()
    await drop_tenant_cache(tenant_id)

async def _login(client, email, password):
    resp = await client.post("/api/v1/auth/login", headers=random_client_ip(), json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()

@pytest_asyncio.fixture
async def admin(client):
    email = f"subs_admin_{uuid.uuid4().hex[:8]}@example.com"
    async with get_shared_session_maker()() as db:
        db.add(GlobalUser(email=email, full_name="Billing admin", password_hash=get_password_hash("platformpass"), platform_role="super_admin"))
        await db.commit()
    body = await _login(client, email, "platformpass")
    yield {"Authorization": f"Bearer {body['access_token']}"}
    async with get_shared_session_maker()() as db:
        await db.execute(delete(GlobalUser).where(GlobalUser.email == email))
        await db.commit()

@pytest.mark.asyncio
async def test_new_business_starts_on_a_trial(client, fresh_tenant):
    body = await _login(client, fresh_tenant["email"], fresh_tenant["password"])
    assert body["subscription"]["state"] == "trial" and body["subscription"]["locked"] is False
    status = (await client.get("/api/v1/subscription", headers=fresh_tenant["headers"])).json()
    assert status["state"] == "trial" and status["can_pay"] is True and status["plans"]

@pytest.mark.asyncio
async def test_lapsed_business_is_locked_until_a_payment_is_approved(client, fresh_tenant, admin):
    owner, tenant_id = fresh_tenant["headers"], fresh_tenant["tenant_id"]
    await _set_paid_until(tenant_id, datetime.utcnow() - timedelta(hours=1))

    resp = await client.get("/api/v1/orders", headers=owner)
    assert resp.status_code == 402 and "renew" in resp.text.lower()
    assert (await client.post("/api/v1/sync/push", headers=owner, json={"orders": []})).status_code == 402  # device keeps its outbox
    assert (await client.get(f"/api/v1/public/{tenant_id}/menu")).status_code == 402  # online store closed too
    assert (await client.get("/api/v1/auth/me", headers=owner)).status_code == 200
    status = (await client.get("/api/v1/subscription", headers=owner)).json()
    assert status["state"] == "lapsed" and status["locked"] is True

    # Only the owner can claim a payment; a reference can't be reused
    claim = {"plan_key": "standard", "months": 3, "amount": 2400, "method": "upi", "reference": f"UTR{uuid.uuid4().hex[:10]}"}
    resp = await client.post("/api/v1/subscription/requests", headers=owner, json=claim)
    assert resp.status_code == 200, resp.text
    request_id = resp.json()["id"]
    assert (await client.post("/api/v1/subscription/requests", headers=owner, json=claim)).status_code == 409

    pending = (await client.get("/api/v1/platform/subscription-requests", headers=admin)).json()
    assert any(r["id"] == request_id and r["business_id"] == tenant_id for r in pending)
    resp = await client.post(f"/api/v1/platform/subscription-requests/{request_id}/approve", headers=admin, json={"note": "Checked UPI"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["plan_key"] == "standard" and resp.json()["months"] == 3

    assert (await client.get("/api/v1/orders", headers=owner)).status_code == 200
    status = (await client.get("/api/v1/subscription", headers=owner)).json()
    assert status["locked"] is False and status["plan_key"] == "standard"
    assert status["requests"][0]["status"] == "approved"

@pytest.mark.asyncio
async def test_subscription_offers_and_quotes(client, fresh_tenant, admin):
    code = f"YEAR{uuid.uuid4().hex[:5].upper()}"
    resp = await client.post("/api/v1/platform/subscription-offers", headers=admin, json={
        "name": "Yearly saver", "code": code, "discount_type": "percent", "discount_value": 25, "min_months": 12, "extra_days": 15})
    assert resp.status_code == 200, resp.text
    assert "25% off" in resp.json()["summary"]
    owner = fresh_tenant["headers"]
    short = (await client.post("/api/v1/subscription/quote", headers=owner, json={"plan_key": "pro", "months": 1, "offer_code": code})).json()
    assert short["offer_error"] == "Valid on 12+ months" and short["discount"] == 0
    year = (await client.post("/api/v1/subscription/quote", headers=owner, json={"plan_key": "pro", "months": 12, "offer_code": code})).json()
    assert year["offer_error"] is None and year["discount"] == round(year["list_price"] * 0.25, 2) and year["extra_days"] == 15

    # The super admin can apply it while recording a payment; usage is counted
    before = (await client.get("/api/v1/subscription", headers=owner)).json()["paid_until"]
    resp = await client.post(f"/api/v1/platform/businesses/{fresh_tenant['tenant_id']}/subscriptions", headers=admin,
                             json={"plan_key": "pro", "months": 12, "amount_paid": year["amount"], "offer_code": code, "payment_reference": "UTR1"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["extra_days"] == 15 and resp.json()["offer"]["code"] == code
    after = (await client.get("/api/v1/subscription", headers=owner)).json()["paid_until"]
    assert after > before
    offers = (await client.get("/api/v1/platform/subscription-offers", headers=admin)).json()
    assert next(o for o in offers if o["code"] == code)["redemptions"] == 1
    async with get_shared_session_maker()() as db:
        await db.execute(delete(SubscriptionOffer).where(SubscriptionOffer.code == code))
        await db.commit()

@pytest.mark.asyncio
async def test_daily_check_signs_out_lapsed_businesses_once(client, fresh_tenant):
    owner, tenant_id = fresh_tenant["headers"], fresh_tenant["tenant_id"]
    login = await _login(client, fresh_tenant["email"], fresh_tenant["password"])
    await _set_paid_until(tenant_id, datetime.utcnow() - timedelta(minutes=5))
    result = await run_subscription_check()
    assert tenant_id in result["locked_business_ids"]
    # Every device is signed out (401, the app goes to the sign-in screen; its offline bills stay on the device)
    assert (await client.get("/api/v1/auth/me", headers=owner)).status_code == 401
    resp = await client.post("/api/v1/auth/refresh", headers=random_client_ip(), json={"refresh_token": login["refresh_token"]})
    assert resp.status_code == 401
    # Signing in again works and shows the renewal screen state
    again = await _login(client, fresh_tenant["email"], fresh_tenant["password"])
    assert again["subscription"]["locked"] is True
    assert tenant_id not in (await run_subscription_check())["locked_business_ids"]  # idempotent

@pytest.mark.asyncio
async def test_super_admin_signs_a_business_out_and_lists_devices(client, fresh_tenant, admin):
    tenant_id = fresh_tenant["tenant_id"]
    login = await _login(client, fresh_tenant["email"], fresh_tenant["password"])
    headers = {"Authorization": f"Bearer {login['access_token']}"}
    devices = (await client.get(f"/api/v1/platform/businesses/{tenant_id}/sessions", headers=admin)).json()
    assert len(devices) >= 1 and devices[0]["role"] == "owner"
    resp = await client.post(f"/api/v1/platform/businesses/{tenant_id}/sign-out", headers=admin, json={"reason": "Payment pending"})
    assert resp.status_code == 200 and resp.json()["signed_out"] >= 1
    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 401
    assert (await client.get(f"/api/v1/platform/businesses/{tenant_id}/sessions", headers=admin)).json() == []

@pytest.mark.asyncio
async def test_signing_out_one_device_and_password_change(client, fresh_tenant):
    one = await _login(client, fresh_tenant["email"], fresh_tenant["password"])
    two = await _login(client, fresh_tenant["email"], fresh_tenant["password"])
    h1, h2 = ({"Authorization": f"Bearer {x['access_token']}"} for x in (one, two))
    sessions = (await client.get("/api/v1/auth/sessions", headers=h1)).json()
    current = next(s for s in sessions if s["current"])
    other = next(s for s in sessions if not s["current"])
    assert (await client.delete(f"/api/v1/auth/sessions/{other['id']}", headers=h1)).status_code == 200
    statuses = {(await client.get("/api/v1/auth/me", headers=h)).status_code for h in (h1, h2)}
    assert statuses == {200, 401}

    survivor = h1 if (await client.get("/api/v1/auth/me", headers=h1)).status_code == 200 else h2
    three = await _login(client, fresh_tenant["email"], fresh_tenant["password"])
    resp = await client.post("/api/v1/auth/change-password", headers=survivor,
                             json={"current_password": fresh_tenant["password"], "new_password": fresh_tenant["password"]})
    assert resp.status_code == 200
    assert (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {three['access_token']}"})).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=survivor)).status_code == 200
    assert current["device"]

@pytest.mark.asyncio
async def test_deactivated_staff_are_signed_out_immediately(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    cashier = await create_staff(client, owner, "cashier")
    assert (await client.get("/api/v1/orders", headers=cashier["headers"])).status_code == 200
    staff = (await client.get("/api/v1/staff", headers=owner)).json()
    staff_id = next(s["id"] for s in staff if s["role"] == "cashier")
    await client.put(f"/api/v1/staff/{staff_id}", headers=owner, json={"is_active": False})
    assert (await client.get("/api/v1/orders", headers=cashier["headers"])).status_code == 401

@pytest.mark.asyncio
async def test_grace_days_keep_a_business_open(client, fresh_tenant, admin):
    settings = (await client.get("/api/v1/platform/settings", headers=admin)).json()
    try:
        await client.put("/api/v1/platform/settings", headers=admin, json={**settings, "grace_days": 3})
        await _set_paid_until(fresh_tenant["tenant_id"], datetime.utcnow() - timedelta(days=1))
        from app.services import subscription
        subscription._settings_cache = None
        assert (await client.get("/api/v1/orders", headers=fresh_tenant["headers"])).status_code == 200
        status = (await client.get("/api/v1/subscription", headers=fresh_tenant["headers"])).json()
        assert status["state"] == "grace" and status["locked"] is False
    finally:
        await client.put("/api/v1/platform/settings", headers=admin, json=settings)
        from app.services import subscription
        subscription._settings_cache = None

@pytest.mark.asyncio
async def test_demo_length_and_development_access(client, admin):
    email = f"onboard_{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post("/api/v1/platform/businesses", headers=admin, json={
        "business_name": "Pilot Kitchen", "owner_name": "Pilot", "owner_email": email, "owner_phone": "98" + str(uuid.uuid4().int)[:8],
        "demo_days": 30})
    assert resp.status_code == 200, resp.text
    business_id, password = resp.json()["id"], resp.json()["temporary_password"]
    detail = (await client.get(f"/api/v1/platform/businesses/{business_id}", headers=admin)).json()
    assert detail["access"]["state"] == "trial" and 29 <= detail["access"]["days_left"] <= 30

    # The demo ends → locked; development access → works with no expiry; switched off → locked again
    await _set_paid_until(business_id, datetime.utcnow() - timedelta(hours=1))
    login = await _login(client, email, password)
    owner = {"Authorization": f"Bearer {login['access_token']}"}
    assert (await client.get("/api/v1/orders", headers=owner)).status_code == 402
    detail = (await client.post(f"/api/v1/platform/businesses/{business_id}/development", headers=admin, json={"enabled": True})).json()
    assert detail["development"] is True and detail["access"]["state"] == "development" and detail["access"]["days_left"] is None
    assert (await client.get("/api/v1/orders", headers=owner)).status_code == 200
    assert (await client.get("/api/v1/subscription", headers=owner)).json()["state"] == "development"
    detail = (await client.post(f"/api/v1/platform/businesses/{business_id}/development", headers=admin, json={"enabled": False})).json()
    assert detail["development"] is False
    assert (await client.get("/api/v1/orders", headers=owner)).status_code == 402

    # A demo can be given (or extended) any time
    resp = await client.post(f"/api/v1/platform/businesses/{business_id}/demo", headers=admin, json={"days": 7})
    assert resp.status_code == 200, resp.text
    assert (await client.get("/api/v1/orders", headers=owner)).status_code == 200
    assert (await client.get("/api/v1/subscription", headers=owner)).json()["state"] == "trial"
