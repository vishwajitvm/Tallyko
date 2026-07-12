# Multi-Vendor Architecture

## 1. Overview and Differentiator

Shopto and most legacy POS systems are designed as single-tenant applications (one installation = one business). Tallyko fundamentally differentiates itself by being a **true Multi-Tenant SaaS**. 

This architecture allows a single Tallyko instance to serve thousands of independent businesses (vendors), while ensuring strict data isolation, simplified centralized updates, and the flexibility to offer enterprise vendors their own dedicated database instances.

## 2. Core Concepts

*   **Global Database (Directory):** A master database containing non-tenant-specific data, such as:
    *   Vendor Registrations & Subscriptions (The immutable plan contracts).
    *   Global Users (authentication credentials).
    *   Tenant Routing Table (mapping a `tenant_id` to their specific database connection string).
*   **Shared Tenant Database (Default):** The vast majority of vendors will live here. Data is isolated at the row level. Every table (e.g., `products`, `orders`) has a `tenant_id` column.
*   **Dedicated Tenant Database (Opt-In):** For enterprise clients, Tallyko supports pointing their `tenant_id` to a completely separate PostgreSQL instance (even hosted on their own infrastructure).

## 3. Database Routing Pattern

When a request arrives at the FastAPI backend, the routing logic works as follows:

1.  **Identification:** The user authenticates (e.g., via JWT). The token contains their `tenant_id`.
2.  **Lookup:** A middleware intercepts the request, checks the `tenant_id`, and queries the in-memory cache (Redis) or Global Database for the tenant's connection configuration.
3.  **Connection Injection:** 
    *   If the tenant is on the **Shared DB**, the session is configured to append `WHERE tenant_id = X` to all queries (enforced via SQLAlchemy or PostgreSQL RLS).
    *   If the tenant is on a **Dedicated DB**, a specific SQLAlchemy engine/session is instantiated for that target connection string.
4.  **Execution:** The API logic executes without needing to know *where* the data is actually stored.

## 4. PostgreSQL Row-Level Security (RLS)

To prevent catastrophic data leaks in the shared database (e.g., Vendor A seeing Vendor B's sales), we rely on PostgreSQL's native Row-Level Security.

*   A Postgres role is configured for the application.
*   Before executing queries in a shared session, the application executes `SET LOCAL app.current_tenant_id = 'X'`.
*   RLS policies on tables automatically filter out any rows where `tenant_id != current_tenant_id`. This makes multi-tenancy foolproof at the database layer.

## 5. Sequence Diagram: Tenant Resolution

```mermaid
sequenceDiagram
    participant App as Mobile App
    participant API as FastAPI Middleware
    participant Global as Global DB / Redis
    participant Shared as Shared Tenant DB
    participant Ded as Dedicated Tenant DB

    App->>API: GET /api/v1/products (JWT: tenant=101)
    API->>Global: Lookup Connection for Tenant 101
    
    alt is Shared DB
        Global-->>API: Type: Shared
        API->>Shared: SET LOCAL tenant=101; SELECT * FROM products;
        Shared-->>API: [Products for 101]
    else is Dedicated DB
        App->>API: GET /api/v1/products (JWT: tenant=999)
        API->>Global: Lookup Connection for Tenant 999
        Global-->>API: Type: Dedicated, URI: postgres://...
        API->>Ded: SELECT * FROM products;
        Ded-->>API: [Products for 999]
    end
    
    API-->>App: 200 OK (JSON)
```

## 6. Onboarding Process

1.  **Standard Onboarding (Shared):** Vendor signs up. A `tenant_id` is created in the Global DB and mapped to the Shared DB pool. Instant provisioning.
2.  **Enterprise Onboarding (Dedicated):** DevOps provisions a new Postgres container/server. The connection string is added to the Global DB's routing table for that specific `tenant_id`. Migrations are run against the new instance. The application immediately begins routing their traffic to the new DB.
