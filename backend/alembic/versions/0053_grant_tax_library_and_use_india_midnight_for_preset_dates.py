"""Grant the GST library to the tenant role and use India midnight for preset dates

Revision ID: 0053
Revises: 0052
Create Date: 2026-10-24 20:10:00

Rules: forward-only and non-destructive (old app versions must keep working against the new schema);
new tenant tables need Row-Level Security — autogenerate adds it, for hand-written ones use
app.db.rls.enable_tenant_rls("table") / enable_child_rls("table", "fk_column", "parent_table").
"""
from alembic import op

revision = '0053'
down_revision = '0052'
branch_labels = None
depends_on = None

# Rates were stored at 00:00 UTC (= 05:30 in India); government notifications take effect at midnight IST.
SHIFT = "interval '5 hours 30 minutes'"


def upgrade() -> None:
    # Businesses read the platform GST library from tenant-scoped sessions (Settings → GST & taxes)
    op.execute("GRANT SELECT ON tax_presets, tax_preset_rates TO tallyko_app")
    op.execute(f"UPDATE tax_preset_rates SET effective_from = effective_from - {SHIFT} WHERE effective_from::time = '00:00:00'")
    op.execute(f"UPDATE tax_class_rates SET effective_from = effective_from - {SHIFT} "
               "WHERE source = 'preset' AND effective_from::time = '00:00:00'")


def downgrade() -> None:
    op.execute(f"UPDATE tax_class_rates SET effective_from = effective_from + {SHIFT} WHERE source = 'preset' AND effective_from::time = '18:30:00'")
    op.execute(f"UPDATE tax_preset_rates SET effective_from = effective_from + {SHIFT} WHERE effective_from::time = '18:30:00'")
    op.execute("REVOKE SELECT ON tax_presets, tax_preset_rates FROM tallyko_app")
