"""Create product_variants table — Product options such as Half/Full

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_child_rls

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('product_variants',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('product_id', sa.UUID(), nullable=False),
    sa.Column('variant_name', sa.String(), nullable=False),
    sa.Column('price_modifier', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.ForeignKeyConstraint(['product_id'], ['products.id'], name=op.f('fk_product_variants_product_id_products')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_product_variants')),
    info={'rls': 'child', 'rls_fk': 'product_id', 'rls_parent': 'products'}
    )
    enable_child_rls("product_variants", "product_id", "products")


def downgrade() -> None:
    op.drop_table('product_variants')
