# Product Catalog

## Section 1 — For the Customer / Business Owner

### What is this?
The Product Catalog is the heart of your business in Tallyko. It is where you define everything you sell, how much it costs, and how it is categorized. 

### Why does it exist?
Without a catalog, you can't ring up a sale. We designed this to be much faster and simpler than Shopto. Instead of navigating through multiple confusing menus to add one item, Tallyko lets you add a product, assign it to a category, and set its price all on a single, clean screen. It adapts seamlessly whether you are selling a "Cappuccino" (Restaurant) or scanning a barcode for a "Bottle of Water" (Retail).

### Real-World Examples
*   **The Restaurant Menu:** A restaurant manager creates a category called "Starters" and adds items like "Spring Rolls" (₹150) and "French Fries" (₹100). They tap a toggle to ensure these items print to the kitchen (KOT) when ordered.
*   **The Supermarket Checkout:** A grocery store owner scans the barcode of a new shampoo bottle using their phone camera. Tallyko instantly pulls up a "New Product" screen with the barcode pre-filled, so they just type the name, price, and hit save.

### Edge Cases
*   *What if I want to change a price temporarily?* You can easily edit the price in the catalog, and the change takes effect immediately on all POS terminals and customer QR menus.
*   *What if I have 1,000 items? Do I type them one by one?* No, Tallyko supports bulk importing via an Excel/CSV file on the Web Dashboard, or using our AI Menu Upload tool.

---

## Section 2 — For the Developer

### Data Model Touched (Shared Tenant DB)
*   `categories`: `id`, `tenant_id`, `name`, `sort_order`
*   `products`: `id`, `tenant_id`, `category_id`, `name`, `description`, `base_price`, `barcode`, `is_active`, `print_to_kitchen`

### API Endpoints
*   `GET /api/v1/products`: List all products (supports pagination, filtering by category/barcode).
*   `POST /api/v1/products`: Create a new product.
*   `PUT /api/v1/products/{id}`: Update an existing product.
*   `DELETE /api/v1/products/{id}`: Soft delete a product.

### Request/Response Shape (Create Product)
**Request:**
```json
{
  "name": "Spring Rolls",
  "category_id": "cat_123",
  "base_price": 150.00,
  "barcode": null,
  "print_to_kitchen": true
}
```

### Validation Rules
*   `name` is required and must be unique within the `tenant_id`.
*   `base_price` must be >= 0.
*   `barcode`, if provided, must be unique within the `tenant_id`.

### Multi-Tenant Considerations
Every single database query (Select, Insert, Update, Delete) must include the `tenant_id` constraint via the active Postgres session RLS to prevent cross-vendor data leakage.

### Logging Events (tracenest)
*   `product_created`: Includes `product_id`, `name`, and `tenant_id`.
*   `product_deleted`: Logs when a user removes an item from their catalog.

### Engineering Complexity Rating
**Low.** This is standard CRUD functionality. The primary complexity lies in ensuring the UI on the mobile app is highly responsive and minimizes the number of taps required.

### Sequence Diagram
```mermaid
sequenceDiagram
    participant App
    participant API
    participant DB as Postgres (RLS Active)
    participant Cache as Redis

    App->>API: POST /api/v1/products (JWT: Tenant 101)
    
    API->>API: Validate Payload
    API->>DB: SET LOCAL tenant=101; INSERT INTO products...
    DB-->>API: Success (ID: P12)
    
    API-)Cache: Invalidate /products cache for Tenant 101
    API-->>App: 201 Created (Product P12)
```
