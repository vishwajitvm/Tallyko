"""Make business records undeletable by the app (only Tallyko's super admin, via system sessions, can delete)

Revision ID: 0059
Revises: 0058
Create Date: 2026-10-25 10:30:00

Rules: forward-only and non-destructive (old app versions must keep working against the new schema);
new tenant tables need Row-Level Security — autogenerate adds it, for hand-written ones use
app.db.rls.enable_tenant_rls("table") / enable_child_rls("table", "fk_column", "parent_table").

Business requests run as the `tallyko_app` role. Taking DELETE away means no bug, staff member or owner can erase
bills, payments, customers or stock history; the activity log and menu history can't even be edited.
Cancelled / removed things are statuses, never deletions. The super admin's console uses system sessions.
"""
from alembic import op

revision = '0059'
down_revision = '0058'
branch_labels = None
depends_on = None

NO_DELETE = ["orders", "payments", "kots", "customers", "products", "product_categories", "inventory_logs", "tables"]
APPEND_ONLY = ["audit_logs", "product_versions"]


def upgrade() -> None:
    op.execute(f"REVOKE DELETE ON {', '.join(NO_DELETE)} FROM tallyko_app")
    op.execute(f"REVOKE UPDATE, DELETE ON {', '.join(APPEND_ONLY)} FROM tallyko_app")


def downgrade() -> None:
    op.execute(f"GRANT UPDATE, DELETE ON {', '.join(APPEND_ONLY)} TO tallyko_app")
    op.execute(f"GRANT DELETE ON {', '.join(NO_DELETE)} TO tallyko_app")
