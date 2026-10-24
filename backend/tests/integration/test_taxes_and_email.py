from datetime import datetime, timedelta
import pytest
from tests.conftest import create_product, create_staff

@pytest.mark.asyncio
async def test_tax_classes_custom_rate_and_scheduled_change(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    taxes = (await client.get("/api/v1/taxes", headers=headers)).json()
    assert taxes["registration"] == "regular" and taxes["classes"]
    assert any(c["is_default"] for c in taxes["classes"])

    resp = await client.post("/api/v1/taxes", headers=headers, json={"name": "Packaged sweets", "rate": 12})
    assert resp.status_code == 200, resp.text
    sweets = next(c for c in resp.json()["classes"] if c["name"] == "Packaged sweets")
    assert sweets["current_rate"] == 12.0
    assert {c["name"]: c["rate"] for c in sweets["current_components"]} == {"CGST": 6.0, "SGST": 6.0}

    barfi = await create_product(client, headers, "Barfi", 100, tax_class_id=sweets["id"])
    assert barfi["tax_class_id"] == sweets["id"]
    order = (await client.post("/api/v1/orders", headers=headers, json={"items": [{"product_id": barfi["id"], "quantity": 1}],
                                                                          "payments": [{"method": "CASH", "amount": 112}]})).json()
    assert order["tax_amount"] == 12.0

    # Government cuts the rate from next month: schedule it; today's bills are unchanged
    future = (datetime.utcnow() + timedelta(days=30)).isoformat()
    resp = await client.post(f"/api/v1/taxes/{sweets['id']}/rates", headers=headers, json={"rate": 5, "effective_from": future,
                                                                                           "note": "Notification 9/2026"})
    assert resp.status_code == 200, resp.text
    sweets = next(c for c in resp.json()["classes"] if c["id"] == sweets["id"])
    assert sweets["current_rate"] == 12.0
    upcoming = [r for r in sweets["rates"] if r["upcoming"]]
    assert len(upcoming) == 1 and upcoming[0]["total_rate"] == 5.0

    # Rates already in effect can't be rewritten
    past = (datetime.utcnow() - timedelta(days=1)).isoformat()
    resp = await client.post(f"/api/v1/taxes/{sweets['id']}/rates", headers=headers, json={"rate": 5, "effective_from": past})
    assert resp.status_code == 409

    resp = await client.delete(f"/api/v1/taxes/{sweets['id']}/rates/{upcoming[0]['id']}", headers=headers)
    assert resp.status_code == 200
    assert not [r for r in next(c for c in resp.json()["classes"] if c["id"] == sweets["id"])["rates"] if r["upcoming"]]

@pytest.mark.asyncio
async def test_bulk_assign_and_cross_tenant_class_is_rejected(client, fresh_tenant, tenant_b):
    headers = fresh_tenant["headers"]
    a = await create_product(client, headers, "Tea", 20)
    b = await create_product(client, headers, "Coffee", 30)
    classes = (await client.get("/api/v1/taxes", headers=headers)).json()["classes"]
    target = classes[0]["id"]
    resp = await client.post("/api/v1/taxes/assign", headers=headers, json={"tax_class_id": target, "product_ids": [a["id"], b["id"]]})
    assert resp.json() == {"updated": 2}
    assert (await client.get(f"/api/v1/catalog/products/{a['id']}", headers=headers)).json()["tax_class_id"] == target

    other = (await client.get("/api/v1/taxes", headers=tenant_b["headers"])).json()["classes"][0]["id"]
    resp = await client.put(f"/api/v1/catalog/products/{a['id']}", headers=headers, json={"tax_class_id": other})
    assert resp.status_code == 404

@pytest.mark.asyncio
async def test_cashier_cannot_change_taxes(client, fresh_tenant):
    cashier = await create_staff(client, fresh_tenant["headers"], "cashier")
    resp = await client.post("/api/v1/taxes", headers=cashier["headers"], json={"name": "Sneaky", "rate": 0})
    assert resp.status_code == 403

@pytest.mark.asyncio
async def test_email_templates_customise_preview_test_and_reset(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    templates = (await client.get("/api/v1/email/templates", headers=headers)).json()
    assert {t["key"] for t in templates} == {"loyalty_reward", "offer_announcement", "order_receipt", "welcome"}

    body = {"subject": "A treat for you, {customer_name}", "heading": "Thank you!", "body": "Enjoy {offer_details}. {nonsense}"}
    resp = await client.put("/api/v1/email/templates/loyalty_reward", headers=headers, json=body)
    assert resp.status_code == 422 and "nonsense" in resp.text

    body["body"] = "Enjoy {offer_details} at {business_name}."
    body["accent_color"] = "#0F766E"
    resp = await client.put("/api/v1/email/templates/loyalty_reward", headers=headers, json=body)
    assert resp.status_code == 200 and resp.json()["customised"] is True

    preview = (await client.post("/api/v1/email/templates/loyalty_reward/preview", headers=headers, json={})).json()
    assert preview["subject"] == "A treat for you, Priya"
    assert "#0F766E" in preview["html"] and "20% off" in preview["text"]
    unsaved = (await client.post("/api/v1/email/templates/loyalty_reward/preview", headers=headers,
                                 json={"subject": "Draft for {customer_name}"})).json()
    assert unsaved["subject"] == "Draft for Priya"
    assert "<script" not in (await client.post("/api/v1/email/templates/welcome/preview", headers=headers,
                                               json={"body": "<script>alert(1)</script>"})).json()["html"]

    resp = await client.post("/api/v1/email/templates/loyalty_reward/test", headers=headers, json={"to": "owner@example.com"})
    assert resp.status_code == 200 and resp.json()["status"] in ("queued", "skipped")
    logs = (await client.get("/api/v1/email/logs", headers=headers)).json()
    assert logs["items"][0]["to"] == "owner@example.com" and logs["items"][0]["subject"] == "A treat for you, Priya"

    resp = await client.delete("/api/v1/email/templates/loyalty_reward", headers=headers)
    assert resp.json()["customised"] is False

@pytest.mark.asyncio
async def test_email_settings_need_permission(client, fresh_tenant):
    waiter = await create_staff(client, fresh_tenant["headers"], "waiter")
    assert (await client.get("/api/v1/email/templates", headers=waiter["headers"])).status_code == 403
