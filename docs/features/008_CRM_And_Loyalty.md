# CRM & Loyalty

## 1. Overview
The Customer Relationship Management (CRM) module helps businesses build long-term relationships with their patrons. It automatically captures customer data during checkout, tracks purchase history, and powers a points-based loyalty system to incentivize return visits.

## 2. Key Capabilities
* **Frictionless Capture:** Add a customer to an order simply by typing their phone number during billing. If they are new, they are automatically saved.
* **Rich Profiles:** View a customer's entire lifetime value, average order size, and specific favorite items.
* **Loyalty Points Engine:** Automatically award points based on order value (default 1 point per ₹100) which can be redeemed on future purchases.
* **Direct Communication (Future Scope):** Integration for bulk SMS or WhatsApp marketing campaigns based on customer segments (e.g., "Hasn't visited in 30 days").

## 3. How to Use

### A. Capturing a Customer during Billing
1. On the **Billing** screen, while items are in the cart, tap the **Customer** field.
2. Enter a phone number.
3. If the customer exists in your database, their name and current loyalty point balance will appear. 
4. If they are new, you will be prompted to enter their name.
5. Upon checkout, the order is permanently linked to this customer profile.

### B. Managing Customer Profiles
1. Open **Customers**.
2. View the list of all registered customers, sortable by total spend or point balance.
3. Tap a specific customer to open their detailed profile.
4. Here you can view their past orders, edit their contact information, or manually adjust their loyalty points.

### C. Redeeming Points
1. When a returning customer is attached to a new order, their available points are displayed on the checkout screen.
2. Tap **Redeem Points** to convert their points into a cash discount applied directly to the current bill.

## 4. Under the Hood (Data Flow)

```mermaid
sequenceDiagram
    actor Cashier
    participant POS as App (Billing)
    participant API as FastAPI
    participant DB as PostgreSQL (RLS)

    Cashier->>POS: enter phone 98765 43210
    POS->>API: GET /crm/customers/lookup?phone=
    alt known customer
        API-->>POS: name, points, visits
    else new
        API-->>POS: not found, cashier types a name
    end
    Cashier->>POS: Pay Rs 500 (optionally redeem points)
    POS->>API: POST /orders {customer_phone, customer_name, redeem_points, payments}
    API->>DB: find or create the customer by phone
    API->>DB: bill completed: points earned per Rs 100,<br/>visits and total spent updated
    API->>DB: queue e-receipt / reward email if the customer has an email
```

Settings: `loyalty_enabled`, `loyalty_points_per_100` (points per ₹100), `loyalty_point_value` (₹ per point). Points are reversed if a completed bill is cancelled. Phone numbers are masked for roles without `customers.view_contact`. Loyalty *offers* (e.g. "5 visits this month → 20% off") are in [014](./014_Offers_Loyalty_Rewards_And_Email.md). Bulk SMS/WhatsApp campaigns are not built.

**API:** `GET/POST /crm/customers`, `GET/PUT /crm/customers/{id}` (detail with order history), `GET /crm/customers/lookup?phone=`. Tests: `backend/tests/integration/test_orders.py`.
