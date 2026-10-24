"""Running bills on the floor: kitchen status per item, re-orders, cancellations, on the house, shared tables, split / merge."""
import pytest
from tests.conftest import create_product, create_staff

async def _table(client, headers, number):
    return (await client.post("/api/v1/tables", headers=headers, json={"table_number": number})).json()

async def _order(client, headers, items, **extra):
    resp = await client.post("/api/v1/orders", headers=headers, json={"items": items, **extra})
    assert resp.status_code == 200, resp.text
    return resp.json()

def _line(order, name, void=False):
    return next(i for i in order["items"] if i["name"] == name and i["is_void"] == void)

async def _tickets(client, headers):
    return (await client.get("/api/v1/kitchen/tickets", headers=headers, params={"status": "all"})).json()

@pytest.mark.asyncio
async def test_two_parties_at_one_table_get_separate_bills(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    t = await _table(client, owner, "T7")
    dosa = await create_product(client, owner, "Dosa", 100, tax_rate=0, print_to_kitchen=True)
    first = await _order(client, owner, [{"product_id": dosa["id"], "quantity": 1}], order_type="DINE_IN", table_id=t["id"])
    resp = await client.post("/api/v1/orders", headers=owner, json={"items": [{"product_id": dosa["id"], "quantity": 2}],
                                                                     "order_type": "DINE_IN", "table_id": t["id"]})
    assert resp.status_code == 409 and "separate bill" in resp.text
    second = await _order(client, owner, [{"product_id": dosa["id"], "quantity": 2}], order_type="DINE_IN", table_id=t["id"],
                          new_bill=True, guests=2)
    assert second["bill_label"] == "Bill 2" and second["guests"] == 2

    table = next(x for x in (await client.get("/api/v1/tables", headers=owner)).json() if x["id"] == t["id"])
    assert [b["id"] for b in table["open_bills"]] == [first["id"], second["id"]]
    assert table["open_bills"][0]["kitchen"] == {"pending": 1}

    await client.post(f"/api/v1/orders/{first['id']}/pay", headers=owner, json={"payments": [{"method": "CASH", "amount": 100}]})
    table = next(x for x in (await client.get("/api/v1/tables", headers=owner)).json() if x["id"] == t["id"])
    assert table["status"] == "occupied" and [b["id"] for b in table["open_bills"]] == [second["id"]]
    await client.post(f"/api/v1/orders/{second['id']}/pay", headers=owner, json={"payments": [{"method": "UPI", "amount": 200}]})
    table = next(x for x in (await client.get("/api/v1/tables", headers=owner)).json() if x["id"] == t["id"])
    assert table["status"] == "free" and table["open_bills"] == []

@pytest.mark.asyncio
async def test_items_progress_separately_and_a_reorder_gets_its_own_ticket(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    t = await _table(client, owner, "T1")
    names = ["Paneer", "Dal", "Rice", "Roti"]
    products = {n: await create_product(client, owner, n, 50, tax_rate=0, print_to_kitchen=True) for n in names}
    order = await _order(client, owner, [{"product_id": products[n]["id"], "quantity": 1} for n in names],
                         order_type="DINE_IN", table_id=t["id"])
    ids = {n: _line(order, n)["id"] for n in names}

    # Two dishes are ready, two still cooking: the ticket waits for the slowest
    await client.post(f"/api/v1/orders/{order['id']}/items/status", headers=owner, json={"item_ids": [ids["Paneer"], ids["Dal"]], "status": "ready"})
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/status", headers=owner,
                             json={"item_ids": [ids["Rice"], ids["Roti"]], "status": "preparing"})
    order = resp.json()
    assert {i["name"]: i["kitchen_status"] for i in order["items"]} == {"Paneer": "ready", "Dal": "ready", "Rice": "preparing", "Roti": "preparing"}
    assert (await _tickets(client, owner))[0]["status"] == "preparing"

    # A waiter (no kitchen screen in a small place) serves what's ready
    waiter = await create_staff(client, owner, "waiter")
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/status", headers=waiter["headers"],
                             json={"item_ids": [ids["Paneer"], ids["Dal"]], "status": "served"})
    assert resp.status_code == 200, resp.text

    # "Two more rotis" → a new ticket only for them; the first roti keeps its status
    order = (await client.post(f"/api/v1/orders/{order['id']}/items", headers=owner,
                               json={"items": [{"product_id": products["Roti"]["id"], "quantity": 2}]})).json()
    rotis = [i for i in order["items"] if i["name"] == "Roti"]
    assert sorted((i["quantity"], i["kitchen_status"]) for i in rotis) == [(1, "preparing"), (2, "pending")]
    assert len({i["kot_id"] for i in rotis}) == 2
    assert order["total_amount"] == 300.0

    # The kitchen bumps the whole first ticket to ready: its live lines follow
    first_kot = _line(order, "Rice")["kot_id"]
    await client.put(f"/api/v1/kitchen/tickets/{first_kot}/status", headers=owner, json={"status": "ready"})
    order = (await client.get(f"/api/v1/orders/{order['id']}", headers=owner)).json()
    assert _line(order, "Rice")["kitchen_status"] == "ready"

