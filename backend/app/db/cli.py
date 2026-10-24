"""Database management commands (Laravel-artisan style), used by backend/manage.py.

    python manage.py migrate                     apply all pending migrations
    python manage.py migrate --to 0012           migrate up/down to a specific revision
    python manage.py rollback [--steps N]        undo the last N migrations (default 1)
    python manage.py rollback --to 0010          roll back to a revision
    python manage.py status                      applied / pending migrations
    python manage.py make:migration "add x to y" autogenerate a migration from model changes (next id: 0022, …)
    python manage.py make:migration "x" --table offers   only changes to one table (one migration per table)
    python manage.py make:migration "x" --empty  blank migration to write by hand
    python manage.py db:sync                     dev: autogenerate from model changes and apply it
    python manage.py db:check                    fail if models and migrations differ (CI)
    python manage.py refresh [--seed]            dev: roll everything back and migrate again
    python manage.py fresh [--seed]              dev: drop every table and migrate from scratch
    python manage.py seed [names…] [--list]      run seeders
    python manage.py watch                       dev: apply new migration files as soon as they appear
    python manage.py subscriptions:check         run the daily subscription check now (signs out lapsed businesses)
    python manage.py create:superadmin EMAIL     create a Tallyko platform admin (works in production)
        [--name "…"] [--role super_admin|support] [--password …]   (prompts, or prints a generated one)
"""
import argparse
import asyncio
import io
import re
import sys
import time
from contextlib import redirect_stdout
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parents[2]
VERSIONS_DIR = BACKEND_DIR / "alembic" / "versions"
# Revisions of the pre-2.0 migration chain (archived in legacy/backend-v1/alembic_versions)
LEGACY_REVISIONS = {"init_schema", "78c71023fc4a", "654de95c33a5", "12c381b2427e", "8ca20393f65a", "b7e4d1a9c2f3", "d49072a9493a"}

class CommandError(Exception):
    pass

# --- plumbing ------------------------------------------------------------------------------------------

def alembic_config() -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return config

def script_directory() -> ScriptDirectory:
    return ScriptDirectory.from_config(alembic_config())

async def _scalar(sql: str):
    engine = create_async_engine(settings.DATABASE_URL)
    try:
        async with engine.connect() as conn:
            return (await conn.execute(text(sql))).scalar()
    finally:
        await engine.dispose()

def current_revision() -> str | None:
    """Revision recorded in the database (None for an empty database)."""
    try:
        exists = asyncio.run(_scalar("SELECT to_regclass('public.alembic_version') IS NOT NULL"))
        return asyncio.run(_scalar("SELECT version_num FROM alembic_version LIMIT 1")) if exists else None
    except Exception as exc:  # pragma: no cover - surfaced to the user
        raise CommandError(f"Cannot connect to the database ({exc.__class__.__name__}: {exc})")

def ensure_not_legacy() -> None:
    revision = current_revision()
    if revision in LEGACY_REVISIONS:
        raise CommandError(
            f"This database was created by the old (pre-2.0) migrations (revision {revision}).\n"
            "Development: run `python manage.py fresh --seed` to rebuild it with the new per-table migrations.\n"
            "Real data: back it up first (scripts/backup_db), then rebuild and restore the rows you need."
        )

def guard_destructive(action: str, force: bool) -> None:
    if settings.ENVIRONMENT == "production" and not force:
        raise CommandError(f"`{action}` deletes data and is disabled in production. Re-run with --force if you really mean it.")

def _revision_list() -> list:
    """Base → head order."""
    return list(reversed(list(script_directory().walk_revisions())))

# --- commands ------------------------------------------------------------------------------------------

def migrate(to: str | None = None) -> None:
    ensure_not_legacy()
    target = to or "head"
    before = current_revision()
    if to and _is_behind(target, before):
        command.downgrade(alembic_config(), target)
    else:
        command.upgrade(alembic_config(), target)
    after = current_revision()
    print("Nothing to migrate — database is up to date." if before == after else f"Migrated {before or 'empty database'} → {after}")

def _is_behind(target: str, current: str | None) -> bool:
    order = [r.revision for r in _revision_list()]
    return current in order and target in order and order.index(target) < order.index(current)

def rollback(steps: int = 1, to: str | None = None) -> None:
    ensure_not_legacy()
    before = current_revision()
    if before is None:
        print("Nothing to roll back — no migrations applied.")
        return
    command.downgrade(alembic_config(), to if to else f"-{steps}")
    print(f"Rolled back {before} → {current_revision() or 'empty database'}")

