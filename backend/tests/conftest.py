import os
import subprocess
import sys

# Tests never touch the development database: they use "<db>_test" (created and migrated on first run) and Redis DB 1
_DEV_DB = os.environ.get("DATABASE_URL", "postgresql+asyncpg://postgres:password_to_change_in_prod@db:5432/tallyko_shared")
_BASE, _, _NAME = _DEV_DB.rpartition("/")
if not _NAME.endswith("_test"):
    os.environ["DATABASE_URL"] = f"{_BASE}/{_NAME}_test"
os.environ["REDIS_URL"] = os.environ.get("REDIS_URL", "redis://cache:6379/0").rsplit("/", 1)[0] + "/1"

def _prepare_test_database() -> None:
    import asyncio as _asyncio
    import asyncpg
    url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    admin_url, _, name = url.rpartition("/")

    async def create():
        conn = await asyncpg.connect(f"{admin_url}/postgres")
        try:
            if not await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", name):
                await conn.execute(f'CREATE DATABASE "{name}"')
        finally:
            await conn.close()
    _asyncio.run(create())
    backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for args in (["migrate"], ["seed", "platform_defaults"]):
        subprocess.run([sys.executable, "manage.py", *args], cwd=backend, check=True, env=os.environ.copy(),
                       stdout=subprocess.DEVNULL)

_prepare_test_database()

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
import asyncio  # noqa: E402
import random  # noqa: E402
import uuid  # noqa: E402
from httpx import AsyncClient  # noqa: E402
from app.core.config import settings  # noqa: E402

# Tests spread requests over fake client IPs (X-Forwarded-For) so per-IP rate limits don't trip
settings.TRUST_PROXY = True
settings.EMAIL_WORKER_ENABLED = False  # tests inspect the queue directly
settings.JOB_SCHEDULER_ENABLED = False  # tests run the subscription check explicitly

from app.main import app  # noqa: E402

@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for each test case."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

def random_client_ip() -> dict:
    """The auth endpoints are rate-limited per client IP; give each test call its own."""
    return {"X-Forwarded-For": f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"}

def unique_phone() -> str:
    return "9" + str(uuid.uuid4().int)[:9]

TEST_GSTIN = "29ABCDE1111A1ZE"  # valid check character

async def create_tenant(ac: AsyncClient, name: str, business_type: str = "restaurant", gst: bool = True) -> dict:
    """Register a business and return its tenant_id, owner auth headers and login details."""
    suffix = uuid.uuid4().hex[:12]
    email = f"{name}_{suffix}@example.com"
    phone = unique_phone()
    resp = await ac.post("/api/v1/auth/register", headers=random_client_ip(), json={
        "vendor_name": f"{name} {suffix}",
        "owner_name": "Owner",
        "email": email,
        "phone": phone,
        "password": "securepassword",
        "business_type": business_type,
    })
    assert resp.status_code == 200, resp.text
    token_data = resp.json()
    if gst:  # a GST-registered business (valid GSTIN) charges GST; tests of unregistered billing pass gst=False
        settings = await ac.put("/api/v1/settings", headers={"Authorization": f"Bearer {token_data['access_token']}"},
                                json={"gstin": TEST_GSTIN, "gst_registration": "regular"})
        assert settings.status_code == 200, settings.text
    return {
        "tenant_id": token_data["tenant_id"],
        "headers": {"Authorization": f"Bearer {token_data['access_token']}"},
        "refresh_token": token_data["refresh_token"],
        "email": email,
        "phone": phone,
        "password": "securepassword",
    }

async def create_staff(ac: AsyncClient, owner_headers: dict, role: str) -> dict:
    email = f"{role}_{uuid.uuid4().hex[:10]}@example.com"
    resp = await ac.post("/api/v1/staff", headers=owner_headers, json={
        "full_name": f"Test {role}", "email": email, "role": role, "password": "staffpassword"})
    assert resp.status_code == 200, resp.text
    resp = await ac.post("/api/v1/auth/login", headers=random_client_ip(), json={"email": email, "password": "staffpassword"})
    assert resp.status_code == 200, resp.text
    return {"id": None, "email": email, "headers": {"Authorization": f"Bearer {resp.json()['access_token']}"}}

async def create_product(ac: AsyncClient, headers: dict, name: str = "Masala Chai", price: float = 100.0, **extra) -> dict:
    resp = await ac.post("/api/v1/catalog/products", headers=headers, json={"name": name, "base_price": price, **extra})
    assert resp.status_code == 200, resp.text
    return resp.json()

@pytest_asyncio.fixture(scope="session")
async def tenant_a():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        return await create_tenant(ac, "tenant_a")

@pytest_asyncio.fixture(scope="session")
async def tenant_b():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        return await create_tenant(ac, "tenant_b")

@pytest_asyncio.fixture
async def fresh_tenant():
    """A brand-new business per test, for tests that assert on totals or counters."""
    async with AsyncClient(app=app, base_url="http://test") as ac:
        return await create_tenant(ac, "fresh")

@pytest_asyncio.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac
