import hashlib
import hmac
import json
import pytest
from tests.conftest import create_product

@pytest.mark.asyncio
async def test_public_menu_and_qr_ordering(client, fresh_tenant):
    headers, tenant_id = fresh_tenant["headers"], fresh_tenant["tenant_id"]
    p = await create_product(client, headers, "Masala Dosa", 90, tax_rate=5, is_veg=True, print_to_kitchen=True)
    table = (await client.post("/api/v1/tables", headers=headers, json={"table_number": "5"})).json()

    menu = (await client.get(f"/api/v1/public/{tenant_id}/menu")).json()
    assert menu["products"][0]["name"] == "Masala Dosa" and menu["products"][0]["is_veg"] is True
    assert "cost_price" not in menu["products"][0]

    order_body = {"source": "QR", "table_id": table["id"], "customer_name": "Guest", "customer_phone": "9988776655",
                  "items": [{"product_id": p["id"], "quantity": 2}]}
    resp = await client.post(f"/api/v1/public/{tenant_id}/orders", json=order_body)
    assert resp.status_code == 403  # QR ordering is off by default

    await client.put("/api/v1/settings", headers=headers, json={"qr_ordering_enabled": True})
    resp = await client.post(f"/api/v1/public/{tenant_id}/orders", json=order_body)
    assert resp.status_code == 200, resp.text
    placed = resp.json()
    assert placed["status"] == "placed"

    inbox = (await client.get("/api/v1/orders", params={"status": "placed"}, headers=headers)).json()
    assert inbox["items"][0]["id"] == placed["id"] and inbox["items"][0]["channel"] == "QR"
    assert (await client.get("/api/v1/kitchen/tickets", headers=headers)).json() == []  # nothing cooks until accepted

    resp = await client.post(f"/api/v1/orders/{placed['id']}/accept", headers=headers)
    assert resp.json()["status"] == "open"
    assert len((await client.get("/api/v1/kitchen/tickets", headers=headers)).json()) == 1

    status = (await client.get(f"/api/v1/public/{tenant_id}/orders/{placed['id']}")).json()
    assert status["status"] == "open"

@pytest.mark.asyncio
async def test_online_store_disabled_by_default_and_rejects_bad_input(client, fresh_tenant):
    headers, tenant_id = fresh_tenant["headers"], fresh_tenant["tenant_id"]
    p = await create_product(client, headers, "Burger", 120)
    body = {"source": "ONLINE", "order_type": "DELIVERY", "customer_name": "A", "customer_phone": "9000011111",
            "items": [{"product_id": p["id"], "quantity": 1}]}
    assert (await client.post(f"/api/v1/public/{tenant_id}/orders", json=body)).status_code == 403
    await client.put("/api/v1/settings", headers=headers, json={"store_enabled": True})
    assert (await client.post(f"/api/v1/public/{tenant_id}/orders", json=body)).status_code == 400  # no address
    body["delivery_address"] = "12 MG Road"
    assert (await client.post(f"/api/v1/public/{tenant_id}/orders", json=body)).status_code == 200
    resp = await client.get("/api/v1/public/00000000-0000-0000-0000-000000000000/menu")
    assert resp.status_code == 404

def _sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

@pytest.mark.asyncio
async def test_aggregator_webhook(client, fresh_tenant):
    headers, tenant_id = fresh_tenant["headers"], fresh_tenant["tenant_id"]
    p = await create_product(client, headers, "Chicken Biryani", 250, tax_rate=5, sku="CB-01")
    channel = (await client.put("/api/v1/channels/ZOMATO", headers=headers, json={"enabled": True, "commission_pct": 25})).json()
    body = json.dumps({"external_order_id": "ZO-77", "customer_name": "Neha", "items": [{"sku": "CB-01", "quantity": 2}]}).encode()
    url = f"/api/v1/integrations/zomato/orders/{tenant_id}"

    resp = await client.post(url, content=body, headers={"X-Tallyko-Signature": "bad", "Content-Type": "application/json"})
    assert resp.status_code == 401

    sig = {"X-Tallyko-Signature": _sign(channel["webhook_secret"], body), "Content-Type": "application/json"}
    resp = await client.post(url, content=body, headers=sig)
    assert resp.status_code == 200, resp.text
    created = resp.json()
    assert created["status"] == "placed" and created["created"] is True
    resp = await client.post(url, content=body, headers=sig)
    assert resp.json()["created"] is False and resp.json()["id"] == created["id"]

    order = (await client.get(f"/api/v1/orders/{created['id']}", headers=headers)).json()
    assert order["payment_status"] == "paid" and order["commission_amount"] == 131.25  # 25% of 525
    accepted = (await client.post(f"/api/v1/orders/{created['id']}/accept", headers=headers)).json()
    assert accepted["status"] == "completed" and accepted["invoice_no"]

    unknown = json.dumps({"external_order_id": "ZO-78", "items": [{"name": "Pizza", "quantity": 1}]}).encode()
    resp = await client.post(url, content=unknown, headers={"X-Tallyko-Signature": _sign(channel["webhook_secret"], unknown)})
    assert resp.status_code == 422

