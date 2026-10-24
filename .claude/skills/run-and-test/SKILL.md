---
name: run-and-test
description: Start the Tallyko Docker stack, seed demo data, run backend pytest and frontend typecheck/jest, preview the web app, build the Android APK, and read logs. Use when asked to run, start, test, verify, preview, build an APK, or debug the app locally, or after code changes that need checking.
---

# Run and test Tallyko

Everything runs in Docker Compose from the repo root.

## Start / preview
```bash
docker compose up -d --build           # web :8081, API :8000 (/docs), Postgres 127.0.0.1:5433
docker compose up --watch              # live frontend reload (needed on Windows/macOS)
docker compose exec backend python manage.py seed           # demo businesses, staff and platform admins
docker compose --profile preview up -d --build                # production web build via Caddy on :8080
docker compose ps
```
- Migrations run automatically when the backend starts (`alembic upgrade head` in the container CMD).
- Backend reloads on its own (polling). Frontend edits reach the container only via `--watch`.

## Test
```bash
docker compose exec backend python -m pytest -q                       # needs db + cache up
docker compose exec backend python -m pytest -q tests/integration/test_orders.py
cd frontend && npx tsc --noEmit -p . && npx jest                       # typecheck + unit tests (print/barcode libs)
```
Integration tests use the real Postgres/Redis; each test registers its own business (`fresh_tenant`).

## Browser check
Open http://localhost:8081 in the browser pane, sign in (seed or sign up), and check phone (≈390×844) and desktop (1280×800) sizes in light and dark mode.

## Android build
```bash
docker compose --profile android run --rm android-build                # dist/tallyko-<v>.apk + .aab
docker compose --profile android run --rm android-build backup-keystore
```
First build downloads Gradle deps (~20+ min). The signing key lives in the `android_keystore` volume — back it up.

## Logs
```bash
docker compose logs -f backend
docker compose logs web --tail 50
```
Follow a request by the `X-Trace-ID` response header.

## Report
Say exactly which commands ran and their results. If Docker isn't available or a step was skipped, say so.
