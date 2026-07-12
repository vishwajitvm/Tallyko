import pytest
from httpx import AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_sync_pull():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        payload = {"last_pulled_at": 0}
        resp = await ac.post("/api/v1/sync/pull", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert "changes" in data
        assert "timestamp" in data

@pytest.mark.asyncio
async def test_sync_push():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        payload = {
            "last_pulled_at": 0,
            "changes": {
                "products": {
                    "created": [],
                    "updated": [],
                    "deleted": []
                }
            }
        }
        resp = await ac.post("/api/v1/sync/push", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
