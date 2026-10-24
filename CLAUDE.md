# CLAUDE.md — Tallyko project memory

Loaded automatically by Claude Code. Keep it short, current and true. Update **Current state** and **Known gaps** when you change what they describe.

## What Tallyko is

A multi-tenant SaaS **point of sale** for Indian restaurants, cafés, cloud kitchens and retail shops (GST, UPI, Swiggy/Zomato).
Shopkeepers use it from a **laptop/desktop browser (PWA)**, **Android tablets/phones (APK / Play Store)** and **iPhone/iPad (App Store or home-screen web app)** — one Expo codebase.
Positioned against Shopto: trustworthy pricing, offline billing, no outages after updates, true multi-tenancy, easy UX.
Docs in `docs/` hold product intent (`docs/README.md` is the index); `docs/18_App_Store_And_Play_Compliance.md` tracks store rules.

## Hard rules

- **Everything runs in Docker Compose** (dev, preview, Android builds, production). No "install locally" instructions for services.
- **Free & open source only** — no paid APIs/trials (OCR = RapidOCR, TLS = Caddy/Let's Encrypt, builds = local Docker).
- **Nothing is deleted by a business.** Cancel/remove = status; menu/categories/tables = `is_active`. The `tallyko_app` DB role has no
  DELETE on bills/payments/KOTs/customers/products/stock/tables and can't edit `audit_logs`/`product_versions` (migration 0059).
  Only the super admin archives or deletes (`services/records_admin.py`, system session, platform-audited).
- **GST only with a valid GSTIN** (`app/core/gstin.py`, `TaxResolver.charges_tax`); otherwise a Bill of Supply.
- **Tenant isolation:** every tenant query filters `tenant_id`; Postgres RLS is the backstop (see below). Never weaken it.
- **Server prices everything.** Clients send product/variant ids and quantities, never prices or totals.
- **Order ids are client-generated idempotency keys** — offline bills replay through `/sync/push` without duplicates.
- **Logging via `logging.getLogger("tallyko")`** (tracenest JSON), prefix `[Domain]`, `extra={"tenant_id": ...}`. No `print()` in app code.
- **Migrations go through `manage.py`**, one migration per table, forward-only and non-destructive within a release (`db-migration` skill, `docs/19_*`).
- **Never commit or push** unless the user asks. Don't edit generated `frontend/android`/`frontend/ios` (Expo CNG).
- **Store compliance:** keep in-app account deletion, privacy policy links, purpose strings, `blockedPermissions` and target SDK in step with `docs/18_*`.

## Repository map

```
backend/  FastAPI (Python 3.11)
  app/main.py            app, tracing + security headers middleware, error envelope, /health (DB+Redis)
  app/core/config.py     env settings; refuses to start in production with default JWT secret / DB password
  app/core/security.py   bcrypt, PyJWT access/refresh (typed, staff_id), get_current_user (business), get_platform_user / require_super_admin
  app/core/catalog.py    PERMISSIONS, SYSTEM_ROLES, FEATURES (plan modules), DEFAULT_PLANS, GST presets & default tax classes
  app/core/tenant.py     get_tenant_db / get_public_tenant_db (RLS role + tenant setting per transaction), shared/dedicated routing, suspended/deleted tenants blocked
  app/core/rate_limit.py Redis sliding window; fails open; trusts X-Forwarded-For only if TRUST_PROXY
  app/models/<area>.py   accounts, business, catalog, sales, inventory, access (roles, audit), marketing (offers, email), platform (plans), tax;
                         base.py = naming convention + TENANT_RLS/child_rls markers; import via `from app.models import X`
  app/services/          access.py (require(), entitlements, cache), pricing.py (GST engine), tax.py (TaxResolver, dated rates),
                         offers.py (pure offer engine), order_service.py (order lifecycle), floor_service.py (item kitchen status,
                         cancel/comp, split/merge, several bills per table), channel_menu.py (per-channel price & availability),
                         menu_history.py (append-only product versions), records_admin.py (super admin archive/delete),
                         subscription.py (demo/paid/development periods, lock, offers, daily 01:00 IST check), sessions.py (devices),
                         email/ (templates, queue + SMTP worker),
                         audit.py, counters.py, settings_service.py, auth_service.py, menu_ocr.py
  app/api/               auth, catalog, orders, tables, kitchen, inventory, crm, reports (+ /reports/staff), admin (settings/modules/channels/brands/staff),
                         access (/access/me, roles, audit), offers, email, taxes, subscription (owner renewal; works while locked),
                         owner (owner-only watch list + requests to Tallyko), platform (super admin), sync, public, integrations, ai
  app/db/                cli.py (manage.py commands), rls.py (role/GRANT/policy SQL), seeders/ (idempotent; demo ones refuse production),
                         erd_drawio.py (regenerates docs/diagrams/Tallyko_Database_ERD.drawio from the models; rerun after schema changes)
  manage.py              migrate | rollback | status | make:migration | db:sync | db:check | refresh | fresh | seed | watch |
                         subscriptions:check | create:superadmin
  alembic/versions/      0001…0062, one per table; env.py assigns sequential ids and adds RLS for TENANT_RLS models
  tests/                 unit (pricing, OCR parser) + integration (real Postgres/Redis): auth, catalog, orders, offers, taxes/email, access/platform,
                         kitchen, sync, public/integrations, tenant isolation, AI
frontend/ Expo SDK 57 · RN 0.86 · React 19 · TS strict · expo-router
  src/app/               routes: (auth)/login|signup, (app)/pos|orders|tables|online|kitchen|menu/*|inventory|customers|reports|settings/*|more,
                         store/[tenantId] (public ordering), privacy, delete-account
  src/features/<area>/   screen components and local state per area (pos, ops, catalog, settings, customers, reports, public)
  src/components/ui/     design system (Text, Button variants, Input, Card, Badge, Chip, Segmented, Sheet, toast(+undo), confirm/prompt,
                         Screen) + high-volume blocks: ActionMenu, SelectionBar, DataList, FilterBar, StatusPill, Checkbox, Skeleton
  src/components/nav/    AppNav: collapsible sidebar (desktop), rail (tablet), bottom bar + More (phone); g+key shortcuts; gated by
                         role, plan modules, permissions; owner-only items
  src/theme/             tokens (teal brand, slate neutrals, light/dark), ThemeProvider (useTheme, useLayout)
  src/api/               client (timeouts, refresh-on-401, ApiError.network), typed endpoints, types
  src/store/             auth (SecureStore), access (/access/me), subscription (lock), prefs, data (offline cache incl. tax classes),
                         outbox (offline bills, kept on 401/402), badges
  src/hooks/             useApi, usePagedList (server paging), useHotkeys, live (polling that pauses when hidden, device prefs)
  src/lib/               billing.ts (price preview mirrors backend, receipt/KOT mapping, printBill), sync.ts, format.ts, storage.ts,
                         print/ (ESC/POS, receipt layouts, printers: BT Classic/BLE/Web Bluetooth/print dialog), barcode/ (Code128, EAN-13, QR)
  public/                index.html (PWA meta), manifest.json, sw.js (app-shell cache, never caches /api), icons
  app.json               store-compliance config (permissions, blockedPermissions, purpose strings, privacy manifest, targetSdk 36)
  Dockerfile             dev (Expo web) / build / prod (Caddy + static web, proxies /api)
  android.Dockerfile + android-build.sh   signed APK + AAB, keystore in a Docker volume, 16 KB alignment check
  eas.json               optional EAS cloud builds (iOS needs Apple account)
docker-compose.yml       dev: db, cache, mailpit (:8025), backend (reload + migrate watch), web (Compose Watch); profiles: preview (:8080), android
docker-compose.prod.yml  production: db, cache, backend (non-root, healthcheck, auto-migrate), web (Caddy HTTPS)
scripts/                 setup (random secrets), dev, db (manage.py wrapper), migrate, backup_db / restore_db
legacy/                  previous implementation, kept only for reference — safe to delete
```

## Running things

```bash
docker compose up -d --build            # web :8081, API :8000 (/docs), Postgres on 127.0.0.1:5433
docker compose up --watch               # live frontend reload on Windows/macOS (bind-mount events don't reach Linux)
docker compose exec backend python manage.py seed        # demo data; every demo login uses Demo@1234
docker compose exec backend python manage.py status      # migrations (see db-migration skill for the rest)
docker compose exec backend python -m pytest -q          # uses its own DB (<db>_test) + Redis DB 1, never the dev data
docker compose exec backend python manage.py fresh --seed --force   # dev only: rebuild the dev DB with demo data
# Mailpit (dev email inbox): http://localhost:8025
cd frontend && npx tsc --noEmit && npx jest
docker compose --profile preview up -d --build                  # production web build on :8080
docker compose --profile android run --rm android-build         # dist/tallyko-<v>.apk + .aab
docker compose -f docker-compose.prod.yml up -d --build         # production (needs .env)
```

## Conventions

**Tenant isolation (read before touching any route)**
- Authenticated routes: `access: Access = Depends(require("perm.code", feature="module"))` + `db=Depends(get_tenant_db)`; `tenant_id = access.tenant_id`. Use `access.can(...)` / `access.has(...)` for finer checks. New permissions/modules go in `app/core/catalog.py` (+ `PERMISSION_FEATURE`). `RoleChecker` is legacy.
- Platform (super admin) routes use `get_platform_user` / `require_super_admin` and system sessions; platform tokens get 403 on business routes.
- `get_current_user` also enforces sessions (token `sid` revoked → 401; business `sv` bumped → 401) and the subscription lock (402).
  Routes a locked business must still reach use `get_current_user_allow_lapsed` (renewal, profile, logout, account deletion).
  After changing a tenant's status, paid-until or session version call `drop_tenant_cache(tenant_id)`.
- Record sensitive actions with `audit.record(db, access, "area.action", ...)`; call `invalidate(tenant_id)` after role/module/plan changes.
- Public routes use `db=Depends(get_public_tenant_db)` with a `tenant_id: UUID` path param and expose only public fields.
- `get_tenant_db` switches each transaction to role `tallyko_app` and sets `app.current_tenant_id`; RLS filters every query. RLS is not FORCEd: system sessions (`get_shared_session_maker()`) bypass it and are only for auth/routing/staff management.
- FK checks bypass RLS: verify any id from the request (product, category, brand, table, customer, order) belongs to the tenant before using it.
- New tenant tables: mark the model with `TENANT_RLS` (or `child_rls`) and the generated migration gets the GRANT + policy (see `db-migration` skill). Add new protected routes to `PROTECTED_ROUTES` in `tests/integration/test_tenant_isolation.py`.

**Backend**
- Routers stay thin; business rules live in `app/services/`. Money is `Decimal` in services, `float` in JSON. Responses are plain JSON objects; errors use `{"success": false, "error": {code, message, trace_id}}` (main.py handlers).
- Validate input with Pydantic `Field` constraints; raise `HTTPException` with a message a shopkeeper understands.
- Prices on a channel: always `channel_menu.unit_price(...)` / `available_on(...)`. Bills: void lines stay on the order but are excluded
  everywhere (`order_service.billable`, reports filter `kitchen_status != 'void'`).
- Tax: never read `products.tax_rate` directly; use `TaxResolver` and store the line snapshot. Offers: evaluate with `services/offers.py`, never trust client discounts.
- Rate limits must assume a whole shop shares one public IP (many tills, tablets, customers on Wi-Fi): limit per account /
  per customer phone, keep per-IP ceilings high.
- Tests: `@pytest.mark.asyncio` + fixtures `client`, `tenant_a`, `tenant_b`, `fresh_tenant`, helpers `create_staff`, `create_product`, `random_client_ip` in `tests/conftest.py`.

**Frontend**
- **Every screen follows `docs/20_High_Volume_UX.md`** (thousands of customers a day): one-tap frequent actions, anchored
  `ActionMenu` instead of centred modals, `SelectionBar` for bulk actions, virtualised `DataList` + server paging for long lists,
  `FilterBar`, `useHotkeys` on desktop, `StatusPill` colours, Button variants (`success` = pay, `kitchen` = KOT). Check the §6 sizes.
- Use `src/components/ui` + `useTheme().colors` — no hex colours in screens. `useLayout()` for phone vs tablet/desktop layouts. Touch targets ≥44.
- Read business data from `useData` (offline cache) for selling; call the API for management screens. Every list: loading / empty / error states; every action: disable while busy, `toast.error(errorMessage(e))`.
- Check the SDK 57 docs before using an Expo API (APIs change every SDK): https://docs.expo.dev/versions/v57.0.0/
- Feature screens live in `src/features/<area>/`; shared files (`ui`, `api`, `store`, `lib`, `theme`, layouts) change only deliberately.

**Process**: version in `VERSION` + `changelog/vX.Y.Z.md` + `CHANGELOG.md` + `app.json` `expo.version`. When behaviour diverges from a spec in `docs/`, update the spec in the same change.

## Current state (2026-10-25, v2.0.0)

Backend complete for: auth (business + platform logins, refresh, change password, delete account), catalog (variants, tax classes, barcodes, bulk import), orders (GST engine with dated tax classes + Bill of Supply, open tables, KOTs, split/cash-change payments, discounts, offers & loyalty rewards, waiter attribution, invoices FY-wise, stock deduction, cancel/void with reversal), roles & permissions with plan modules, audit log, offers, customer email (queue + SMTP worker), taxes, super admin platform API, subscriptions (free demo, paid, complimentary, development access; 402 lock; renewal claims; subscription
offers; daily 01:00 IST sign-out of lapsed businesses), signed-in devices, running bills (item kitchen status, cancel/comp, split/merge,
several bills per table), per-channel menu prices (Swiggy/Zomato/…), owner-only watch list (cancellations, removals, comps,
discounts, menu changes by staff), menu versions with restore and bulk menu edits, GST only with a valid GSTIN, table QR ordering
(own bill per guest, pay at counter or UPI claim), server-paged lists with counts (orders, customers, businesses, requests), aggregator channels + webhook, brands, kitchen, inventory, CRM, reports (incl. staff performance), public menu + QR/online ordering, offline sync, menu-photo OCR. 180 backend tests pass; frontend 310 jest tests, tsc clean.
Demo logins (dev dropdown, password `Demo@1234`): restaurant, retail, cloud kitchen (Swiggy/Zomato prices) and a locked café owner;
managers, cashiers, waiters, kitchen; 2 super admins, 2 support. Demo businesses run on development access.
Frontend rebuilt on Expo SDK 57 and redesigned to `docs/20_High_Volume_UX.md` (checked at 390/820/1180/1366/1920 widths).
Docs: `docs/diagrams/` holds Mermaid (`mermaid/*.mmd`, rendered SVGs) and draw.io diagrams of the current system.

## Known gaps (verify before relying on these; remove when fixed)

1. Aggregator auto-ingest needs Swiggy/Zomato partner approval; manual entry + signed webhook are what exists.
2. OCR reads Latin script only (no Hindi/Devanagari); handwritten boards are poor.
3. Native Bluetooth printing is untested on physical printers in this environment (unit-tested byte output only). `react-native-bluetooth-classic` is an RC on the RN legacy-module interop layer.
4. Session revocation of a single device is checked in Redis (fails open if Redis is down); whole-business sign-outs use the session version and always apply.
5. Dedicated-DB tenants: no provisioning or per-tenant migration loop yet.
6. `backend/TraceNestLogs/*.log` are still tracked by git from before (now ignored) — `git rm --cached` them when committing.
7. Paid SaaS plans on iOS would need an In-App Purchase decision (App Store 3.1); plan payments are recorded manually in the super admin console.
8. Subscription payments are claimed and approved by hand (no payment gateway by design).
9. Offers are evaluated online only; bills made offline sync without an offer. Public store ordering doesn't accept coupon codes yet.
10. Email delivery needs an SMTP account in production (`SMTP_*` in `.env`); without it emails are logged as `skipped`.
11. Plan limits: only `max_staff` is enforced; `max_products` / `max_locations` are stored (plans, overrides) but not checked.

## Project skills and agents

Reusable workflows in `.claude/skills/` and subagents in `.claude/agents/` — see `.claude/README.md`.
