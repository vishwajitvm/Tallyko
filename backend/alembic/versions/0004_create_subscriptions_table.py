"""Create subscriptions table — Immutable plan snapshots

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('subscriptions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('vendor_id', sa.UUID(), nullable=False),
    sa.Column('snap_entitlements', sa.JSON(), nullable=False),
    sa.Column('start_date', sa.DateTime(), nullable=False),
    sa.Column('end_date', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['vendor_id'], ['global_vendors.id'], name=op.f('fk_subscriptions_vendor_id_global_vendors')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_subscriptions'))
    )


def downgrade() -> None:
    op.drop_table('subscriptions')