def status() -> None:
    applied_rev = current_revision()
    if applied_rev in LEGACY_REVISIONS:
        print(f"Database is on the legacy pre-2.0 chain ({applied_rev}). Run `python manage.py fresh --seed` (dev).")
        return
    revisions = _revision_list()
    applied = True if applied_rev else False
    pending = 0
    print(f"{'':2} {'ID':<6} Migration")
    for rev in revisions:
        mark = "✓" if applied else "·"
        if not applied:
            pending += 1
        print(f"{mark:2} {rev.revision:<6} {rev.doc.splitlines()[0] if rev.doc else ''}")
        if rev.revision == applied_rev:
            applied = False
    print(f"\nDatabase at: {applied_rev or 'empty'} · head: {revisions[-1].revision if revisions else '-'} · pending: {pending}")

def make_migration(message: str, empty: bool = False, tables: list[str] | None = None) -> None:
    ensure_not_legacy()
    slug = re.sub(r"[^a-z0-9]+", "_", message.lower()).strip("_")
    if not slug:
        raise CommandError("Give the migration a short description, e.g. make:migration \"add birthday to customers\"")
    if not empty:
        _require_up_to_date()
    config = alembic_config()
    config.attributes["autogenerate"] = not empty
    if tables:
        from app.models import Base
        unknown = [t for t in tables if t not in Base.metadata.tables]
        if unknown:
            raise CommandError(f"Unknown table(s): {', '.join(unknown)}")
        config.attributes["only_tables"] = set(tables)
    scripts = command.revision(config, message=message.strip(), autogenerate=not empty)
    created = scripts if isinstance(scripts, list) else [scripts]
    created = [s for s in created if s is not None]
    for script in created:
        print(f"Created {Path(script.path).relative_to(BACKEND_DIR)}  — review it, then run `migrate`")

def _require_up_to_date() -> None:
    head = script_directory().get_current_head()
    if current_revision() != head:
        raise CommandError("Apply pending migrations first (`python manage.py migrate`) so autogenerate compares against the latest schema.")

def db_sync(message: str | None = None) -> None:
    """Dev convenience: models → new migration → applied."""
    guard_destructive("db:sync", force=False)
    migrate()
    before = set(VERSIONS_DIR.glob("*.py"))
    make_migration(message or "sync_models")
    if set(VERSIONS_DIR.glob("*.py")) - before:
        migrate()

def db_check() -> None:
    ensure_not_legacy()
    _require_up_to_date()
    try:
        command.check(alembic_config())
    except Exception as exc:
        raise CommandError(f"Models and migrations differ — run `python manage.py make:migration \"…\"`.\n{exc}")
    print("Models match the migrations.")

def refresh(seed: bool = False, force: bool = False) -> None:
    guard_destructive("refresh", force)
    ensure_not_legacy()
    command.downgrade(alembic_config(), "base")
    command.upgrade(alembic_config(), "head")
    print(f"Refreshed: all migrations re-applied ({current_revision()}).")
    if seed:
        seed_command()

async def _drop_everything() -> None:
    engine = create_async_engine(settings.DATABASE_URL)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
            await conn.execute(text("GRANT ALL ON SCHEMA public TO public"))
    finally:
        await engine.dispose()

def fresh(seed: bool = False, force: bool = False) -> None:
    guard_destructive("fresh", force)
    asyncio.run(_drop_everything())
    print("Dropped all tables.")
    command.upgrade(alembic_config(), "head")
    print(f"Migrated from scratch to {current_revision()}.")
    if seed:
        seed_command()

def seed_command(names: list[str] | None = None, list_only: bool = False) -> None:
    from app.db.seeders import SEEDERS, run_seeders
    if list_only:
        for seeder in SEEDERS:
            deps = f"  (after {', '.join(seeder.depends_on)})" if seeder.depends_on else ""
            print(f"  {seeder.name:<18} {seeder.description}{deps}")
        return
    try:
        results = asyncio.run(run_seeders(names))
    except KeyError as exc:
        raise CommandError(f"Unknown seeder {exc}. Available: {', '.join(s.name for s in SEEDERS)}")
    for name, summary in results:
        print(f"  ✓ {name:<18} {summary}")
    from app.db.seeders.demo_data import DEMO_PASSWORD
    if any(name.startswith("demo") for name, _ in results) and settings.ENVIRONMENT != "production":
        print(f"\nDemo logins use the password {DEMO_PASSWORD} (see the dropdown on the login screen).")

def watch(interval: float = 2.0) -> None:
    """Dev: apply new/changed migration files automatically. Edited migrations that are already applied
    can't be re-run safely — you'll be told to `refresh` instead."""
    print(f"Watching {VERSIONS_DIR.relative_to(BACKEND_DIR)} for migration changes…")
    def snapshot():
        return {p.name: p.stat().st_mtime for p in VERSIONS_DIR.glob("*.py")}
    seen = snapshot()
    while True:
        time.sleep(interval)
        now = snapshot()
        if now == seen:
            continue
        changed = sorted(n for n in now if seen.get(n) != now[n])
        seen = now
        applied = current_revision()
        try:
            buffer = io.StringIO()
            with redirect_stdout(buffer):
                migrate()
            print(buffer.getvalue().strip())
        except Exception as exc:
            print(f"[watch] could not apply migrations: {exc}")
            continue
        if current_revision() == applied and changed:
            print(f"[watch] {', '.join(changed)} changed but was already applied. "
                  "In development run `python manage.py refresh --seed` to re-run edited migrations.")

