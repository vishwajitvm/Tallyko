"""Create order_items table — Bill lines

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_child_rls

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('order_items',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('order_id', sa.UUID(), nullable=False),
    sa.Column('product_id', sa.UUID(), nullable=False),
    sa.Column('variant_id', sa.UUID(), nullable=True),
    sa.Column('kot_id', sa.UUID(), nullable=True),
    sa.Column('name', sa.String(), nullable=True),
    sa.Column('variant_name', sa.String(), nullable=True),
    sa.Column('quantity', sa.Integer(), nullable=False),
    sa.Column('unit_price', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('tax_rate', sa.Numeric(precision=5, scale=2), server_default='0', nullable=False),
    sa.Column('tax_amount', sa.Numeric(precision=10, scale=2), server_default='0', nullable=False),
    sa.Column('subtotal', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('notes', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['kot_id'], ['kots.id'], name=op.f('fk_order_items_kot_id_kots')),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], name=op.f('fk_order_items_order_id_orders')),
    sa.ForeignKeyConstraint(['product_id'], ['products.id'], name=op.f('fk_order_items_product_id_products')),
    sa.ForeignKeyConstraint(['variant_id'], ['product_variants.id'], name=op.f('fk_order_items_variant_id_product_variants')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_order_items')),
    info={'rls': 'child', 'rls_fk': 'order_id', 'rls_parent': 'orders'}
    )
    op.create_index(op.f('ix_order_items_order_id'), 'order_items', ['order_id'], unique=False)
    enable_child_rls("order_items", "order_id", "orders")


def downgrade() -> None:
    op.drop_index(op.f('ix_order_items_order_id'), table_name='order_items')
    op.drop_table('order_items')
