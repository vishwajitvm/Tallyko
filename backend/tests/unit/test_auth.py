import pytest
from httpx import AsyncClient
from app.main import app
import uuid

@pytest.fixture
def anyio_backend():
    return 'asyncio'

@pytest.mark.anyio
async def test_vendor_signup_and_login():
    unique_email = f"test_{uuid.uuid4()}@example.com"
    signup_data = {
        "vendor_name": "Test Cafe",
        "email": unique_email,
        "phone": "1234567890",
        "password": "securepassword",
        "plan_type": "free",
        "db_mode": "shared"
    }

    async with AsyncClient(app=app, base_url="http://test") as ac:
        # Test Signup
        response = await ac.post("/api/v1/auth/signup", json=signup_data)
        assert response.status_code == 200
        assert "vendor_id" in response.json()
        assert response.json()["message"] == "Vendor registered successfully"

        # Test Login
        login_data = {
            "email": unique_email,
            "password": "securepassword"
        }
        login_resp = await ac.post("/api/v1/auth/login", json=login_data)
        assert login_resp.status_code == 200
        assert "access_token" in login_resp.json()
        assert "tenant_id" in login_resp.json()
        assert login_resp.json()["role"] == "owner"
