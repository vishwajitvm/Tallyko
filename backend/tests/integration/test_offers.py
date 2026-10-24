import pytest
from tests.conftest import create_product, create_staff, unique_phone

async def _order(client, headers, items, **extra):
    resp = await client.post("/api/v1/orders", headers=headers, json={"items": items, **extra})
    assert resp.status_code == 200, resp.text
    return resp.json()

async def _offer(client, headers, **body):
    resp = await client.post("/api/v1/offers", headers=headers, json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()

@pytest.mark.asyncio
async def test_auto_offer_applies_above_minimum_and_stops_when_switched_off(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    thali = await create_product(client, headers, "Thali", 150, tax_rate=5)
    offer = await _offer(client, headers, name="Lunch 10%", benefit_type="percent", benefit_value=10,
                         min_order_amount=200, auto_apply=True)
    assert offer["state"] == "live" and "10%" in offer["summary"]

    order = await _order(client, headers, [{"product_id": thali["id"], "quantity": 2}], payments=[{"method": "CASH", "amount": 500}])
    assert order["offer_name"] == "Lunch 10%"
    assert order["discount_amount"] == 30.0
    assert order["total_amount"] == 284.0  # 270 + 13.50 GST, rounded

    small = await _order(client, headers, [{"product_id": thali["id"], "quantity": 1}], payments=[{"method": "CASH", "amount": 200}])
    assert small["offer_name"] is None and small["discount_amount"] == 0.0

    resp = await client.put(f"/api/v1/offers/{offer['id']}/active", headers=headers, json={"is_active": False})
    assert resp.json()["state"] == "off"
    again = await _order(client, headers, [{"product_id": thali["id"], "quantity": 2}], payments=[{"method": "CASH", "amount": 500}])
    assert again["offer_name"] is None and again["total_amount"] == 315.0

    offers = (await client.get("/api/v1/offers", headers=headers)).json()
    assert offers[0]["redemptions"] == 1

@pytest.mark.asyncio
async def test_evaluate_cart_lists_eligible_and_ineligible_offers(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    dosa = await create_product(client, headers, "Dosa", 100, tax_rate=0)
    await _offer(client, headers, name="Flat 50", benefit_type="flat", benefit_value=50, min_order_amount=300)
    await _offer(client, headers, name="Coupon", code="save20", benefit_type="percent", benefit_value=20)

    resp = await client.post("/api/v1/offers/evaluate", headers=headers, json={"items": [{"product_id": dosa["id"], "quantity": 2}]})
    assert resp.status_code == 200, resp.text
    by_name = {o["name"]: o for o in resp.json()["offers"]}
    assert by_name["Flat 50"]["eligible"] is False and by_name["Flat 50"]["reason"]

    resp = await client.post("/api/v1/offers/evaluate", headers=headers,
                             json={"items": [{"product_id": dosa["id"], "quantity": 2}], "code": "SAVE20"})
    by_name = {o["name"]: o for o in resp.json()["offers"]}
    assert by_name["Coupon"]["eligible"] is True and by_name["Coupon"]["discount"] == 40.0

@pytest.mark.asyncio
async def test_loyalty_reward_unlocks_after_enough_visits(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    meal = await create_product(client, headers, "Meal", 300, tax_rate=0)
    await _offer(client, headers, name="Regulars 50% off", kind="loyalty", benefit_type="percent", benefit_value=50,
                 min_visits=2, visits_window_days=30, min_order_amount=200, auto_apply=True)
    phone = unique_phone()
    for _ in range(2):
        o = await _order(client, headers, [{"product_id": meal["id"], "quantity": 1}], customer_phone=phone, customer_name="Meera",
                         payments=[{"method": "UPI", "amount": 300}])
        assert o["offer_name"] is None
    rewarded = await _order(client, headers, [{"product_id": meal["id"], "quantity": 1}], customer_phone=phone,
                            payments=[{"method": "UPI", "amount": 150}])
    assert rewarded["offer_name"] == "Regulars 50% off" and rewarded["total_amount"] == 150.0

@pytest.mark.asyncio
async def test_offer_validation_and_permissions(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    resp = await client.post("/api/v1/offers", headers=owner, json={"name": "Bad", "benefit_type": "percent", "benefit_value": 150})
    assert resp.status_code == 422
    resp = await client.post("/api/v1/offers", headers=owner, json={"name": "Loyal", "kind": "loyalty", "benefit_type": "flat", "benefit_value": 10})
    assert resp.status_code == 422
    await _offer(client, owner, name="Code A", code="DUP1", benefit_type="flat", benefit_value=10)
    resp = await client.post("/api/v1/offers", headers=owner, json={"name": "Code B", "code": "dup1", "benefit_type": "flat", "benefit_value": 10})
    assert resp.status_code == 409

    cashier = await create_staff(client, owner, "cashier")
    resp = await client.post("/api/v1/offers", headers=cashier["headers"], json={"name": "Mine", "benefit_type": "flat", "benefit_value": 10})
    assert resp.status_code == 403
    assert (await client.get("/api/v1/offers", headers=cashier["headers"])).status_code == 200

@pytest.mark.asyncio
async def test_announce_offer_queues_email_only_for_opted_in_customers(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    for opt_in, email in ((True, "yes@example.com"), (False, "no@example.com")):
        resp = await client.post("/api/v1/crm/customers", headers=headers, json={"name": "C", "phone": unique_phone(), "email": email,
                                                                                  "marketing_opt_in": opt_in})
        assert resp.status_code == 200 and resp.json()["marketing_opt_in"] is opt_in
    offer = await _offer(client, headers, name="Diwali", benefit_type="percent", benefit_value=15)
    resp = await client.post(f"/api/v1/offers/{offer['id']}/announce", headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"queued": 1, "opted_in_customers": 1}
    logs = (await client.get("/api/v1/email/logs", headers=headers)).json()
    assert [l["to"] for l in logs["items"]] == ["yes@example.com"]
