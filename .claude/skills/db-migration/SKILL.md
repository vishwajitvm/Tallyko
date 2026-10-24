---
name: db-migration
description: Create, review, apply or roll back a Tallyko database migration, or add a seeder. Use whenever a SQLAlchemy model in backend/app/models/ changes, when adding a table or column, when the user asks about migrations, schema changes, seeding or rollback.
---

# Tallyko database migrations

Everything goes through `backend/manage.py` (Laravel-artisan style) inside the backend container. Full reference: `docs/19_Database_Migrations.md`.

```bash
docker compose exec backend python manage.py status                 # applied / pending
docker compose exec backend python manage.py migrate                # apply pending (also runs on container start)
docker compose exec backend python manage.py rollback [--steps N | --to 0040]
docker compose exec backend python manage.py make:migration "add notes to tables" --table tables
docker compose exec backend python manage.py db:sync                # dev: autogenerate from models + apply
docker compose exec backend python manage.py db:check               # CI: models == migrations
docker compose exec backend python manage.py refresh --seed         # dev: roll all back, migrate, seed
docker compose exec backend python manage.py fresh --seed           # dev: drop everything, migrate, seed
docker compose exec backend python manage.py seed [names…] [--list]
docker compose exec backend python manage.py create:superadmin you@company.com   # first platform admin (prod too)
```

## Rules

- **One migration per table.** A new table gets its own `NNNN_create_<table>.py`; a change to an existing table gets its own `NNNN_<verb>_<what>_<table>.py`. Use `--table <name>` so autogenerate only includes that table.
- Revision ids are **sequential 4-digit numbers** (`env.py` assigns them); never hand-pick or reuse one.
- **Forward-only and non-destructive in a release:** the previous app version must still run on the new schema. New columns on existing tables are nullable or have a `server_default`. Drop columns/tables only in a later release after the code stopped using them.
- Never edit a migration that's already applied anywhere but your laptop. In dev, edit and run `refresh --seed`.
- Models live in `backend/app/models/<area>.py` and are re-exported from `app/models/__init__.py`. Import as `from app.models import X`.

## Tenant tables and RLS

- Tenant tables use `tenant_id_column()` and `__table_args__ = TENANT_RLS` (or the `TenantScoped` mixin) from `app/models/base.py`. Child tables without `tenant_id` use `child_rls("fk_column", "parent_table")`.
- `alembic/env.py` sees that `info` and **adds the GRANT + RLS policy to the generated migration automatically** (`app/db/rls.py`). Check it's there when you review the file.
- Without the GRANT, every tenant request touching the table fails with "permission denied". Don't `FORCE` RLS: system sessions rely on the owner bypass.
- Add any new tenant-protected route to `PROTECTED_ROUTES` in `tests/integration/test_tenant_isolation.py`.

## Review checklist for a generated file

1. `revision`/`down_revision` chain onto the current head (`manage.py status` shows a single head).
2. Autogenerate misses data backfills and some server defaults: add them.
3. `downgrade()` reverses the change.
4. Constraint names come from `NAMING_CONVENTION` (named constraints keep downgrades working).
5. Run `manage.py migrate`, `manage.py rollback`, `manage.py migrate` again, then the test suite (`run-and-test` skill).

## Seeders

- Seeders live in `backend/app/db/seeders/`: one class per file subclassing `Seeder` (`name`, `description`, `depends_on`, `async run() -> str`), registered in `SEEDERS` in `__init__.py`. They must be idempotent: re-running updates instead of duplicating.
- Demo seeders refuse to run in production; set `allow_in_production = True` only for reference data (plans, GST slabs).
- Demo logins share `DEMO_PASSWORD` in `demo_data.py`; keep `frontend/src/features/auth/demoAccounts.ts` in sync.

Dedicated tenant DBs need the same migrations; the per-tenant migration loop is not built yet. Mention this if the change matters for dedicated tenants.
