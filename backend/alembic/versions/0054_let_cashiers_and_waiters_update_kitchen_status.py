"""Let cashiers and waiters update kitchen status (mark items ready / served)

Revision ID: 0054
Revises: 0053
Create Date: 2026-10-24 20:12:00

Rules: forward-only and non-destructive (old app versions must keep working against the new schema);
new tenant tables need Row-Level Security — autogenerate adds it, for hand-written ones use
app.db.rls.enable_tenant_rls("table") / enable_child_rls("table", "fk_column", "parent_table").
"""
from alembic import op

revision = '0054'
down_revision = '0053'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Small places have no kitchen screen: whoever is on the floor marks items ready/served.
    # Only built-in roles; owners who customised them can still take it away.
    op.execute("""
        UPDATE roles SET permissions = (permissions::jsonb || '["kitchen.update"]'::jsonb)::json
        WHERE is_system AND key IN ('cashier', 'waiter') AND NOT (permissions::jsonb ? 'kitchen.update')
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE roles SET permissions = (permissions::jsonb - 'kitchen.update')::json
        WHERE is_system AND key IN ('cashier', 'waiter')
    """)