@pytest.mark.asyncio
async def test_reports_summary(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    p = await create_product(client, headers, "Juice", 50, tax_rate=0)
    for method in ("CASH", "UPI"):
        await client.post("/api/v1/orders", headers=headers, json={"items": [{"product_id": p["id"], "quantity": 2}],
                                                                    "payments": [{"method": method, "amount": 100}]})
    summary = (await client.get("/api/v1/reports/summary", headers=headers)).json()
    assert summary["orders"] == 2 and summary["gross_sales"] == 200.0
    assert {r["method"]: r["amount"] for r in summary["by_payment"]} == {"CASH": 100.0, "UPI": 100.0}
    assert summary["top_items"][0] == {"name": "Juice", "quantity": 4, "revenue": 200.0}
    assert sum(summary["hourly"]) == 200.0


@pytest.mark.asyncio
async def test_table_qr_two_parties_and_upi_claim(client, fresh_tenant):
    headers, tenant_id = fresh_tenant["headers"], fresh_tenant["tenant_id"]
    table = (await client.post("/api/v1/tables", headers=headers, json={"table_number": "Q1"})).json()
    dosa = await create_product(client, headers, "Masala Dosa", 120, tax_rate=0, print_to_kitchen=True)
    resp = await client.put("/api/v1/settings", headers=headers, json={"qr_ordering_enabled": True, "qr_payment_mode": "both"})
    assert resp.status_code == 422  # UPI needs the shop's UPI ID
    await client.put("/api/v1/channels/QR", headers=headers, json={"auto_accept": True})
    resp = await client.put("/api/v1/settings", headers=headers, json={"qr_ordering_enabled": True, "qr_payment_mode": "both", "upi_id": "dosacorner@upi"})
    assert resp.status_code == 200, resp.text
    menu = (await client.get(f"/api/v1/public/{tenant_id}/menu", params={"channel": "QR"})).json()
    assert menu["ordering"]["qr_payment"] == {"counter": True, "upi": True, "upi_id": "dosacorner@upi", "payee_name": menu["business"]["name"]}

    def body(name, phone, qty, payment):
        return {"source": "QR", "table_id": table["id"], "customer_name": name, "customer_phone": phone, "payment": payment,
                "items": [{"product_id": dosa["id"], "quantity": qty}]}
    ip = {"X-Forwarded-For": "10.1.2.3"}
    a = (await client.post(f"/api/v1/public/{tenant_id}/orders", headers=ip, json=body("Asha Rao", "9811100001", 1, "upi"))).json()
    b = (await client.post(f"/api/v1/public/{tenant_id}/orders", headers={"X-Forwarded-For": "10.1.2.4"}, json=body("Bilal", "9811100002", 2, "counter"))).json()
    assert a["id"] != b["id"] and a["bill_label"] == "Asha" and b["total_amount"] == 240.0  # separate bills on one table
    assert a["upi_link"].startswith("upi://pay?pa=dosacorner%40upi") and "am=120.00" in a["upi_link"]
    again = (await client.post(f"/api/v1/public/{tenant_id}/orders", headers={"X-Forwarded-For": "10.1.2.5"}, json=body("Asha Rao", "9811100001", 1, "upi"))).json()
    assert again["id"] == a["id"] and again["total_amount"] == 240.0  # ordering again adds to her own bill
    tables = {t["id"]: t for t in (await client.get("/api/v1/tables", headers=headers)).json()}
    assert len(tables[table["id"]]["open_bills"]) == 2

    claim = (await client.post(f"/api/v1/public/{tenant_id}/orders/{a['id']}/payment-claim", headers={"X-Forwarded-For": "10.1.2.6"},
                               json={"reference": "412345678901"})).json()
    assert claim["payment_claim"]["amount"] == 240.0
    staff_view = (await client.get(f"/api/v1/orders/{a['id']}", headers=headers)).json()
    assert staff_view["payment_claim"]["reference"] == "412345678901"
    paid = (await client.post(f"/api/v1/orders/{a['id']}/payment-claim/confirm", headers=headers)).json()
    assert paid["status"] == "completed" and paid["payments"][0]["method"] == "UPI" and paid["payment_claim"] is None
    status = (await client.get(f"/api/v1/public/{tenant_id}/orders/{a['id']}", headers={"X-Forwarded-For": "10.1.2.7"})).json()
    assert status["payment_status"] == "paid" and status["upi_link"] is None
