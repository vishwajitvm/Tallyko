"""Owner controls: GST only with a valid GSTIN, nothing deleted by the business, the owner's private watch list,
menu versions, and record corrections only through Tallyko's super admin."""
import uuid
import pytest
import pytest_asyncio
from sqlalchemy import delete, text
from tests.conftest import AsyncClient, app, create_product, create_staff, create_tenant, random_client_ip
from app.core.gstin import validate
from app.core.security import get_password_hash
from app.core.tenant import get_shared_session_maker, open_tenant_session
from app.models import GlobalUser, Order

@pytest_asyncio.fixture
async def admin(client):
    email = f"records_admin_{uuid.uuid4().hex[:8]}@example.com"
    async with get_shared_session_maker()() as db:
        db.add(GlobalUser(email=email, full_name="Records admin", password_hash=get_password_hash("platformpass"), platform_role="super_admin"))
        await db.commit()
    resp = await client.post("/api/v1/auth/login", headers=random_client_ip(), json={"email": email, "password": "platformpass"})
    yield {"Authorization": f"Bearer {resp.json()['access_token']}"}
    async with get_shared_session_maker()() as db:
        await db.execute(delete(GlobalUser).where(GlobalUser.email == email))
        await db.commit()

def test_gstin_validation():
    assert validate("27AAPFU0939F1ZV") == (True, None)
    assert validate(" 27aapfu0939f1zv ")[0] is True  # spaces / lower case are normalised
    assert "typo" in validate("27AAPFU0939F1ZW")[1]  # wrong check character
    assert "state code" in validate("45AAPFU0939F1ZV")[1]
    assert validate("27AAPFU0939F1Z")[0] is False

@pytest.mark.asyncio
async def test_gst_is_charged_only_with_a_valid_gstin(client):
    async with AsyncClient(app=app, base_url="http://test") as ac:
        shop = await create_tenant(ac, "nogst", gst=False)
    headers = shop["headers"]
    thali = await create_product(client, headers, "Thali", 100, tax_rate=5)
    order = (await client.post("/api/v1/orders", headers=headers, json={"items": [{"product_id": thali["id"], "quantity": 1}]})).json()
    assert order["tax_amount"] == 0.0 and order["bill_type"] == "bill_of_supply" and order["total_amount"] == 100.0
    taxes = (await client.get("/api/v1/taxes", headers=headers)).json()
    assert taxes["charges_gst"] is False and "GSTIN" in taxes["gst_note"]

    resp = await client.put("/api/v1/settings", headers=headers, json={"gstin": "27AAPFU0939F1ZW"})
    assert resp.status_code == 422 and "typo" in resp.text
    resp = await client.put("/api/v1/settings", headers=headers, json={"gstin": "", "gst_registration": "composition"})
    assert resp.status_code == 422
    resp = await client.put("/api/v1/settings", headers=headers, json={"gstin": "27aapfu0939f1zv", "gst_registration": "regular"})
    assert resp.status_code == 200 and resp.json()["gstin"] == "27AAPFU0939F1ZV" and resp.json()["charges_gst"] is True
    assert resp.json()["gstin_state"] == "Maharashtra"
    order = (await client.post("/api/v1/orders", headers=headers, json={"items": [{"product_id": thali["id"], "quantity": 1}]})).json()
    assert order["tax_amount"] == 5.0 and order["bill_type"] == "tax_invoice"

