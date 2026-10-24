import uuid
from datetime import datetime, timedelta, timezone
import pytest
from tests.conftest import create_product

@pytest.mark.asyncio
async def test_pull_full_then_incremental(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    p1 = await create_product(client, headers, "Vada Pav", 25)
    full = (await client.post("/api/v1/sync/pull", json={"since": None}, headers=headers)).json()
    assert full["full"] is True
    assert full["settings"]["business_name"]
    assert {c["code"] for c in full["channels"]} >= {"POS", "SWIGGY"}
    assert p1["id"] in {p["id"] for p in full["products"]}

    p2 = await create_product(client, headers, "Misal", 60)
    delta = (await client.post("/api/v1/sync/pull", json={"since": full["server_time"]}, headers=headers)).json()
    ids = {p["id"] for p in delta["products"]}
    assert p2["id"] in ids

    # Deleted products come back as inactive so devices remove them
    await client.delete(f"/api/v1/catalog/products/{p1['id']}", headers=headers)
    delta = (await client.post("/api/v1/sync/pull", json={"since": full["server_time"]}, headers=headers)).json()
    removed = next(p for p in delta["products"] if p["id"] == p1["id"])
    assert removed["is_active"] is False

@pytest.mark.asyncio
async def test_push_offline_orders_is_idempotent_and_isolates_failures(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    p = await create_product(client, headers, "Poha", 30, tax_rate=0)
    taken_at = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    good = {"id": str(uuid.uuid4()), "items": [{"product_id": p["id"], "quantity": 2}], "created_at": taken_at,
            "payments": [{"method": "CASH", "amount": 60}]}
    bad = {"id": str(uuid.uuid4()), "items": [{"product_id": str(uuid.uuid4()), "quantity": 1}]}

    resp = await client.post("/api/v1/sync/push", json={"orders": [good, bad]}, headers=headers)
    assert resp.status_code == 200
    results = {r["id"]: r for r in resp.json()["results"]}
    assert results[good["id"]]["status"] == "ok" and results[good["id"]]["created"] is True
    assert results[good["id"]]["order"]["status"] == "completed"
    assert results[good["id"]]["order"]["created_at"].startswith(taken_at[:13])
    assert results[bad["id"]]["status"] == "error" and results[bad["id"]]["code"] == 404

    # Retrying after a flaky connection doesn't duplicate the bill
    resp = await client.post("/api/v1/sync/push", json={"orders": [good]}, headers=headers)
    assert resp.json()["results"][0]["created"] is False
    orders = (await client.get("/api/v1/orders", headers=headers)).json()
    assert orders["total"] == 1

@pytest.mark.asyncio
async def test_push_requires_client_ids(client, fresh_tenant):
    headers = fresh_tenant["headers"]
    p = await create_product(client, headers, "Upma", 30)
    resp = await client.post("/api/v1/sync/push", json={"orders": [{"items": [{"product_id": p["id"], "quantity": 1}]}]}, headers=headers)
    assert resp.json()["results"][0]["status"] == "error"
