import pytest

@pytest.mark.asyncio
async def test_billing_flow(client, tenant_a):
    headers = tenant_a["headers"]

    resp = await client.post("/api/v1/catalog/products", headers=headers, json={"name": "Masala Chai", "base_price": 20.0})
    assert resp.status_code == 200, resp.text
    product_id = resp.json()["id"]

    resp = await client.post("/api/v1/billing/orders", headers=headers, json={
        "order_type": "TAKEAWAY",
        "items": [{"product_id": product_id, "quantity": 2, "price": 20.0}]
    })
    assert resp.status_code == 200, resp.text
    order = resp.json()
    assert order["status"] == "pending"

    resp = await client.post("/api/v1/billing/payments", headers=headers, json={"order_id": order["id"], "amount": order["total_amount"], "method": "CASH"})
    assert resp.status_code == 200, resp.text

    resp = await client.get("/api/v1/billing/orders", headers=headers)
    assert resp.status_code == 200
    orders = {o["id"]: o for o in resp.json()}
    assert orders[order["id"]]["status"] == "completed"
