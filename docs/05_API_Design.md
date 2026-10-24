# API Design & Contract Strategy

## 1. Basics

- REST + JSON under `/api/v1`, served by FastAPI. Interactive docs at `/docs` (disabled in production).
- Business auth: `Authorization: Bearer <access token>` (PyJWT, 12 h) + refresh token (30 days) via `POST /auth/refresh`. Access tokens carry `sub` (login), `tenant_id`, `role`, `staff_id`, `type`, `sid` (device session) and `sv` (business session version). Platform tokens carry `platform_role` and no tenant.
- Every response has an `X-Trace-ID` header for log correlation. Paged lists also send `X-Total-Count`.
- How a request is checked (401 signed out, 402 subscription locked, 403 role/module) is described in [10_Security_And_Auth.md](./10_Security_And_Auth.md).

## 2. Response shapes

Successful responses are plain JSON resources (an object, a list, or `{items, total}` for paged lists).

Errors always use one envelope:

```json
{ "success": false, "error": { "code": "HTTP_ERROR", "message": "Table 5 already has a running order", "trace_id": "…" } }
```

Validation errors use `code: "VALIDATION_ERROR"`, a readable `message` (`"field: reason"`) and `details` with the full Pydantic error list. Messages are written for shopkeepers, not developers.

| Status | Meaning for the app |
|---|---|
| 401 | Token expired or this device was signed out → refresh once, else sign in again |
| 402 | The business's subscription ended → renewal screen; the offline outbox is kept |
| 403 | Role or plan module doesn't allow it, platform token on a business route, or business suspended |
| 409 | State conflict (bill already paid, items can't change after a payment…) |
| 429 | Rate limited |

## 3. Versioning

Breaking changes go to a new path version (`/api/v2/…`); existing `/api/v1` shapes are only extended. Mobile apps update slowly, so old shapes stay for at least 180 days. Migrations are forward-only so old app versions keep working while a new server rolls out.

## 4. Resource map

| Router | Endpoints |
|---|---|
| `auth` | `POST /auth/register`, `/auth/login` (email or phone), `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `POST /auth/change-password`, `/auth/delete-account`, `GET /auth/sessions`, `DELETE /auth/sessions/{id}` |
| `catalog` | `/catalog/categories` (CRUD; delete = switch off), `/catalog/products` (CRUD, search; delete = switch off), `/catalog/products/by-barcode/{code}`, `POST /catalog/products/{id}/barcode`, `POST /catalog/products/bulk` (bulk edit), `POST /catalog/bulk-import`, `GET /catalog/products/{id}/history`, `POST /catalog/products/{id}/history/{version}/restore` |
| `orders` | `GET/POST /orders`, `GET /orders/{id}`, `POST /orders/{id}/items`, `DELETE /orders/{id}/items/{item}`, `POST /orders/{id}/pay`, `GET /orders/{id}/offers`, `POST /orders/{id}/offer`, `/accept`, `/reject`, `/cancel`, `/transfer`, `PUT /orders/{id}/customer`, `PUT /orders/{id}/details` |
| `orders` (floor) | `POST /orders/{id}/items/status`, `/items/void`, `/items/comp`, `/items/move`, `/merge`, `/payment-claim/confirm`, `/payment-claim/reject` |
| `tables` | `GET/POST /tables` (with `open_bills` per table), `PUT/DELETE /tables/{id}` (delete = switch off) |
| `kitchen` | `GET /kitchen/tickets` (used by the app), `PUT /kitchen/tickets/{id}/status`; older `GET /kitchen/kds/orders`, `PUT /kitchen/kds/orders/{kot_id}/status` |
| `inventory` | `GET /inventory`, `/inventory/low-stock`, `/inventory/logs`, `POST /inventory/adjust`, `/inventory/receive` |
| `crm` | `/crm/customers` (list/search, create, update, detail with history), `/crm/customers/lookup?phone=` |
| `reports` | `/reports/summary` (incl. `by_channel`), `/reports/items`, `/reports/staff`, `/reports/me`, `/reports/wastage` (`date_from`/`date_to` ISO with offset) |
| `admin` | `GET/PUT /settings`, `GET/PUT /modules` (owner hides modules), `/channels` (+ `/{code}/menu`, `/{code}/rotate-secret`), `/brands`, `/staff` |
| `access` | `GET /access/me`, `/access/permissions`, `/roles` (CRUD, `/{key}/reset`), `GET /audit` |
| `offers` | `GET/POST /offers`, `PUT /offers/{id}`, `PUT /offers/{id}/active`, `POST /offers/evaluate`, `POST /offers/{id}/announce` |
| `email` | `GET /email/status`, `/email/templates` (`PUT`, `DELETE` = reset, `/preview`, `/test`), `GET /email/logs` |
| `taxes` | `GET/POST /taxes`, `PUT /taxes/{id}`, `POST /taxes/{id}/rates`, `DELETE /taxes/{id}/rates/{rate_id}` (upcoming only), `POST /taxes/assign`, `GET /taxes/presets` |
| `sync` | `POST /sync/pull`, `POST /sync/push` ([07](./07_Offline_Sync_Strategy.md)) |
| `ai` | `POST /ai/menu/extract` (menu photos → items), legacy `POST /ai/upload-menu` |
| `subscription` (owner, works while locked) | `GET /subscription`, `POST /subscription/quote`, `POST /subscription/requests` ("I've paid" claim) |
| `owner` (owner only) | `GET /owner/watch`, `/owner/watch/events`, `GET/POST /owner/requests` |
| `platform` (super admin; writes need `super_admin`) | `/platform/me`, `/overview`, `/businesses[/{id}]` (+ `reset-owner-password`, `subscriptions`, `quote`, `demo`, `development`, `sessions`, `sign-out`, `orders`, `orders/archive`, `orders/unarchive`, `orders/delete`), `/plans`, `/subscription-offers`, `/subscription-requests/{id}/approve\|reject`, `/sessions/{id}/revoke`, `/settings`, `/jobs`, `/jobs/subscription-check`, `/owner-requests/{id}/resolve`, `/tax/presets[/{key}/rates]`, `/audit` |
| `public` (no login) | `GET /public/{tenant}/menu?channel=QR\|ONLINE`, `GET /public/{tenant}/tables/{table}`, `POST /public/{tenant}/orders`, `POST /public/{tenant}/orders/{order}/payment-claim`, `GET /public/{tenant}/orders/{order}` |
| `integrations` | `POST /integrations/{channel}/orders/{tenant}` (HMAC-signed aggregator webhook) |
| — | `GET /health` (database + Redis), outside `/api/v1` |

## 5. Rules the API enforces

- Prices and totals are computed on the server from the catalog (channel price, GST class at that time, offers, discounts, rounding). Clients send ids and quantities only. See the [pricing pipeline](./diagrams/mermaid/05_pricing_pipeline.mmd).
- Order `id` and `(tenant, channel, external_order_id)` are idempotency keys; "add to my bill" from a QR page uses a Redis key per request id.
- Every business route uses `require("permission", feature="module")`; tenant comes from the token, Postgres RLS underneath. Platform tokens get 403 on business routes and business tokens get 403 on `/platform`.
- Rate limits (Redis, fail open) assume a whole shop shares one public IP: login 60/min per IP and 20 per 15 min per account; refresh 300/min per IP; sign-up 5/5 min; public menu 600/min per IP; public orders 10/5 min per customer phone and 300/5 min per IP; payment claims 10/5 min; OCR 5/min; webhooks 120/min per business.
