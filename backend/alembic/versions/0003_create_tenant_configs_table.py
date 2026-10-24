"""Create tenant_configs table — Per-business database routing and status

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('tenant_configs',
    sa.Column('vendor_id', sa.UUID(), nullable=False),
    sa.Column('db_url', sa.String(), nullable=True),
    sa.Column('status', sa.String(), nullable=False),
    sa.ForeignKeyConstraint(['vendor_id'], ['global_vendors.id'], name=op.f('fk_tenant_configs_vendor_id_global_vendors')),
    sa.PrimaryKeyConstraint('vendor_id', name=op.f('pk_tenant_configs'))
    )


def downgrade() -> None:
    op.drop_table('tenant_configs')
