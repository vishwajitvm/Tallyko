import uuid
import pytest
from tests.conftest import create_product, create_staff

async def _order(client, headers, items, **extra):
    resp = await client.post("/api/v1/orders", headers=headers, json={"items": items, **extra})
    assert resp.status_code == 200, resp.text
    return resp.json()

@pytest.mark.asyncio
async def test_takeaway_with_gst_and_cash_change(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    chai = await create_product(client, headers, "Chai", 100, tax_rate=5)
    # Client-sent prices are ignored; the server prices from the menu
    order = await _order(client, headers, [{"product_id": chai["id"], "quantity": 2}], order_type="TAKEAWAY",
                         payments=[{"method": "CASH", "amount": 500}])
    assert order["subtotal"] == 200.0
    assert order["tax_amount"] == 10.0
    assert order["total_amount"] == 210.0
    assert order["status"] == "completed"
    assert order["payment_status"] == "paid"
    assert order["invoice_no"].startswith("INV/")
    assert order["token_no"] >= 1
    assert order["payments"] == [{"id": order["payments"][0]["id"], "method": "CASH", "amount": 210.0, "reference": None}]
    assert order["tax_breakup"] == [{"rate": 5.0, "taxable": 200.0, "cgst": 5.0, "sgst": 5.0, "igst": 0.0}]

@pytest.mark.asyncio
async def test_invoice_numbers_are_sequential(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    p = await create_product(client, headers, "Samosa", 20, tax_rate=0)
    invoices = []
    for _ in range(3):
        o = await _order(client, headers, [{"product_id": p["id"], "quantity": 1}], payments=[{"method": "UPI", "amount": 20}])
        invoices.append(o["invoice_no"])
    seqs = [int(i.rsplit("/", 1)[1]) for i in invoices]
    assert seqs == [seqs[0], seqs[0] + 1, seqs[0] + 2]

@pytest.mark.asyncio
async def test_dine_in_table_flow_with_kot_split_payment_and_discount(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    table = (await client.post("/api/v1/tables", headers=headers, json={"table_number": "T1", "section": "AC Hall"})).json()
    dal = await create_product(client, headers, "Dal", 200, tax_rate=5, print_to_kitchen=True)
    roti = await create_product(client, headers, "Roti", 20, tax_rate=5, print_to_kitchen=True)

    order = await _order(client, headers, [{"product_id": dal["id"], "quantity": 1}], order_type="DINE_IN", table_id=table["id"])
    assert order["status"] == "open"
    tables = (await client.get("/api/v1/tables", headers=headers)).json()
    assert tables[0]["status"] == "occupied" and tables[0]["current_order"]["id"] == order["id"]

    # A second order on the same table is refused; items get added to the running bill instead
    resp = await client.post("/api/v1/orders", headers=headers, json={"items": [{"product_id": roti["id"], "quantity": 1}],
                                                                       "order_type": "DINE_IN", "table_id": table["id"]})
    assert resp.status_code == 409
    resp = await client.post(f"/api/v1/orders/{order['id']}/items", headers=headers, json={"items": [{"product_id": roti["id"], "quantity": 5}]})
    assert resp.status_code == 200
    order = resp.json()
    assert order["subtotal"] == 300.0

    tickets = (await client.get("/api/v1/kitchen/tickets", headers=headers)).json()
    assert len(tickets) == 2 and tickets[0]["table_label"] == "T1"

    # 10% discount, then split UPI + cash
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=headers, json={
        "discount": {"type": "percent", "value": 10}, "payments": [{"method": "UPI", "amount": 100}]})
    assert resp.status_code == 200
    partial = resp.json()
    assert partial["discount_amount"] == 30.0
    assert partial["total_amount"] == 284.0  # 270 + 13.50 GST = 283.50 -> 284
    assert partial["payment_status"] == "partial" and partial["status"] == "open"

    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=headers, json={"payments": [{"method": "CASH", "amount": 200}]})
    paid = resp.json()
    assert paid["status"] == "completed" and paid["change"] == 16.0
    tables = (await client.get("/api/v1/tables", headers=headers)).json()
    assert tables[0]["status"] == "free"

    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=headers, json={"payments": [{"method": "CASH", "amount": 1}]})
    assert resp.status_code == 409

