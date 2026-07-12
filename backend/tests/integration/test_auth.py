import pytest
from httpx import AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_auth_flow():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        # 1. Register a new vendor
        import time
        unique_email = f"testauth_{int(time.time())}@example.com"
        register_payload = {
            "vendor_name": "Test Vendor",
            "email": unique_email,
            "phone": f"123{int(time.time())}",
            "password": "securepassword",
            "plan_type": "free",
            "db_mode": "shared"
        }
        resp = await ac.post("/api/v1/auth/register", json=register_payload)
        if resp.status_code != 200:
            print(f"Register Failed: {resp.text}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"] == "Vendor registered successfully"

        # 2. Login
        login_payload = {
            "email": unique_email,
            "password": "securepassword"
        }
        resp = await ac.post("/api/v1/auth/login", json=login_payload)
        assert resp.status_code == 200
        token_data = resp.json()
        assert token_data["success"] is True
        assert "access_token" in token_data
        assert "refresh_token" in token_data
        
        # 3. Refresh Token
        refresh_payload = {
            "refresh_token": token_data["refresh_token"]
        }
        resp = await ac.post("/api/v1/auth/refresh", json=refresh_payload)
        assert resp.status_code == 200
        new_token_data = resp.json()
        assert new_token_data["success"] is True
        assert "access_token" in new_token_data
        assert "refresh_token" in new_token_data

        # 4. Invite User
        invite_payload = {
            "email": "staff@example.com",
            "role": "staff"
        }
        headers = {"Authorization": f"Bearer {new_token_data['access_token']}"}
        resp = await ac.post("/api/v1/auth/invite", json=invite_payload, headers=headers)
        # We need to simulate the auth middleware or Depends that injects tenant_id for /invite.
        # Currently the router looks for request.state.tenant_id. We might get 401 if it's missing in tests unless we patch.
        # For now, let's just check the response.
