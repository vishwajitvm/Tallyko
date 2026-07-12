import pytest
from httpx import AsyncClient
from app.main import app
import time

@pytest.mark.asyncio
async def test_catalog_flow():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        # We need a tenant_id for the catalog flow. 
        # But for now our endpoints fall back to 'default-tenant-uuid' if request.state.tenant_id is missing.
        # This allows us to test the endpoints simply.
        
        # 1. Create a category
        cat_payload = {"name": f"Test Category {int(time.time())}"}
        resp = await ac.post("/api/v1/catalog/categories", json=cat_payload)
        assert resp.status_code == 200
        cat_data = resp.json()
        assert "id" in cat_data
        
        # 2. Create a product
        prod_payload = {
            "name": f"Test Prod {int(time.time())}",
            "base_price": 150.0,
            "category_id": cat_data["id"]
        }
        resp = await ac.post("/api/v1/catalog/products", json=prod_payload)
        assert resp.status_code == 200
        prod_data = resp.json()
        assert "id" in prod_data
        prod_id = prod_data["id"]
        
        # 3. Update the product
        update_payload = {"base_price": 175.0, "is_active": True}
        resp = await ac.put(f"/api/v1/catalog/products/{prod_id}", json=update_payload)
        assert resp.status_code == 200
        updated_prod = resp.json()
        assert updated_prod["base_price"] == 175.0
        
        # 4. List products to ensure it's there
        resp = await ac.get("/api/v1/catalog/products")
        assert resp.status_code == 200
        products = resp.json()
        assert any(p["id"] == prod_id for p in products)
        
        # 5. Soft-delete the product
        resp = await ac.delete(f"/api/v1/catalog/products/{prod_id}")
        assert resp.status_code == 200
        
        # 6. Verify it is no longer returned in list
        resp = await ac.get("/api/v1/catalog/products")
        assert resp.status_code == 200
        products = resp.json()
        assert not any(p["id"] == prod_id for p in products)
