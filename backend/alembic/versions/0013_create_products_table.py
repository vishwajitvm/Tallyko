"""Create products table — Menu items / retail products

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_tenant_rls

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('products',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('category_id', sa.UUID(), nullable=True),
    sa.Column('brand_id', sa.UUID(), nullable=True),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('base_price', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('cost_price', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('tax_rate', sa.Numeric(precision=5, scale=2), nullable=True),
    sa.Column('barcode', sa.String(), nullable=True),
    sa.Column('sku', sa.String(), nullable=True),
    sa.Column('unit', sa.String(), server_default='pcs', nullable=False),
    sa.Column('is_veg', sa.Boolean(), nullable=True),
    sa.Column('print_to_kitchen', sa.Boolean(), nullable=False),
    sa.Column('track_stock', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('low_stock_threshold', sa.Integer(), nullable=True),
    sa.Column('sort_order', sa.Integer(), server_default='0', nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['brand_id'], ['brands.id'], name=op.f('fk_products_brand_id_brands')),
    sa.ForeignKeyConstraint(['category_id'], ['product_categories.id'], name=op.f('fk_products_category_id_product_categories')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_products')),
    info={'rls': 'tenant'}
    )
    op.create_index(op.f('ix_products_barcode'), 'products', ['barcode'], unique=False)
    op.create_index(op.f('ix_products_tenant_id'), 'products', ['tenant_id'], unique=False)
    enable_tenant_rls("products")


def downgrade() -> None:
    op.drop_index(op.f('ix_products_tenant_id'), table_name='products')
    op.drop_index(op.f('ix_products_barcode'), table_name='products')
    op.drop_table('products')
