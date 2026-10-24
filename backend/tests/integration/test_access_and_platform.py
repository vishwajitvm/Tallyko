import uuid
import pytest
import pytest_asyncio
from sqlalchemy import delete
from tests.conftest import create_product, create_staff, random_client_ip
from app.core.security import get_password_hash
from app.core.tenant import get_shared_session_maker
from app.models import GlobalUser

async def _platform_login(client, role: str) -> dict:
    email = f"{role}_{uuid.uuid4().hex[:8]}@example.com"
    async with get_shared_session_maker()() as db:
        db.add(GlobalUser(email=email, full_name=f"Test {role}", password_hash=get_password_hash("platformpass"), platform_role=role))
        await db.commit()
    resp = await client.post("/api/v1/auth/login", headers=random_client_ip(), json={"email": email, "password": "platformpass"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["account_type"] == "platform" and body["platform_role"] == role
    return {"Authorization": f"Bearer {body['access_token']}", "email": email}

@pytest_asyncio.fixture
async def super_admin(client):
    headers = await _platform_login(client, "super_admin")
    yield {"Authorization": headers["Authorization"]}
    async with get_shared_session_maker()() as db:
        await db.execute(delete(GlobalUser).where(GlobalUser.email == headers["email"]))
        await db.commit()

@pytest.mark.asyncio
async def test_custom_role_limits_what_staff_can_do(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    resp = await client.post("/api/v1/roles", headers=owner, json={"name": "Billing Only", "permissions": ["orders.create", "orders.pay"]})
    assert resp.status_code == 200, resp.text
    role = resp.json()
    assert role["key"] == "billing_only" and role["is_system"] is False

    clerk = await create_staff(client, owner, role["key"])
    me = (await client.get("/api/v1/access/me", headers=clerk["headers"])).json()
    assert set(me["permissions"]) == {"orders.create", "orders.pay"}
    assert (await client.post("/api/v1/catalog/products", headers=clerk["headers"], json={"name": "X", "base_price": 1})).status_code == 403
    assert (await client.delete("/api/v1/roles/billing_only", headers=owner)).status_code == 409  # still assigned

    resp = await client.put("/api/v1/roles/billing_only", headers=owner, json={"permissions": ["orders.create", "orders.pay", "menu.manage"]})
    assert resp.status_code == 200
    assert (await client.post("/api/v1/catalog/products", headers=clerk["headers"], json={"name": "X", "base_price": 1})).status_code == 200

    audit = (await client.get("/api/v1/audit", headers=owner)).json()
    assert any(a["action"] == "role.update" for a in (audit["items"] if isinstance(audit, dict) else audit))

@pytest.mark.asyncio
async def test_unknown_permission_and_non_owner_role_changes_are_refused(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    assert (await client.post("/api/v1/roles", headers=owner, json={"name": "Odd", "permissions": ["launch.rockets"]})).status_code == 422
    manager = await create_staff(client, owner, "manager")
    assert (await client.put("/api/v1/roles/cashier", headers=manager["headers"], json={"permissions": []})).status_code == 403
    assert (await client.put("/api/v1/roles/owner", headers=owner, json={"permissions": []})).status_code == 400

@pytest.mark.asyncio
async def test_owner_can_hide_a_module(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    resp = await client.put("/api/v1/modules", headers=owner, json={"hidden": ["offers"]})
    assert resp.status_code == 200
    assert next(m for m in resp.json()["modules"] if m["key"] == "offers")["enabled"] is False
    assert (await client.get("/api/v1/offers", headers=owner)).status_code == 403
    await client.put("/api/v1/modules", headers=owner, json={"hidden": []})
    assert (await client.get("/api/v1/offers", headers=owner)).status_code == 200

@pytest.mark.asyncio
async def test_waiter_performance_report_counts_their_orders(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    waiter = await create_staff(client, owner, "waiter")
    p = await create_product(client, owner, "Juice", 80, tax_rate=0)
    order = (await client.post("/api/v1/orders", headers=waiter["headers"], json={"items": [{"product_id": p["id"], "quantity": 2}]})).json()
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json={"payments": [{"method": "CASH", "amount": 160}]})
    assert resp.json()["waiter_name"] == "Test waiter"
    rows = (await client.get("/api/v1/reports/staff", headers=owner)).json()
    rows = rows["staff"] if isinstance(rows, dict) else rows
    mine = next(r for r in rows if r["name"] == "Test waiter")
    assert mine["orders"] == 1 and mine["sales"] == 160.0

@pytest.mark.asyncio
async def test_platform_tokens_and_tenant_tokens_stay_in_their_lanes(client, fresh_tenant, super_admin):
    assert (await client.get("/api/v1/orders", headers=super_admin)).status_code == 403
    assert (await client.get("/api/v1/platform/overview", headers=fresh_tenant["headers"])).status_code == 403
    overview = (await client.get("/api/v1/platform/overview", headers=super_admin)).json()
    assert overview["businesses"].get("active", 0) >= 1

@pytest.mark.asyncio
async def test_super_admin_controls_features_and_records_payment(client, fresh_tenant, super_admin):
    tenant_id = fresh_tenant["tenant_id"]
    owner = fresh_tenant["headers"]
    resp = await client.put(f"/api/v1/platform/businesses/{tenant_id}", headers=super_admin, json={"feature_overrides": {"offers": False}})
    assert resp.status_code == 200, resp.text
    assert (await client.get("/api/v1/offers", headers=owner)).status_code == 403

    resp = await client.put(f"/api/v1/platform/businesses/{tenant_id}", headers=super_admin, json={"feature_overrides": {}})
    assert (await client.get("/api/v1/offers", headers=owner)).status_code == 200

    resp = await client.post(f"/api/v1/platform/businesses/{tenant_id}/subscriptions", headers=super_admin,
                             json={"plan_key": "standard", "months": 12, "amount_paid": 11988, "payment_method": "upi", "payment_reference": "UTR123"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["plan_key"] == "standard" and resp.json()["months"] == 12
    detail = (await client.get(f"/api/v1/platform/businesses/{tenant_id}", headers=super_admin)).json()
    assert detail["plan_key"] == "standard" and detail["subscription_status"] == "active"

    resp = await client.put(f"/api/v1/platform/businesses/{tenant_id}", headers=super_admin, json={"status": "suspended", "status_reason": "Payment pending"})
    assert resp.status_code == 200
    assert (await client.get("/api/v1/catalog/products", headers=owner)).status_code in (401, 403)
    await client.put(f"/api/v1/platform/businesses/{tenant_id}", headers=super_admin, json={"status": "active"})

@pytest.mark.asyncio
async def test_support_role_is_read_only(client, fresh_tenant):
    support = await _platform_login(client, "support")
    headers = {"Authorization": support["Authorization"]}
    assert (await client.get("/api/v1/platform/businesses", headers=headers)).status_code == 200
    resp = await client.put(f"/api/v1/platform/businesses/{fresh_tenant['tenant_id']}", headers=headers, json={"status": "suspended"})
    assert resp.status_code == 403

@pytest.mark.asyncio
async def test_manager_cannot_hand_out_more_access_than_they_have(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    resp = await client.post("/api/v1/roles", headers=owner, json={"name": "Auditor", "permissions": ["audit.view", "settings.manage"]})
    assert resp.status_code == 200
    manager = await create_staff(client, owner, "manager")
    resp = await client.post("/api/v1/staff", headers=manager["headers"], json={
        "full_name": "Sneaky", "email": f"sneaky_{uuid.uuid4().hex[:8]}@example.com", "role": "auditor", "password": "staffpassword"})
    assert resp.status_code == 403
    resp = await client.post("/api/v1/staff", headers=manager["headers"], json={
        "full_name": "Fine", "email": f"fine_{uuid.uuid4().hex[:8]}@example.com", "role": "cashier", "password": "staffpassword"})
    assert resp.status_code == 200, resp.text

@pytest.mark.asyncio
async def test_table_waiter_assignment_and_attribution(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    waiter = await create_staff(client, owner, "waiter")
    staff = (await client.get("/api/v1/staff", headers=owner)).json()
    waiter_id = next(s["id"] for s in staff if s["role"] == "waiter")
    table = (await client.post("/api/v1/tables", headers=owner, json={"table_number": "W1"})).json()
    resp = await client.put(f"/api/v1/tables/{table['id']}", headers=owner, json={"assigned_staff_id": waiter_id})
    assert resp.status_code == 200 and resp.json()["assigned_staff_id"] == waiter_id
    assert (await client.put(f"/api/v1/tables/{table['id']}", headers=owner, json={"assigned_staff_id": str(uuid.uuid4())})).status_code == 404
    p = await create_product(client, owner, "Soup", 100, tax_rate=0)
    order = (await client.post("/api/v1/orders", headers=owner, json={"items": [{"product_id": p["id"], "quantity": 1}],
                                                                        "order_type": "DINE_IN", "table_id": table["id"]})).json()
    assert order["waiter_name"] == "Test waiter"
    resp = await client.put(f"/api/v1/tables/{table['id']}", headers=owner, json={"assigned_staff_id": None})
    assert resp.json()["assigned_staff_id"] is None
