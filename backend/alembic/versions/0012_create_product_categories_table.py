"""Create product_categories table — Menu categories

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_tenant_rls

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('product_categories',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_product_categories')),
    info={'rls': 'tenant'}
    )
    op.create_index(op.f('ix_product_categories_tenant_id'), 'product_categories', ['tenant_id'], unique=False)
    enable_tenant_rls("product_categories")


def downgrade() -> None:
    op.drop_index(op.f('ix_product_categories_tenant_id'), table_name='product_categories')
    op.drop_table('product_categories')
