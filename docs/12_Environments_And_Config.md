# Environments & Configuration

## 1. Environments

| Environment | How it runs | Data |
|---|---|---|
| **Development** | `docker compose up -d --build` (`docker-compose.yml`) | `tallyko_shared` on `127.0.0.1:5433`, seed with `manage.py seed`, email to Mailpit |
| **Tests** | `docker compose exec backend python -m pytest -q`, or CI | Separate database `<db>_test` and Redis DB 1 — never the dev data |
| **Preview** | `docker compose --profile preview up -d --build` (:8080) | Production web build against the dev API |
| **Production** | `docker compose -f docker-compose.prod.yml up -d --build` | `POSTGRES_DB` (default `tallyko`), real SMTP, HTTPS |

There is no separate staging deployment today; a staging server would be a second production compose with its own `.env`.

Code checks `ENVIRONMENT` only where behaviour must differ: production refuses insecure secrets, hides `/docs` and the tracenest UI, tightens the per-account login limit, and refuses `refresh`, `fresh` and demo seeders.

## 2. Variables

### Root `.env` (production compose; copy from `.env.example`, `scripts/setup.*` fills secrets)

| Variable | Meaning |
|---|---|
| `DOMAIN` | Caddy site address, e.g. `pos.example.com` (`:80` for plain HTTP on a shop LAN) |
| `ACME_EMAIL` | Let's Encrypt contact |
| `JWT_SECRET` | ≥32 random characters (required) |
| `POSTGRES_PASSWORD`, `POSTGRES_USER`, `POSTGRES_DB` | Database credentials |
| `CORS_ORIGINS`, `TIMEZONE` (`Asia/Kolkata`), `WEB_CONCURRENCY` (2) | API behaviour |
| `APK_API_URL`, `APP_VERSION_CODE` | Default server URL and version code baked into Android builds |

### Backend settings (`backend/app/core/config.py`)

`ENVIRONMENT`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `ACCESS_TOKEN_EXPIRE_MINUTES` (720), `REFRESH_TOKEN_EXPIRE_DAYS` (30), `CORS_ORIGINS`, `TRUST_PROXY`, `TIMEZONE`, `MAX_UPLOAD_MB`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_STARTTLS`, `SMTP_SSL`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `EMAIL_WORKER_ENABLED`, `JOB_SCHEDULER_ENABLED`, `PUBLIC_APP_URL`, `LOG_DIR`.

- Development defaults come from `docker-compose.yml` (`SMTP_HOST=mailpit`, port 1025).
- Production: the prod compose sets database, Redis, JWT, CORS, timezone, workers, `SMTP_*` and `PUBLIC_APP_URL` (default `https://$DOMAIN`) from `.env`. Without `SMTP_HOST`, emails are logged as `skipped`.
- There is no MinIO or object-storage configuration: nothing is stored as files.

Secrets live only in `.env` files (git-ignored). Platform settings that change at runtime (demo length, grace days, UPI/bank details for renewals) are stored in the `platform_settings` table and edited in the super admin console.

## 3. Migrations across environments

All schema changes go through `manage.py` (Alembic underneath), one migration per table ([19](./19_Database_Migrations.md)):

1. Every database change has a migration; no manual SQL in production.
2. The backend runs `manage.py migrate` on start (dev also runs `watch`).
3. Within a release, migrations are non-destructive: new columns are nullable or have defaults, and drops wait for a later release, so the previous app version keeps working.
4. Dedicated tenant databases would need the same migrations run against each `db_url`; that loop is not built yet.
