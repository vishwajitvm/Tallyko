"""Alembic environment for Tallyko.

Use the management CLI rather than calling alembic directly (see `python manage.py --help`):
  migrate / rollback / status / make:migration / db:sync / refresh / fresh / seed
"""
import asyncio
import os
import re
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from alembic.operations import ops
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings as app_settings  # noqa: E402
from app.db.rls import policy_sql_for  # noqa: E402
from app.models import Base  # noqa: E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# Same DATABASE_URL as the app (env / .env) — never the placeholder in alembic.ini.
# DATABASE_URL_OVERRIDE lets tooling target a scratch database without touching the app's settings.
config.set_main_option("sqlalchemy.url", (os.getenv("DATABASE_URL_OVERRIDE") or app_settings.DATABASE_URL).replace("%", "%%"))

target_metadata = Base.metadata
VERSIONS_DIR = Path(__file__).resolve().parent / "versions"

def _next_revision_id() -> str:
    """Sequential ids (0001, 0002, …) keep `status` and file listings in creation order."""
    numbers = [int(m.group(1)) for f in VERSIONS_DIR.glob("*.py") if (m := re.match(r"^(\d{4,})_", f.name))]
    return f"{(max(numbers) if numbers else 0) + 1:04d}"

def process_revision_directives(context_, revision, directives):
    script = directives[0]
    autogenerate = getattr(config.cmd_opts, "autogenerate", False) if config.cmd_opts else config.attributes.get("autogenerate", False)
    # Always sequential (Alembic's random ids can even be all digits, so never trust their shape)
    script.rev_id = config.attributes.get("rev_id") or _next_revision_id()
    if not autogenerate:
        return
    if script.upgrade_ops.is_empty():
        directives[:] = []
        print("No model changes detected — no migration created.")
        return
    # New tenant tables get their Row-Level Security policy in the same migration, automatically.
    for op_ in list(script.upgrade_ops.ops):
        if isinstance(op_, ops.CreateTableOp):
            table = target_metadata.tables.get(op_.table_name)
            for statement in policy_sql_for(op_.table_name, table.info if table is not None else {}):
                script.upgrade_ops.ops.append(ops.ExecuteSQLOp(statement))

def _table_of(obj, name, type_) -> str | None:
    if type_ == "table":
        return name
    table = getattr(obj, "table", None)
    return getattr(table, "name", None)

def include_object(obj, name, type_, reflected, compare_to):
    # Policies, roles and grants are managed by app.db.rls, not autogenerate
    if type_ == "table" and name == "alembic_version":
        return False
    # `make:migration … --table x` keeps each migration about one table
    only = config.attributes.get("only_tables")
    if only:
        return _table_of(obj, name, type_) in only
    return True

def _configure(**kwargs):
    context.configure(
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
        include_object=include_object,
        process_revision_directives=process_revision_directives,
        **kwargs,
    )

def run_migrations_offline() -> None:
    _configure(url=config.get_main_option("sqlalchemy.url"), literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()

def do_run_migrations(connection: Connection) -> None:
    _configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()

async def run_migrations_online() -> None:
    connectable = async_engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()

if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
