import pytest
from httpx import AsyncClient
from app.main import app
import uuid

@pytest.mark.asyncio
async def test_kds_flow():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        # We need an order to exist, but even if it doesn't, we can test GET /kds/orders
        resp = await ac.get("/api/v1/kitchen/kds/orders")
        assert resp.status_code == 200
        orders = resp.json()
        assert isinstance(orders, list)
        
        # We can try to update a fake order and expect a 404
        fake_id = str(uuid.uuid4())
        resp = await ac.put(f"/api/v1/kitchen/kds/orders/{fake_id}/status", json={"status": "completed"})
        assert resp.status_code == 404
