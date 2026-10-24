"""Create brands table — Cloud-kitchen virtual brands

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_tenant_rls

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('brands',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_brands')),
    info={'rls': 'tenant'}
    )
    op.create_index(op.f('ix_brands_tenant_id'), 'brands', ['tenant_id'], unique=False)
    enable_tenant_rls("brands")


def downgrade() -> None:
    op.drop_index(op.f('ix_brands_tenant_id'), table_name='brands')
    op.drop_table('brands')
