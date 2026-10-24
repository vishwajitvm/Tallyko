"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

Rules: forward-only and non-destructive (old app versions must keep working against the new schema);
new tenant tables need Row-Level Security — autogenerate adds it, for hand-written ones use
app.db.rls.enable_tenant_rls("table") / enable_child_rls("table", "fk_column", "parent_table").
"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}
revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
