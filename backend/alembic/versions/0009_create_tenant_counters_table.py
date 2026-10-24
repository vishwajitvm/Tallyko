"""Create tenant_counters table — Invoice / token / KOT / barcode sequences

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_tenant_rls

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('tenant_counters',
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('value', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('tenant_id', 'name', name=op.f('pk_tenant_counters')),
    info={'rls': 'tenant'}
    )
    enable_tenant_rls("tenant_counters")


def downgrade() -> None:
    op.drop_table('tenant_counters')
