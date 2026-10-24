import uuid
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.future import select
from app.core.tenant import open_tenant_session
from app.models import Product

PROTECTED_ROUTES = [
    ("get", "/api/v1/catalog/products"),
    ("get", "/api/v1/orders"),
    ("get", "/api/v1/tables"),
    ("get", "/api/v1/kitchen/tickets"),
    ("get", "/api/v1/inventory"),
    ("get", "/api/v1/crm/customers"),
    ("get", "/api/v1/reports/summary"),
    ("get", "/api/v1/settings"),
    ("get", "/api/v1/channels"),
    ("get", "/api/v1/staff"),
    ("get", "/api/v1/brands"),
    ("post", "/api/v1/sync/pull"),
    ("post", "/api/v1/sync/push"),
    ("post", "/api/v1/catalog/bulk-import"),
]

@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", PROTECTED_ROUTES)
async def test_protected_routes_require_token(client, method, path):
    resp = await getattr(client, method)(path)
    assert resp.status_code == 401

@pytest.mark.asyncio
async def test_tenant_cannot_see_or_modify_other_tenants_data(client, tenant_a, tenant_b):
    resp = await client.post("/api/v1/catalog/products", headers=tenant_a["headers"], json={"name": "A's Secret Item", "base_price": 99.0})
    assert resp.status_code == 200, resp.text
    product_id = resp.json()["id"]

    # B can't list, update, delete, or bill A's product
    resp = await client.get("/api/v1/catalog/products", headers=tenant_b["headers"])
    assert all(p["id"] != product_id for p in resp.json())
    resp = await client.put(f"/api/v1/catalog/products/{product_id}", headers=tenant_b["headers"], json={"base_price": 1.0})
    assert resp.status_code == 404
    resp = await client.delete(f"/api/v1/catalog/products/{product_id}", headers=tenant_b["headers"])
    assert resp.status_code == 404
    resp = await client.post("/api/v1/orders", headers=tenant_b["headers"], json={
        "order_type": "TAKEAWAY",
        "items": [{"product_id": product_id, "quantity": 1}]
    })
    assert resp.status_code == 404

    # A's order can't be paid by B
    resp = await client.post("/api/v1/orders", headers=tenant_a["headers"], json={
        "order_type": "TAKEAWAY",
        "items": [{"product_id": product_id, "quantity": 1}]
    })
    assert resp.status_code == 200, resp.text
    resp = await client.post(f"/api/v1/orders/{resp.json()['id']}/pay", headers=tenant_b["headers"], json={"payments": [{"amount": 1.0, "method": "CASH"}]})
    assert resp.status_code == 404

    # Public QR menus only show the tenant in the path
    resp = await client.get(f"/api/v1/public/{tenant_a['tenant_id']}/menu")
    assert any(p["id"] == product_id for p in resp.json()["products"])
    resp = await client.get(f"/api/v1/public/{tenant_b['tenant_id']}/menu")
    assert all(p["id"] != product_id for p in resp.json()["products"])

@pytest.mark.asyncio
async def test_rls_filters_queries_without_tenant_where_clause(client, tenant_a, tenant_b):
    resp = await client.post("/api/v1/catalog/products", headers=tenant_a["headers"], json={"name": "RLS Probe", "base_price": 5.0})
    product_id = uuid.UUID(resp.json()["id"])

    # Deliberately omit `WHERE tenant_id = ...` — the database must still filter
    async for session in open_tenant_session(tenant_b["tenant_id"]):
        products = (await session.execute(select(Product))).scalars().all()
        assert all(str(p.tenant_id) == tenant_b["tenant_id"] for p in products)
        assert product_id not in {p.id for p in products}

        role = (await session.execute(text("SELECT current_user"))).scalar()
        assert role == "tallyko_app"

    async for session in open_tenant_session(tenant_a["tenant_id"]):
        products = (await session.execute(select(Product))).scalars().all()
        assert product_id in {p.id for p in products}
        assert all(str(p.tenant_id) == tenant_a["tenant_id"] for p in products)

@pytest.mark.asyncio
async def test_rls_blocks_writes_into_another_tenant(tenant_a, tenant_b):
    async for session in open_tenant_session(tenant_b["tenant_id"]):
        session.add(Product(tenant_id=uuid.UUID(tenant_a["tenant_id"]), name="Smuggled", base_price=1))
        with pytest.raises(DBAPIError, match="row-level security"):
            await session.commit()

@pytest.mark.asyncio
async def test_rls_covers_v2_tables(client, tenant_a, tenant_b):
    from app.models import BusinessSettings, SalesChannel, Brand, TenantCounter
    resp = await client.post("/api/v1/brands", headers=tenant_a["headers"], json={"name": f"A brand {uuid.uuid4().hex[:6]}"})
    assert resp.status_code == 200
    await client.get("/api/v1/settings", headers=tenant_a["headers"])

    async for session in open_tenant_session(tenant_b["tenant_id"]):
        for model in (BusinessSettings, SalesChannel, Brand, TenantCounter):
            rows = (await session.execute(select(model))).scalars().all()
            assert all(str(r.tenant_id) == tenant_b["tenant_id"] for r in rows), model.__tablename__

@pytest.mark.asyncio
async def test_staff_list_is_tenant_scoped(client, tenant_a, tenant_b):
    a_staff = (await client.get("/api/v1/staff", headers=tenant_a["headers"])).json()
    b_staff = (await client.get("/api/v1/staff", headers=tenant_b["headers"])).json()
    assert {s["id"] for s in a_staff}.isdisjoint({s["id"] for s in b_staff})