@pytest.mark.asyncio
async def test_cancelling_part_of_a_line_the_kitchen_has(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    roti = await create_product(client, owner, "Butter Roti", 30, tax_rate=0, print_to_kitchen=True, opening_stock=50)
    lassi = await create_product(client, owner, "Lassi", 60, tax_rate=0, print_to_kitchen=False)
    t = await _table(client, owner, "T9")
    order = await _order(client, owner, [{"product_id": roti["id"], "quantity": 3}], order_type="DINE_IN", table_id=t["id"])
    order = (await client.post(f"/api/v1/orders/{order['id']}/items", headers=owner,
                               json={"items": [{"product_id": lassi["id"], "quantity": 1}], "send_to_kitchen": False})).json()
    roti_line, lassi_line = _line(order, "Butter Roti"), _line(order, "Lassi")

    waiter = await create_staff(client, owner, "waiter")
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/void", headers=waiter["headers"],
                             json={"items": [{"item_id": roti_line["id"], "quantity": 1}], "reason": "Customer changed mind"})
    assert resp.status_code == 403
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/void", headers=owner, json={"items": [{"item_id": roti_line["id"], "quantity": 1}]})
    assert resp.status_code == 400  # reason required once the kitchen has it

    resp = await client.post(f"/api/v1/orders/{order['id']}/items/void", headers=owner,
                             json={"items": [{"item_id": roti_line["id"], "quantity": 1}], "reason": "Customer changed mind", "waste": True})
    order = resp.json()
    assert _line(order, "Butter Roti")["quantity"] == 2
    cancelled = _line(order, "Butter Roti", void=True)
    assert cancelled["quantity"] == 1 and cancelled["void_reason"] == "Customer changed mind" and cancelled["line_total"] == 0
    assert order["total_amount"] == 120.0  # 2 × 30 + 60

    ticket = (await _tickets(client, owner))[0]
    assert sorted((i["quantity"], i["is_void"]) for i in ticket["items"]) == [(1, True), (2, False)]

    # Unsent items are simply removed
    order = (await client.post(f"/api/v1/orders/{order['id']}/items/void", headers=waiter["headers"],
                               json={"items": [{"item_id": lassi_line["id"]}]})).json()
    assert all(i["name"] != "Lassi" for i in order["items"]) and order["total_amount"] == 60.0

    # The cancelled roti is booked as wastage; the sold ones leave stock at payment
    await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json={"payments": [{"method": "CASH", "amount": 60}]})
    stock = {s["id"]: s["stock"] for s in (await client.get("/api/v1/inventory", headers=owner)).json()}
    assert stock[roti["id"]] == 47
    report = (await client.get("/api/v1/reports/items", headers=owner)).json()
    rows = report if isinstance(report, list) else report.get("items", [])
    assert next(r for r in rows if r["name"] == "Butter Roti")["quantity"] == 2

