import uuid
import pytest
from tests.conftest import create_product, create_staff

@pytest.mark.asyncio
async def test_kds_flow(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    food = await create_product(client, headers, "Noodles", 120, print_to_kitchen=True)
    drink = await create_product(client, headers, "Cola", 40, print_to_kitchen=False)
    resp = await client.post("/api/v1/orders", headers=headers, json={
        "items": [{"product_id": food["id"], "quantity": 2, "notes": "less spicy"}, {"product_id": drink["id"], "quantity": 1}],
        "order_type": "TAKEAWAY"})
    order = resp.json()

    tickets = (await client.get("/api/v1/kitchen/tickets", headers=headers)).json()
    assert len(tickets) == 1
    ticket = tickets[0]
    assert ticket["order_id"] == order["id"] and ticket["token_no"] == order["token_no"]
    # Only kitchen items go on the ticket
    assert [{k: i[k] for k in ("name", "variant_name", "quantity", "notes", "status")} for i in ticket["items"]] ==         [{"name": "Noodles", "variant_name": None, "quantity": 2, "notes": "less spicy", "status": "pending"}]

    kitchen = await create_staff(client, headers, "kitchen")
    for status in ("preparing", "ready"):
        resp = await client.put(f"/api/v1/kitchen/tickets/{ticket['id']}/status", json={"status": status}, headers=kitchen["headers"])
        assert resp.status_code == 200 and resp.json()["status"] == status

    # Kitchen staff can't bill
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=kitchen["headers"], json={"payments": [{"method": "CASH", "amount": 1}]})
    assert resp.status_code == 403

    resp = await client.put(f"/api/v1/kitchen/tickets/{uuid.uuid4()}/status", json={"status": "ready"}, headers=headers)
    assert resp.status_code == 404
    resp = await client.put(f"/api/v1/kitchen/tickets/{ticket['id']}/status", json={"status": "eaten"}, headers=headers)
    assert resp.status_code == 422

@pytest.mark.asyncio
async def test_cancelled_order_cancels_its_tickets(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    food = await create_product(client, headers, "Pasta", 220, print_to_kitchen=True)
    order = (await client.post("/api/v1/orders", headers=headers, json={"items": [{"product_id": food["id"], "quantity": 1}]})).json()
    await client.post(f"/api/v1/orders/{order['id']}/cancel", headers=headers, json={"reason": "Customer left"})
    tickets = (await client.get("/api/v1/kitchen/tickets", headers=headers)).json()
    assert tickets == []