@pytest.mark.asyncio
async def test_staff_removals_are_kept_and_only_the_owner_sees_them(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    manager = await create_staff(client, owner, "manager")
    cashier = await create_staff(client, owner, "cashier")
    tea = await create_product(client, owner, "Tea", 20, tax_rate=0)
    cake = await create_product(client, owner, "Cake", 150, tax_rate=0)
    order = (await client.post("/api/v1/orders", headers=cashier["headers"], json={
        "items": [{"product_id": tea["id"], "quantity": 2}, {"product_id": cake["id"], "quantity": 1}], "send_to_kitchen": False})).json()
    cake_line = next(i for i in order["items"] if i["name"] == "Cake")
    order = (await client.delete(f"/api/v1/orders/{order['id']}/items/{cake_line['id']}", headers=cashier["headers"])).json()
    assert [i["name"] for i in order["items"]] == ["Tea"] and order["total_amount"] == 40.0  # gone for staff…

    # …but kept in the database (the app's role can't even delete bills)
    async for db in open_tenant_session(fresh_tenant["tenant_id"]):
        rows = (await db.execute(text("SELECT kitchen_status FROM order_items WHERE order_id = :o"), {"o": order["id"]})).scalars().all()
        assert sorted(rows, key=str) == sorted([None, "removed"], key=str)
        with pytest.raises(Exception):
            await db.execute(delete(Order).where(Order.id == order["id"]))
        await db.rollback()
        with pytest.raises(Exception):
            await db.execute(text("DELETE FROM audit_logs WHERE tenant_id = :t"), {"t": fresh_tenant["tenant_id"]})
        await db.rollback()

    resp = await client.post(f"/api/v1/orders/{order['id']}/cancel", headers=manager["headers"], json={"reason": "Customer left"})
    assert resp.status_code == 200

    # Even a manager allowed to read the activity log doesn't see cancellations; the owner's watch does, with who did what
    perms = next(r for r in (await client.get("/api/v1/roles", headers=owner)).json() if r["key"] == "manager")["permissions"]
    assert (await client.put("/api/v1/roles/manager", headers=owner, json={"permissions": perms + ["audit.view"]})).status_code == 200
    manager = await create_staff(client, owner, "manager")  # fresh login with the new role permissions
    log = (await client.get("/api/v1/audit", headers=manager["headers"])).json()
    items = log["items"] if isinstance(log, dict) else log
    assert not any(e["action"] in ("order.cancel", "order.remove_item") for e in items)
    assert (await client.get("/api/v1/owner/watch", headers=manager["headers"])).status_code == 403
    watch = (await client.get("/api/v1/owner/watch", headers=owner)).json()
    assert watch["totals"]["cancelled_bills"] == 1 and watch["totals"]["items_removed"] == 1
    assert watch["totals"]["items_removed_value"] == 150.0
    removed = watch["items"][0]
    assert removed["name"] == "Cake" and removed["by"] == "Test cashier" and removed["after_kitchen"] is False
    assert watch["cancelled_bills"][0]["reason"] == "Customer left" and watch["cancelled_bills"][0]["by"] == "Test manager"
    assert {e["action"] for e in watch["events"]} >= {"order.cancel", "order.remove_item"}

@pytest.mark.asyncio
async def test_menu_changes_are_versioned_and_restorable(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    item = await create_product(client, owner, "Butter Chicken", 300, tax_rate=5)
    manager = await create_staff(client, owner, "manager")
    await client.put(f"/api/v1/catalog/products/{item['id']}", headers=manager["headers"], json={"base_price": 340})
    await client.delete(f"/api/v1/catalog/products/{item['id']}", headers=manager["headers"])
    history = (await client.get(f"/api/v1/catalog/products/{item['id']}/history", headers=owner)).json()
    assert [h["change"] for h in history] == ["Removed from the menu", "Price ₹300 → ₹340", "Created"]
    assert history[1]["changed_by"] == "Test manager"

    restored = (await client.post(f"/api/v1/catalog/products/{item['id']}/history/1/restore", headers=owner)).json()
    assert restored["base_price"] == 300.0 and restored["is_active"] is True
    history = (await client.get(f"/api/v1/catalog/products/{item['id']}/history", headers=owner)).json()
    assert history[0]["change"] == "Restored version 1" and history[0]["version"] == 4
    watch = (await client.get("/api/v1/owner/watch", headers=owner)).json()
    assert watch["totals"]["menu_changes"] == 3

@pytest.mark.asyncio
async def test_only_tallyko_archives_or_deletes_bills_on_request(client, fresh_tenant, admin):
    owner, tenant_id = fresh_tenant["headers"], fresh_tenant["tenant_id"]
    soup = await create_product(client, owner, "Soup", 100, tax_rate=0, opening_stock=10)
    bills = []
    for _ in range(2):
        bills.append((await client.post("/api/v1/orders", headers=owner, json={"items": [{"product_id": soup["id"], "quantity": 1}],
                                                                                 "payments": [{"method": "CASH", "amount": 100}]})).json())
    resp = await client.post("/api/v1/owner/requests", headers=owner, json={"kind": "archive_bills", "order_ids": [bills[0]["id"]],
                                                                             "message": "Test bill made while training staff"})
    assert resp.status_code == 200, resp.text
    pending = (await client.get("/api/v1/platform/owner-requests", headers=admin)).json()
    req = next(r for r in pending if r["business_id"] == tenant_id)
    resp = await client.post(f"/api/v1/platform/owner-requests/{req['id']}/resolve", headers=admin,
                             json={"action": "archive", "response": "Archived the training bill"})
    assert resp.status_code == 200, resp.text
    listed = {o["id"] for o in (await client.get("/api/v1/orders", headers=owner)).json()["items"]}
    assert bills[0]["id"] not in listed and bills[1]["id"] in listed
    listed = {o["id"] for o in (await client.get("/api/v1/orders", headers=owner, params={"include_archived": True})).json()["items"]}
    assert bills[0]["id"] in listed
    assert (await client.get("/api/v1/owner/requests", headers=owner)).json()[0]["status"] == "done"

    # Permanent deletion needs typed confirmation; stock comes back
    resp = await client.post(f"/api/v1/platform/businesses/{tenant_id}/orders/delete", headers=admin,
                             json={"order_ids": [bills[1]["id"]], "reason": "Duplicate"})
    assert resp.status_code == 422
    resp = await client.post(f"/api/v1/platform/businesses/{tenant_id}/orders/delete", headers=admin,
                             json={"order_ids": [bills[1]["id"]], "reason": "Duplicate", "confirm": "DELETE"})
    assert resp.status_code == 200 and resp.json()["delete"] == 1 and resp.json()["warning"]
    assert (await client.get(f"/api/v1/orders/{bills[1]['id']}", headers=owner)).status_code == 404
    stock = {s["id"]: s["stock"] for s in (await client.get("/api/v1/inventory", headers=owner)).json()}
    assert stock[soup["id"]] == 9  # the deleted sale is undone; the archived one still counts
    audit = (await client.get("/api/v1/platform/audit", headers=admin)).json()
    rows = audit["items"] if isinstance(audit, dict) else audit
    assert any(r["action"] == "records.delete" for r in rows)


@pytest.mark.asyncio
async def test_watch_events_page(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    tea = await create_product(client, owner, "Tea", 20, tax_rate=0)
    for _ in range(3):
        order = (await client.post("/api/v1/orders", headers=owner, json={"items": [{"product_id": tea["id"], "quantity": 1}]})).json()
        await client.post(f"/api/v1/orders/{order['id']}/cancel", headers=owner, json={"reason": "test"})
    page = (await client.get("/api/v1/owner/watch/events", headers=owner, params={"limit": 2})).json()
    assert page["total"] == 3 and len(page["events"]) == 2 and page["events"][0]["order_id"]
    rest = (await client.get("/api/v1/owner/watch/events", headers=owner, params={"limit": 2, "offset": 2})).json()
    assert len(rest["events"]) == 1