@pytest.mark.asyncio
async def test_on_the_house(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    cake = await create_product(client, owner, "Cake", 200, tax_rate=0)
    tea = await create_product(client, owner, "Tea", 20, tax_rate=0)
    order = await _order(client, owner, [{"product_id": cake["id"], "quantity": 1}, {"product_id": tea["id"], "quantity": 2}])
    waiter = await create_staff(client, owner, "waiter")
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/comp", headers=waiter["headers"],
                             json={"items": [{"item_id": _line(order, "Cake")["id"]}], "reason": "Birthday"})
    assert resp.status_code == 403
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/comp", headers=owner,
                             json={"items": [{"item_id": _line(order, "Cake")["id"]}], "reason": "Birthday"})
    order = resp.json()
    cake_line = _line(order, "Cake")
    assert cake_line["comp_reason"] == "Birthday" and cake_line["comp_value"] == 200.0 and cake_line["line_total"] == 0
    assert order["total_amount"] == 40.0

@pytest.mark.asyncio
async def test_split_a_bill_then_merge_it_back(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    t = await _table(client, owner, "T4")
    thali = await create_product(client, owner, "Thali", 150, tax_rate=0, print_to_kitchen=True)
    soda = await create_product(client, owner, "Soda", 40, tax_rate=0)
    order = await _order(client, owner, [{"product_id": thali["id"], "quantity": 2}, {"product_id": soda["id"], "quantity": 2}],
                         order_type="DINE_IN", table_id=t["id"])

    # "Separate bills please": one thali and one soda go on a new bill on the same table
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/move", headers=owner, json={
        "items": [{"item_id": _line(order, "Thali")["id"], "quantity": 1}, {"item_id": _line(order, "Soda")["id"], "quantity": 1}],
        "new_bill_label": "Rahul"})
    assert resp.status_code == 200, resp.text
    source, target = resp.json()["source"], resp.json()["target"]
    assert source["total_amount"] == 190.0 and target["total_amount"] == 190.0
    assert target["bill_label"] == "Rahul" and target["table_id"] == t["id"]
    assert _line(target, "Thali")["kitchen_status"] == "pending"  # kitchen progress travels with the item

    table = next(x for x in (await client.get("/api/v1/tables", headers=owner)).json() if x["id"] == t["id"])
    assert len(table["open_bills"]) == 2

    # Changed their mind: one person pays for all
    merged = (await client.post(f"/api/v1/orders/{source['id']}/merge", headers=owner, json={"source_order_id": target["id"]})).json()
    assert merged["total_amount"] == 380.0
    gone = (await client.get(f"/api/v1/orders/{target['id']}", headers=owner)).json()
    assert gone["status"] == "merged" and gone["total_amount"] == 0
    table = next(x for x in (await client.get("/api/v1/tables", headers=owner)).json() if x["id"] == t["id"])
    assert [b["id"] for b in table["open_bills"]] == [source["id"]]

    # Items can't leave a bill that has a payment
    await client.post(f"/api/v1/orders/{source['id']}/pay", headers=owner, json={"payments": [{"method": "CASH", "amount": 100}]})
    resp = await client.post(f"/api/v1/orders/{source['id']}/items/move", headers=owner,
                             json={"items": [{"item_id": _line(merged, "Soda")["id"]}]})
    assert resp.status_code == 409

@pytest.mark.asyncio
async def test_moving_a_bill_onto_a_busy_table_keeps_both_bills(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    a, b = await _table(client, owner, "A1"), await _table(client, owner, "A2")
    tea = await create_product(client, owner, "Chai", 20, tax_rate=0)
    one = await _order(client, owner, [{"product_id": tea["id"], "quantity": 1}], order_type="DINE_IN", table_id=a["id"])
    two = await _order(client, owner, [{"product_id": tea["id"], "quantity": 1}], order_type="DINE_IN", table_id=b["id"])
    resp = await client.post(f"/api/v1/orders/{two['id']}/transfer", headers=owner, json={"table_id": a["id"]})
    assert resp.status_code == 200, resp.text
    tables = {x["id"]: x for x in (await client.get("/api/v1/tables", headers=owner)).json()}
    assert {bill["id"] for bill in tables[a["id"]]["open_bills"]} == {one["id"], two["id"]}
    assert tables[b["id"]]["status"] == "free"
