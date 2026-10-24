# System Architecture

How Tallyko is built today (v2.0.0). Every diagram here is generated from a file in [`diagrams/`](./diagrams/README.md); when the code changes, change the `.mmd` file and re-run the embed step described there.

## 1. Overview

Tallyko is one Docker Compose stack:

| Tier | What runs | Notes |
|---|---|---|
| Clients | **One Expo app** (SDK 57, React Native 0.86, React 19): web/PWA, Android APK/AAB, iOS app or home-screen web app | Owner, staff, kitchen display and the super admin console are roles and routes in the same app. Public `/store/{tenantId}` pages need no login. |
| Edge | **Caddy 2** (production) | Automatic HTTPS (Let's Encrypt), serves the static web build, proxies `/api` to the backend. In development the Expo dev server (:8081) and the API (:8000) are reached directly. |
| Application | **FastAPI** on uvicorn (`WEB_CONCURRENCY` workers, default 2) | Thin routers under `/api/v1`, business rules in `app/services`. Two **in-process background tasks** start in the API lifespan: the email worker and the daily subscription scheduler. |
| Data | **PostgreSQL 15** with Row-Level Security, **Redis 7** | One shared database; dedicated per-tenant databases are supported in routing only. Redis holds caches, rate limits, revoked sessions and job locks. |
| Outside | Any **SMTP** server (Mailpit in dev), the customer's **UPI app** (deep link), aggregator **webhooks** | No paid APIs: OCR is RapidOCR on the server, there is no payment gateway. |

**Not built** (described in older drafts, removed here): Traefik, Cloudflare WAF, Celery/ARQ worker containers, MinIO/object storage, PgBouncer, a separate React "owner dashboard", SQLite or WatermelonDB on devices, a LAN-only kitchen display protocol, WebSockets. Kitchen and online-order screens poll every 5 s.

## 2. System context

<!-- diagram: 01_system_context drawio=Tallyko_System_Architecture -->
```mermaid
flowchart LR
    subgraph People["People"]
        owner(["Owner / manager"])
        staff(["Cashier / waiter"])
        cook(["Kitchen staff"])
        guest(["Shop customer"])
        admin(["Tallyko super admin / support"])
    end

    subgraph Clients["Clients - one Expo app (web, Android, iOS)"]
        pos["POS, tables, orders, menu,<br/>reports, settings, owner's watch"]
        kds["Kitchen display<br/>(same app, kitchen role, polls 5 s)"]
        console["Super admin console<br/>/admin routes"]
        store["Public pages<br/>/store/{tenantId} and ?table={id}"]
    end

    printer[("Bluetooth / USB<br/>thermal printer")]

    subgraph Platform["Tallyko server (Docker Compose)"]
        api["Caddy + FastAPI<br/>/api/v1"]
        data[("PostgreSQL + Redis")]
    end

    subgraph Outside["Outside services"]
        smtp["SMTP provider<br/>(Mailpit in dev)"]
        upi["Customer's UPI app<br/>(deep link, no gateway)"]
        agg["Swiggy / Zomato / ONDC<br/>or a bridge (HMAC webhook)"]
    end

    owner --> pos
    staff --> pos
    cook --> kds
    guest --> store
    admin --> console

    pos -- "ESC/POS, print dialog" --> printer
    pos & kds & console & store -- "HTTPS JSON" --> api
    api --> data
    api -- "queued emails" --> smtp
    store -. "upi://pay link" .-> upi
    agg -- "signed order webhook" --> api
```

*Diagram source: [`01_system_context.mmd`](diagrams/mermaid/01_system_context.mmd) · [SVG](diagrams/rendered/01_system_context.svg) · draw.io: [`Tallyko_System_Architecture.drawio`](diagrams/Tallyko_System_Architecture.drawio)*
<!-- /diagram -->

## 3. Containers and code structure

<!-- diagram: 02_containers drawio=Tallyko_Master_Architecture -->
```mermaid
flowchart TB
    subgraph App["Expo app - Expo SDK 57, RN 0.86, React 19, expo-router, zustand"]
        direction LR
        web["Web / PWA"]
        android["Android APK / AAB"]
        ios["iOS app or<br/>home-screen web app"]
        local[("Device: offline cache<br/>+ outbox of offline bills")]
    end

    caddy["Caddy 2 (prod)<br/>HTTPS, static web build, proxies /api"]

    subgraph API["FastAPI - Python 3.11, uvicorn workers"]
        direction TB
        mw["Middleware: tracing (X-Trace-ID), security headers,<br/>CORS, GZip, error envelope, /health"]
        subgraph Routers["Routers under /api/v1"]
            direction LR
            rbiz["Business: auth, catalog, orders, tables,<br/>kitchen, inventory, crm, reports, admin,<br/>access, offers, email, taxes, sync, ai"]
            rown["Owner and platform:<br/>subscription, owner, platform"]
            rpub["Public: public (menu, QR orders,<br/>payment claim), integrations (webhook)"]
        end
        subgraph Services["Services - business rules"]
            direction LR
            sacc["access, auth_service,<br/>sessions"]
            ssell["order_service, floor_service,<br/>pricing, offers"]
            stax["tax, channel_menu,<br/>menu_history"]
            splat["subscription,<br/>records_admin"]
            sother["email, audit, counters,<br/>menu_ocr (RapidOCR)"]
        end
        subgraph Tasks["In-process background tasks (API lifespan)"]
            direction LR
            ew["Email worker<br/>every 5 s, SKIP LOCKED"]
            sch["Subscription scheduler<br/>01:00 IST + catch-up"]
        end
        mw --> Routers --> Services
    end

    pg[("PostgreSQL 15<br/>tallyko_shared + RLS<br/>role tallyko_app")]
    redis[("Redis 7<br/>tenant cache, rate limits,<br/>revoked sessions, job lock")]
    smtp["SMTP server<br/>(Mailpit :8025 in dev)"]

    web & android & ios --> caddy
    local -. "replay /sync/push" .-> caddy
    caddy --> mw
    Services --> pg
    Services --> redis
    ew --> pg
    ew --> smtp
    sch --> pg
    sch --> redis
```

*Diagram source: [`02_containers.mmd`](diagrams/mermaid/02_containers.mmd) · [SVG](diagrams/rendered/02_containers.svg) · draw.io: [`Tallyko_Master_Architecture.drawio`](diagrams/Tallyko_Master_Architecture.drawio)*
<!-- /diagram -->

### Routers (`backend/app/api`, all under `/api/v1`)

- **Business:** `auth`, `catalog`, `orders`, `tables`, `kitchen`, `inventory`, `crm`, `reports`, `admin` (settings, modules, channels, brands, staff), `access` (`/access/me`, roles, audit), `offers`, `email`, `taxes`, `sync`, `ai` (menu photo OCR).
- **Owner and platform:** `subscription` (owner renewal; works while locked), `owner` (owner-only watch list and requests to Tallyko), `platform` (super admin console).
- **Public and integrations:** `public` (menu, QR/online orders, UPI payment claim), `integrations` (HMAC-signed aggregator webhook).

See [05_API_Design.md](./05_API_Design.md) for the endpoint map.

### Services (`backend/app/services`)

| Area | Services |
|---|---|
| Access and auth | `access` (permissions × plan modules, `require()`), `auth_service`, `sessions` (devices, revocation) |
| Selling | `order_service` (lifecycle), `floor_service` (item kitchen status, cancel/comp, split/merge, several bills per table), `pricing` (GST engine), `offers` (pure offer engine) |
| Tax and menu | `tax` (`TaxResolver`, dated rates), `channel_menu` (per-channel price and availability), `menu_history` (append-only product versions) |
| Platform | `subscription` (demo/paid/complimentary/development, lock, offers, daily check), `records_admin` (super admin archive and hard delete) |
| Other | `email/` (templates, queue, SMTP worker), `audit`, `counters`, `settings_service`, `menu_ocr` (RapidOCR) |

### Background work

There is no queue broker. Both tasks are `asyncio` tasks created in `app/main.py`'s lifespan, so they run inside every uvicorn worker:

- **Email worker** (`EMAIL_WORKER_ENABLED`): every 5 s reads up to 20 `email_logs` rows with status `queued` using `FOR UPDATE SKIP LOCKED`, so several workers never send the same email. See [014](./features/014_Offers_Loyalty_Rewards_And_Email.md).
- **Subscription scheduler** (`JOB_SCHEDULER_ENABLED`): 01:00 IST daily, with a Redis lock so only one worker runs the check, plus a catch-up on start. See [018](./features/018_Subscriptions_Demo_And_Sessions.md).
- **Menu OCR** runs in a thread pool inside the request (≈1 s per photo); photos are not stored.

## 4. Request handling and tenant isolation

Every business request passes the same checks: token → session version and revoked session → subscription lock → `require(permission, module)` → a database session switched to role `tallyko_app` with the tenant id set, so Postgres RLS filters every query. Details and diagrams: [10_Security_And_Auth.md](./10_Security_And_Auth.md) and [03_Multi_Vendor_Architecture.md](./03_Multi_Vendor_Architecture.md).

## 5. Reliability features that exist

- `/health` checks Postgres and Redis; Docker healthchecks and `restart` policies restart a failed container.
- The POS bills offline: an outbox of client-id'd bills replays through `/sync/push` ([07](./07_Offline_Sync_Strategy.md)).
- Rate limiting is per account / per customer phone with high per-IP ceilings, and **fails open** if Redis is down.
- Errors always come back as `{"success": false, "error": {code, message, trace_id}}`; every response has `X-Trace-ID`.
- Forward-only, non-destructive migrations run on backend start ([19](./19_Database_Migrations.md)).
- Tests use their own database (`<db>_test`) and Redis DB 1, with `NullPool` connections.

Scaling out means more uvicorn workers (`WEB_CONCURRENCY`) on one server today. Several API replicas behind a load balancer would work (stateless API, Redis-locked jobs, `SKIP LOCKED` email), but no compose file for that exists.
