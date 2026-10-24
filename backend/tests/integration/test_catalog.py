import pytest
from tests.conftest import create_product

@pytest.mark.asyncio
async def test_catalog_flow(client, fresh_tenant):
    headers = fresh_tenant["headers"]

    resp = await client.post("/api/v1/catalog/categories", json={"name": "Starters"}, headers=headers)
    assert resp.status_code == 200
    category = resp.json()
    # Same name again returns the existing category instead of a duplicate
    resp = await client.post("/api/v1/catalog/categories", json={"name": " starters "}, headers=headers)
    assert resp.json()["id"] == category["id"]

    product = await create_product(client, headers, "Paneer Tikka", 180, category_id=category["id"], tax_rate=5, is_veg=True,
                                   variants=[{"name": "Half", "price": 180}, {"name": "Full", "price": 320}])
    assert [v["name"] for v in product["variants"]] == ["Half", "Full"]
    assert product["variants"][1]["price"] == 320.0

    # Moving the base price keeps option prices as the owner set them
    resp = await client.put(f"/api/v1/catalog/products/{product['id']}", json={"base_price": 200}, headers=headers)
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["base_price"] == 200.0
    assert updated["variants"][1]["price"] == 320.0

    resp = await client.get("/api/v1/catalog/products", params={"q": "paneer"}, headers=headers)
    assert [p["id"] for p in resp.json()] == [product["id"]]

    resp = await client.delete(f"/api/v1/catalog/products/{product['id']}", headers=headers)
    assert resp.status_code == 200
    resp = await client.get("/api/v1/catalog/products", headers=headers)
    assert all(p["id"] != product["id"] for p in resp.json())

@pytest.mark.asyncio
async def test_barcode_generate_lookup_and_uniqueness(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    product = await create_product(client, headers, "Parle-G", 10)
    resp = await client.post(f"/api/v1/catalog/products/{product['id']}/barcode", headers=headers)
    assert resp.status_code == 200
    barcode = resp.json()["barcode"]
    assert len(barcode) == 13 and barcode.startswith("2")
    digits = [int(c) for c in barcode]
    assert (sum(d * (3 if i % 2 else 1) for i, d in enumerate(digits[:12])) + digits[12]) % 10 == 0

    resp = await client.get(f"/api/v1/catalog/products/by-barcode/{barcode}", headers=headers)
    assert resp.json()["id"] == product["id"]

    resp = await client.post("/api/v1/catalog/products", headers=headers, json={"name": "Copy", "base_price": 1, "barcode": barcode})
    assert resp.status_code == 409

@pytest.mark.asyncio
async def test_bulk_import_creates_categories_and_variants(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    resp = await client.post("/api/v1/catalog/bulk-import", headers=headers, json={"items": [
        {"name": "Dal Makhani", "price": 180, "category": "Main Course"},
        {"name": "Butter Naan", "price": 45, "category": "Breads"},
        {"name": "Shahi Paneer", "price": 280, "category": "Main Course", "variants": [{"name": "Half", "price": 160}, {"name": "Full", "price": 280}]},
        {"name": "dal makhani", "price": 999, "category": "Main Course"},
    ]})
    assert resp.status_code == 200
    assert resp.json()["created"] == 3
    assert resp.json()["skipped"] == ["dal makhani"]
    categories = (await client.get("/api/v1/catalog/categories", headers=headers)).json()
    assert sorted(c["name"] for c in categories) == ["Breads", "Main Course"]
    products = {p["name"]: p for p in (await client.get("/api/v1/catalog/products", headers=headers)).json()}
    assert products["Shahi Paneer"]["base_price"] == 160.0
    assert [v["price"] for v in products["Shahi Paneer"]["variants"]] == [160.0, 280.0]

@pytest.mark.asyncio
async def test_invalid_product_input_rejected(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    resp = await client.post("/api/v1/catalog/products", headers=headers, json={"name": "", "base_price": 10})
    assert resp.status_code == 422
    resp = await client.post("/api/v1/catalog/products", headers=headers, json={"name": "Neg", "base_price": -5})
    assert resp.status_code == 422
    body = resp.json()
    assert body["success"] is False and body["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_bulk_menu_edits_are_one_request_and_versioned(client, fresh_tenant):
    from tests.conftest import create_product as make
    headers = fresh_tenant["headers"]
    a = await make(client, headers, "Bulk A", 100, tax_rate=0)
    b = await make(client, headers, "Bulk B", 205, tax_rate=0)
    resp = await client.post("/api/v1/catalog/products/bulk", headers=headers,
                             json={"product_ids": [a["id"], b["id"]], "action": "price_pct", "value": 10})
    assert resp.status_code == 200 and resp.json()["updated"] == 2 and resp.json()["skipped"] == []
    prices = {p["id"]: p["base_price"] for p in (await client.get("/api/v1/catalog/products", headers=headers)).json()}
    assert prices[a["id"]] == 110.0 and prices[b["id"]] == 226.0  # 225.5 rounded to the rupee
    await client.post("/api/v1/catalog/products/bulk", headers=headers, json={"product_ids": [a["id"]], "action": "channel_hide", "channel": "zomato"})
    await client.post("/api/v1/catalog/products/bulk", headers=headers, json={"product_ids": [b["id"]], "action": "remove"})
    page = await client.get("/api/v1/catalog/products", headers=headers, params={"limit": 1})
    assert page.headers["x-total-count"] == "1" and page.json()[0]["channel_prices"] == {"ZOMATO": {"available": False}}
    removed = (await client.get("/api/v1/catalog/products", headers=headers, params={"only_inactive": True})).json()
    assert [p["id"] for p in removed] == [b["id"]]
    history = (await client.get(f"/api/v1/catalog/products/{a['id']}/history", headers=headers)).json()
    assert history[1]["change"] == "Price ₹100 → ₹110"

@pytest.mark.asyncio
async def test_customer_list_paging_sort_and_counts(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    for i, pts in enumerate((10, 150, 600)):
        await client.post("/api/v1/crm/customers", headers=headers, json={"name": f"Cust {i}", "phone": f"98000{i:05d}"})
        cust = (await client.get("/api/v1/crm/customers/lookup", headers=headers, params={"phone": f"98000{i:05d}"})).json()
        await client.put(f"/api/v1/crm/customers/{cust['id']}", headers=headers, json={"points": pts})
    resp = await client.get("/api/v1/crm/customers", headers=headers, params={"sort": "points", "limit": 2})
    assert resp.headers["x-total-count"] == "3" and [c["points"] for c in resp.json()] == [600, 150]
    import json
    assert json.loads(resp.headers["x-counts"]) == {"Gold": 1, "Silver": 1, "Bronze": 1, "all": 3, "opted_in": 0}
    gold = await client.get("/api/v1/crm/customers", headers=headers, params={"tier": "Gold"})
    assert [c["name"] for c in gold.json()] == ["Cust 2"]


@pytest.mark.asyncio
async def test_bulk_price_change_moves_options_with_the_item(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    item = await create_product(client, headers, "Paneer Tikka", 140, tax_rate=0,
                                variants=[{"name": "Half", "price": 140}, {"name": "Full", "price": 220}])
    resp = (await client.post("/api/v1/catalog/products/bulk", headers=headers,
                              json={"product_ids": [item["id"]], "action": "price_add", "value": 10})).json()
    assert resp["updated"] == 1
    assert sorted(v["price"] for v in resp["products"][0]["variants"]) == [150.0, 230.0]