def create_superadmin(email: str, name: str | None, role: str, password: str | None) -> None:
    """The first platform admin of a real server (production has no demo seed). Re-running for an existing
    login promotes it and, if a password is given, resets it."""
    import getpass
    import secrets
    from app.core.security import get_password_hash
    from app.core.tenant import get_shared_session_maker
    from app.db.seeders.helpers import find_account
    from app.models import GlobalUser

    email = email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise CommandError("Enter a valid email address")
    generated = False
    if password is None and sys.stdin.isatty():
        password = getpass.getpass("Password (leave empty to generate one): ") or None
    if password is None:
        password, generated = secrets.token_urlsafe(12), True
    if len(password) < 8:
        raise CommandError("Password must be at least 8 characters")

    async def run() -> str:
        async with get_shared_session_maker()() as db:
            account = await find_account(db, email)
            if account is None:
                db.add(GlobalUser(email=email, full_name=name or "Tallyko admin", password_hash=get_password_hash(password), platform_role=role))
                outcome = "created"
            else:
                account.platform_role, account.is_active = role, True
                account.password_hash = get_password_hash(password)
                if name:
                    account.full_name = name
                outcome = "updated"
            await db.commit()
            return outcome

    outcome = asyncio.run(run())
    print(f"  ✓ {role} {email} {outcome}")
    if generated:
        print(f"    Temporary password: {password}  (change it after signing in)")

def subscriptions_check() -> None:
    from app.services.subscription import run_subscription_check
    result = asyncio.run(run_subscription_check(actor="manage.py subscriptions:check"))
    print(f"  ✓ checked {result['businesses_checked']} businesses · locked now: {result['locked_now']} · "
          f"renewals due soon: {result['renewals_due_soon']}")

# --- entry point ---------------------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="manage.py", description="Tallyko database management",
                                     formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("migrate", help="apply pending migrations")
    p.add_argument("--to", help="target revision id (up or down)")
    p = sub.add_parser("rollback", help="undo migrations")
    p.add_argument("--steps", type=int, default=1)
    p.add_argument("--to", help="roll back to this revision")
    sub.add_parser("status", help="show applied and pending migrations")
    p = sub.add_parser("make:migration", help="create a migration (autogenerated from models by default)")
    p.add_argument("message")
    p.add_argument("--empty", action="store_true", help="blank migration to fill in by hand")
    p.add_argument("--table", action="append", dest="tables", help="only include changes to this table (repeatable)")
    p = sub.add_parser("db:sync", help="dev: generate a migration from model changes and apply it")
    p.add_argument("message", nargs="?")
    sub.add_parser("db:check", help="fail if models and migrations differ")
    for name, helptext in (("refresh", "roll back everything and migrate again"), ("fresh", "drop all tables and migrate from scratch")):
        p = sub.add_parser(name, help=f"dev: {helptext}")
        p.add_argument("--seed", action="store_true", help="run seeders afterwards")
        p.add_argument("--force", action="store_true", help="allow in production (destroys data)")
    p = sub.add_parser("seed", help="run seeders")
    p.add_argument("names", nargs="*")
    p.add_argument("--list", action="store_true")
    p = sub.add_parser("watch", help="dev: auto-apply new migration files")
    p.add_argument("--interval", type=float, default=2.0)
    sub.add_parser("subscriptions:check", help="run the daily subscription check now")
    p = sub.add_parser("create:superadmin", help="create or promote a Tallyko platform admin")
    p.add_argument("email")
    p.add_argument("--name")
    p.add_argument("--role", choices=["super_admin", "support"], default="super_admin")
    p.add_argument("--password", help="omit to be prompted (or get a generated one)")

    args = parser.parse_args(argv)
    try:
        match args.command:
            case "migrate": migrate(args.to)
            case "rollback": rollback(args.steps, args.to)
            case "status": status()
            case "make:migration": make_migration(args.message, args.empty, args.tables)
            case "db:sync": db_sync(args.message)
            case "db:check": db_check()
            case "refresh": refresh(args.seed, args.force)
            case "fresh": fresh(args.seed, args.force)
            case "seed": seed_command(args.names, args.list)
            case "watch": watch(args.interval)
            case "subscriptions:check": subscriptions_check()
            case "create:superadmin": create_superadmin(args.email, args.name, args.role, args.password)
    except CommandError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    return 0