@pytest.mark.asyncio
async def test_overpaying_by_card_is_rejected(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    p = await create_product(client, headers, "Thali", 100, tax_rate=0)
    resp = await client.post("/api/v1/orders", headers=headers, json={"items": [{"product_id": p["id"], "quantity": 1}],
                                                                       "payments": [{"method": "CARD", "amount": 150}]})
    assert resp.status_code == 400

@pytest.mark.asyncio
async def test_same_client_id_is_idempotent(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    p = await create_product(client, headers, "Idli", 40, tax_rate=0)
    order_id = str(uuid.uuid4())
    body = {"id": order_id, "items": [{"product_id": p["id"], "quantity": 1}], "payments": [{"method": "CASH", "amount": 40}]}
    first = await _order(client, headers, **{k: v for k, v in body.items() if k != "items"}, items=body["items"])
    second = await _order(client, headers, **{k: v for k, v in body.items() if k != "items"}, items=body["items"])
    assert first["id"] == second["id"] == order_id
    assert second["created"] is False
    assert len(second["payments"]) == 1

@pytest.mark.asyncio
async def test_stock_and_loyalty_and_cancel_reverses_them(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    p = await create_product(client, headers, "Biscuit", 250, tax_rate=0, opening_stock=10)
    order = await _order(client, headers, [{"product_id": p["id"], "quantity": 4}], order_type="RETAIL_WALKIN",
                         customer_name="Ravi", customer_phone="9876543210", payments=[{"method": "UPI", "amount": 1000}])
    assert order["loyalty_points_earned"] == 10  # 1 point per ₹100
    stock = {s["id"]: s for s in (await client.get("/api/v1/inventory", headers=headers)).json()}
    assert stock[p["id"]]["stock"] == 6

    customers = (await client.get("/api/v1/crm/customers", params={"q": "98765"}, headers=headers)).json()
    assert customers[0]["points"] == 10 and customers[0]["visits"] == 1

    resp = await client.post(f"/api/v1/orders/{order['id']}/cancel", headers=headers, json={"reason": "Customer returned items"})
    assert resp.json()["status"] == "cancelled"
    stock = {s["id"]: s for s in (await client.get("/api/v1/inventory", headers=headers)).json()}
    assert stock[p["id"]]["stock"] == 10
    customers = (await client.get("/api/v1/crm/customers", params={"q": "98765"}, headers=headers)).json()
    assert customers[0]["points"] == 0

@pytest.mark.asyncio
async def test_redeem_loyalty_points(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    p = await create_product(client, headers, "Cake", 1000, tax_rate=0)
    await _order(client, headers, [{"product_id": p["id"], "quantity": 2}], customer_phone="9123456780", customer_name="Asha",
                 payments=[{"method": "CARD", "amount": 2000}])
    customer = (await client.get("/api/v1/crm/customers/lookup", params={"phone": "9123456780"}, headers=headers)).json()
    assert customer["points"] == 20
    order = await _order(client, headers, [{"product_id": p["id"], "quantity": 1}], customer_id=customer["id"])
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=headers, json={"redeem_points": 20, "payments": [{"method": "CASH", "amount": 980}]})
    assert resp.status_code == 200, resp.text
    assert resp.json()["discount_amount"] == 20.0
    customer = (await client.get("/api/v1/crm/customers/lookup", params={"phone": "9123456780"}, headers=headers)).json()
    assert customer["points"] == 9  # 20 - 20 redeemed + 9 earned on ₹980

@pytest.mark.asyncio
async def test_waiter_can_order_but_not_take_payment_or_cancel(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    waiter = await create_staff(client, owner, "waiter")
    p = await create_product(client, owner, "Lassi", 60, tax_rate=5)
    order = await _order(client, waiter["headers"], [{"product_id": p["id"], "quantity": 1}])
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=waiter["headers"], json={"payments": [{"method": "CASH", "amount": 63}]})
    assert resp.status_code == 403
    resp = await client.post(f"/api/v1/orders/{order['id']}/cancel", headers=waiter["headers"], json={"reason": "test"})
    assert resp.status_code == 403

@pytest.mark.asyncio
async def test_manual_aggregator_order_with_commission(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    await client.put("/api/v1/channels/SWIGGY", headers=headers, json={"enabled": True, "commission_pct": 20, "price_adjust_pct": 10})
    p = await create_product(client, headers, "Biryani", 200, tax_rate=5)
    order = await _order(client, headers, [{"product_id": p["id"], "quantity": 1}], channel="swiggy", order_type="DELIVERY",
                         external_order_id="SW-1001", payments=[{"method": "AGGREGATOR", "amount": 231}])
    assert order["channel"] == "SWIGGY"
    assert order["subtotal"] == 220.0  # +10% channel price
    assert order["total_amount"] == 231.0
    assert order["commission_amount"] == 46.2
    # Same aggregator order id is not billed twice
    again = await _order(client, headers, [{"product_id": p["id"], "quantity": 1}], channel="SWIGGY", external_order_id="SW-1001")
    assert again["id"] == order["id"]

@pytest.mark.asyncio
async def test_remove_item_and_unknown_product(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    a = await create_product(client, headers, "Tea", 10, tax_rate=0)
    b = await create_product(client, headers, "Coffee", 20, tax_rate=0)
    order = await _order(client, headers, [{"product_id": a["id"], "quantity": 1}, {"product_id": b["id"], "quantity": 1}], send_to_kitchen=False)
    item = next(i for i in order["items"] if i["name"] == "Coffee")
    resp = await client.delete(f"/api/v1/orders/{order['id']}/items/{item['id']}", headers=headers)
    assert resp.json()["total_amount"] == 10.0
    resp = await client.post("/api/v1/orders", headers=headers, json={"items": [{"product_id": str(uuid.uuid4()), "quantity": 1}]})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_each_aggregator_has_its_own_prices_and_menu(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    await client.put("/api/v1/channels/SWIGGY", headers=headers, json={"enabled": True, "price_adjust_pct": 10})
    await client.put("/api/v1/channels/ZOMATO", headers=headers, json={"enabled": True, "price_adjust_pct": 5})
    biryani = await create_product(client, headers, "Biryani", 200, tax_rate=0, channel_prices={"swiggy": {"price": 260}})
    combo = await create_product(client, headers, "Swiggy Combo", 300, tax_rate=0, channel_prices={"ZOMATO": {"available": False}})
    assert biryani["channel_prices"] == {"SWIGGY": {"price": 260.0}}

    swiggy = await _order(client, headers, [{"product_id": biryani["id"], "quantity": 1}, {"product_id": combo["id"], "quantity": 1}],
                          channel="SWIGGY", order_type="DELIVERY")
    assert swiggy["subtotal"] == 260.0 + 330.0  # item price on Swiggy; the combo gets Swiggy's 10% mark-up
    zomato = await _order(client, headers, [{"product_id": biryani["id"], "quantity": 1}], channel="ZOMATO", order_type="DELIVERY")
    assert zomato["subtotal"] == 210.0
    resp = await client.post("/api/v1/orders", headers=headers, json={"items": [{"product_id": combo["id"], "quantity": 1}],
                                                                       "channel": "ZOMATO", "order_type": "DELIVERY"})
    assert resp.status_code == 400 and "Zomato" in resp.text
    counter = await _order(client, headers, [{"product_id": biryani["id"], "quantity": 1}])
    assert counter["subtotal"] == 200.0

    menu = (await client.get("/api/v1/channels/ZOMATO/menu", headers=headers)).json()
    rows = {i["name"]: i for i in menu["items"]}
    assert rows["Swiggy Combo"]["available"] is False and rows["Biryani"]["price"] == 210.0 and rows["Biryani"]["price_source"] == "markup"
    resp = await client.put(f"/api/v1/catalog/products/{biryani['id']}", headers=headers, json={"channel_prices": {"FOO": {"price": 1}}})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_order_list_summary_rows_and_status_counts(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    p = await create_product(client, headers, "Idli", 30, tax_rate=0)
    for pay in (True, True, False):
        await _order(client, headers, [{"product_id": p["id"], "quantity": 2}],
                     **({"payments": [{"method": "CASH", "amount": 60}]} if pay else {}))
    resp = (await client.get("/api/v1/orders", headers=headers, params={"summary": True, "with_counts": True, "status": "completed"})).json()
    assert resp["total"] == 2 and resp["counts"]["all"] == 3 and resp["counts"]["completed"] == 2 and resp["counts"]["active"] == 1
    row = resp["items"][0]
    assert "items" not in row and row["item_count"] == 2 and row["total_amount"] == 60.0

@pytest.mark.asyncio
async def test_floor_alert_settings(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    resp = await client.put("/api/v1/settings", headers=headers, json={"ops_thresholds": {"table_amber_min": 30, "table_red_min": 60}})
    assert resp.status_code == 200 and resp.json()["ops_thresholds"]["table_amber_min"] == 30
    assert resp.json()["ops_thresholds"]["online_wait_min"] == 3
    resp = await client.put("/api/v1/settings", headers=headers, json={"ops_thresholds": {"table_amber_min": 90, "table_red_min": 60}})
    assert resp.status_code == 422
