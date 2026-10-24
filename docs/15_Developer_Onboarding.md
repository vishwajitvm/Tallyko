# 15. Developer Onboarding & Local Setup

Everything runs in Docker — you only need **Docker Desktop** (Windows/macOS) or Docker Engine (Linux) and Git.

## 1. Start the stack

```bash
docker compose up -d --build                         # first run takes a few minutes
docker compose exec backend python manage.py seed    # demo data (refuses to run in production)
```

| Service | Where | Notes |
|---|---|---|
| Web app | http://localhost:8081 | Expo dev server (web) |
| API + Swagger | http://localhost:8000/docs | runs `manage.py migrate` on start and `watch` in the background |
| Mailpit (dev inbox) | http://localhost:8025 | every email the app sends in development lands here |
| PostgreSQL | `127.0.0.1:5433` (user `postgres`, db `tallyko_shared`) | bound to localhost only |
| Production preview | `docker compose --profile preview up -d --build` → http://localhost:8080 | Caddy + static build, same as a real server |

How the pieces fit: [18_deployment diagram](./diagrams/mermaid/18_deployment.mmd), [02_System_Architecture.md](./02_System_Architecture.md).

## 2. Demo logins

The sign-in screen has a demo dropdown in development. Every demo account uses the password **`Demo@1234`**.

| Account | What it is |
|---|---|
| `owner.dhaba@example.com` | Restaurant owner (tables, kitchen, QR ordering) |
| `owner.store@example.com` | Retail shop owner (barcodes, stock) |
| `owner.cloud@example.com` | Cloud kitchen owner (brands, Swiggy/Zomato prices); staff `cloud.manager@`, `cloud.kitchen@` |
| `owner.expired@example.com` | Café whose subscription ended (locked, 402); staff `cashier.expired@` |
| `manager1@`, `manager2@`, `cashier1@`, `cashier2@`, `waiter1@`, `waiter2@`, `kitchen1@`, `kitchen2@` | Restaurant staff for role testing |
| `superadmin@`, `superadmin2@` | Tallyko super admins (console at `/admin`) |
| `support@`, `support2@` | Read-only platform support |

All addresses end in `@example.com`. Demo businesses run on development access (no expiry), except the locked café.

## 3. Everyday commands

```bash
docker compose ps                                     # status of every container
docker compose logs -f backend                        # API logs (tracenest JSON)
docker compose exec backend python manage.py status   # migrations applied / pending
docker compose exec backend python manage.py make:migration "add notes to tables" --table tables
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py fresh --seed   # wipe the dev DB and start again
docker compose exec backend python -m pytest -q       # backend tests
docker compose down                                   # stop (data volumes are kept)
```

`./scripts/db.sh <command>` (Windows: `.\scripts\db.ps1`) is a shortcut for `manage.py`. All commands: [19_Database_Migrations.md](./19_Database_Migrations.md).

**Tests never touch your dev data:** pytest creates and uses `<db>_test` (e.g. `tallyko_shared_test`) and Redis DB 1. Fixtures (`client`, `tenant_a`, `tenant_b`, `fresh_tenant`, `create_staff`, `create_product`, `random_client_ip`) are in `backend/tests/conftest.py`.

## 4. Live reload

- **Backend:** edits under `backend/` reload automatically (`uvicorn --reload` with polling, so it works on Windows bind mounts). New migration files apply on save (`manage.py watch`).
- **Frontend:** run `docker compose up --watch` (or `docker compose watch` next to a running stack). Docker can't forward file-change events from a Windows/macOS folder into a Linux container, so Compose Watch copies your edits in and Metro hot-reloads them. Changing `package.json` rebuilds the image.
- Frontend checks: `cd frontend && npx tsc --noEmit && npx jest` (Node 22).

## 5. Phones and tablets

- **Quickest:** open `http://<your-PC-LAN-IP>:8081` in the phone's browser (same Wi-Fi). Bluetooth printing isn't available in a browser on iOS.
- **Installable Android app:** set `APK_API_URL=http://<your-PC-LAN-IP>:8000/api/v1` in `.env` (or change the server on the sign-in screen), then `docker compose --profile android run --rm android-build` → `dist/tallyko-<version>.apk`. The first build downloads Gradle dependencies (~20 min).
- **Expo Go** works for UI work but has no Bluetooth printer support (native modules) — use the APK for printing.

## 6. Logs and tracing

Every API response carries an `X-Trace-ID` header; search for it in `docker compose logs backend` or `backend/TraceNestLogs/app.log` to follow one request ([09](./09_Logging_And_Observability.md)).

## 7. Before you change code

- Read [CLAUDE.md](../CLAUDE.md) (hard rules and repository map) and the relevant feature spec.
- Tenant isolation rules: [03](./03_Multi_Vendor_Architecture.md), [10](./10_Security_And_Auth.md).
- UI rules: [20_High_Volume_UX.md](./20_High_Volume_UX.md).
- When behaviour changes, update the spec and, if needed, the `.mmd` diagram in [diagrams/](./diagrams/README.md).
