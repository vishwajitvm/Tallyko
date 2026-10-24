import pytest
from tests.conftest import random_client_ip, create_staff

@pytest.mark.asyncio
async def test_register_returns_tokens_and_sets_up_business(client, fresh_tenant):
    resp = await client.get("/api/v1/auth/me", headers=fresh_tenant["headers"])
    assert resp.status_code == 200
    assert resp.json()["role"] == "owner"

    resp = await client.get("/api/v1/settings", headers=fresh_tenant["headers"])
    assert resp.status_code == 200
    assert resp.json()["business_name"].startswith("fresh")

    resp = await client.get("/api/v1/channels", headers=fresh_tenant["headers"])
    codes = {c["code"] for c in resp.json()}
    assert {"POS", "SWIGGY", "ZOMATO", "ONDC", "QR", "ONLINE"} <= codes

@pytest.mark.asyncio
async def test_login_with_email_or_phone_and_refresh(client, fresh_tenant):
    for identifier in (fresh_tenant["email"].upper(), fresh_tenant["phone"]):
        resp = await client.post("/api/v1/auth/login", headers=random_client_ip(), json={"email": identifier, "password": "securepassword"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["tenant_id"] == fresh_tenant["tenant_id"]

    resp = await client.post("/api/v1/auth/refresh", headers=random_client_ip(), json={"refresh_token": fresh_tenant["refresh_token"]})
    assert resp.status_code == 200
    assert resp.json()["tenant_id"] == fresh_tenant["tenant_id"]

@pytest.mark.asyncio
async def test_duplicate_signup_rejected(client, fresh_tenant):
    resp = await client.post("/api/v1/auth/register", headers=random_client_ip(), json={
        "vendor_name": "Copycat", "email": fresh_tenant["email"], "phone": "9000000001", "password": "securepassword"})
    assert resp.status_code == 409

@pytest.mark.asyncio
async def test_weak_password_rejected(client):
    resp = await client.post("/api/v1/auth/register", headers=random_client_ip(), json={
        "vendor_name": "Weak", "email": "weak@example.com", "phone": "9000000002", "password": "short"})
    assert resp.status_code == 422

@pytest.mark.asyncio
async def test_login_rejects_bad_password(client, fresh_tenant):
    resp = await client.post("/api/v1/auth/login", headers=random_client_ip(), json={"email": fresh_tenant["email"], "password": "wrongpassword"})
    assert resp.status_code == 401
    resp = await client.post("/api/v1/auth/login", headers=random_client_ip(), json={"email": "nobody@example.com", "password": "wrongpassword"})
    assert resp.status_code == 401

@pytest.mark.asyncio
async def test_refresh_token_cannot_be_used_as_access_token(client, fresh_tenant):
    resp = await client.get("/api/v1/orders", headers={"Authorization": f"Bearer {fresh_tenant['refresh_token']}"})
    assert resp.status_code == 401

@pytest.mark.asyncio
async def test_staff_roles_and_deactivation(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    cashier = await create_staff(client, owner, "cashier")

    # Cashiers can't manage the menu, staff, or settings
    resp = await client.post("/api/v1/catalog/products", headers=cashier["headers"], json={"name": "X", "base_price": 1})
    assert resp.status_code == 403
    resp = await client.post("/api/v1/staff", headers=cashier["headers"], json={
        "full_name": "Y", "email": "y@example.com", "role": "cashier", "password": "staffpassword"})
    assert resp.status_code == 403
    resp = await client.put("/api/v1/settings", headers=cashier["headers"], json={"business_name": "Hijack"})
    assert resp.status_code == 403

    # Managers can't create other managers; owners can
    manager = await create_staff(client, owner, "manager")
    resp = await client.post("/api/v1/staff", headers=manager["headers"], json={
        "full_name": "M2", "email": "m2_x@example.com", "role": "manager", "password": "staffpassword"})
    assert resp.status_code == 403

    staff = (await client.get("/api/v1/staff", headers=owner)).json()
    cashier_row = next(s for s in staff if s["email"] == cashier["email"])
    resp = await client.put(f"/api/v1/staff/{cashier_row['id']}", headers=owner, json={"is_active": False})
    assert resp.status_code == 200
    resp = await client.post("/api/v1/auth/login", headers=random_client_ip(), json={"email": cashier["email"], "password": "staffpassword"})
    assert resp.status_code == 401

@pytest.mark.asyncio
async def test_change_password(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    resp = await client.post("/api/v1/auth/change-password", headers=headers, json={"current_password": "wrong", "new_password": "newpassword1"})
    assert resp.status_code == 400
    resp = await client.post("/api/v1/auth/change-password", headers=headers, json={"current_password": "securepassword", "new_password": "newpassword1"})
    assert resp.status_code == 200
    resp = await client.post("/api/v1/auth/login", headers=random_client_ip(), json={"email": fresh_tenant["email"], "password": "newpassword1"})
    assert resp.status_code == 200

@pytest.mark.asyncio
async def test_staff_can_delete_own_account(client, fresh_tenant):
    cashier = await create_staff(client, fresh_tenant["headers"], "cashier")
    resp = await client.post("/api/v1/auth/delete-account", headers=cashier["headers"], json={"password": "wrong", "confirm": "DELETE"})
    assert resp.status_code == 400
    resp = await client.post("/api/v1/auth/delete-account", headers=cashier["headers"], json={"password": "staffpassword", "confirm": "DELETE"})
    assert resp.status_code == 200 and resp.json()["business_closed"] is False
    resp = await client.post("/api/v1/auth/login", headers=random_client_ip(), json={"email": cashier["email"], "password": "staffpassword"})
    assert resp.status_code == 401
    # The business keeps working
    assert (await client.get("/api/v1/orders", headers=fresh_tenant["headers"])).status_code == 200

@pytest.mark.asyncio
async def test_owner_deleting_account_closes_business_and_erases_customers(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    await client.post("/api/v1/crm/customers", headers=headers, json={"name": "Priya", "phone": "9811122233"})
    resp = await client.post("/api/v1/auth/delete-account", headers=headers, json={"password": "securepassword", "confirm": "DELETE"})
    assert resp.status_code == 200 and resp.json()["business_closed"] is True
    resp = await client.post("/api/v1/auth/login", headers=random_client_ip(), json={"email": fresh_tenant["email"], "password": "securepassword"})
    assert resp.status_code == 401
    # Existing tokens stop working for the closed business, and its public menu disappears
    assert (await client.get("/api/v1/crm/customers", headers=headers)).status_code == 403
    assert (await client.get(f"/api/v1/public/{fresh_tenant['tenant_id']}/menu")).status_code == 403
