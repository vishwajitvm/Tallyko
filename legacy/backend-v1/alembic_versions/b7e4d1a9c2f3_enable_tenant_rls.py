"""Enable Row-Level Security on tenant tables

Creates the non-superuser role `tallyko_app`. Tenant-scoped sessions (app/core/tenant.py) run
`SET LOCAL ROLE tallyko_app` and set `app.current_tenant_id`, so these policies apply to them even
though the app connects as the table owner. System sessions (auth, tenant routing) keep the
connecting role and are not filtered. RLS is deliberately not FORCEd, for that reason.

Revision ID: b7e4d1a9c2f3
Revises: 8ca20393f65a
"""
from alembic import op

revision = 'b7e4d1a9c2f3'
down_revision = '8ca20393f65a'
branch_labels = None
depends_on = None

TENANT_ROLE = "tallyko_app"

# Tables with their own tenant_id column
TENANT_TABLES = [
    "locations", "users", "product_categories", "products", "tables",
    "orders", "inventory_logs", "customers", "kots",
]

# Tables without tenant_id, isolated through their parent row: table -> (fk column, parent table)
CHILD_TABLES = {
    "product_variants": ("product_id", "products"),
    "order_items": ("order_id", "orders"),
    "payments": ("order_id", "orders"),
}

# Unset or empty setting -> NULL -> no rows (fail closed)
CURRENT_TENANT = "NULLIF(current_setting('app.current_tenant_id', true), '')::uuid"


def upgrade() -> None:
    op.execute(f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{TENANT_ROLE}') THEN
                CREATE ROLE {TENANT_ROLE} NOLOGIN;
            END IF;
        END
        $$
    """)
    # Lets the app's connecting user `SET ROLE` to it (needed when that user is not a superuser)
    op.execute(f"GRANT {TENANT_ROLE} TO CURRENT_USER")
    op.execute(f"GRANT USAGE ON SCHEMA public TO {TENANT_ROLE}")

    for table in TENANT_TABLES + list(CHILD_TABLES):
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {TENANT_ROLE}")
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")

    for table in TENANT_TABLES:
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (tenant_id = {CURRENT_TENANT})
            WITH CHECK (tenant_id = {CURRENT_TENANT})
        """)

    # The parent lookup is itself filtered by the parent's policy
    for table, (fk_column, parent) in CHILD_TABLES.items():
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (EXISTS (SELECT 1 FROM {parent} p WHERE p.id = {table}.{fk_column}))
        """)


def downgrade() -> None:
    for table in TENANT_TABLES + list(CHILD_TABLES):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON {table} FROM {TENANT_ROLE}")
    op.execute(f"REVOKE USAGE ON SCHEMA public FROM {TENANT_ROLE}")
    # The role is cluster-wide and may still be used by other (dedicated tenant) databases, so it is kept.
