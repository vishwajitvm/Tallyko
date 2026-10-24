"""Create global_vendors table — Businesses (tenants)

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('global_vendors',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('plan_type', sa.String(), nullable=False),
    sa.Column('business_type', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_global_vendors'))
    )


def downgrade() -> None:
    op.drop_table('global_vendors')
