"""Create orders table — Bills / orders

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_tenant_rls

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('orders',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('location_id', sa.UUID(), nullable=False),
    sa.Column('table_id', sa.UUID(), nullable=True),
    sa.Column('customer_id', sa.UUID(), nullable=True),
    sa.Column('brand_id', sa.UUID(), nullable=True),
    sa.Column('code', sa.String(), nullable=True),
    sa.Column('invoice_no', sa.String(), nullable=True),
    sa.Column('token_no', sa.Integer(), nullable=True),
    sa.Column('type', sa.String(), nullable=False),
    sa.Column('channel', sa.String(), server_default='POS', nullable=False),
    sa.Column('external_order_id', sa.String(), nullable=True),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('payment_status', sa.String(), server_default='unpaid', nullable=False),
    sa.Column('customer_name', sa.String(), nullable=True),
    sa.Column('customer_phone', sa.String(), nullable=True),
    sa.Column('delivery_address', sa.Text(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('subtotal', sa.Numeric(precision=10, scale=2), server_default='0', nullable=False),
    sa.Column('discount_amount', sa.Numeric(precision=10, scale=2), server_default='0', nullable=False),
    sa.Column('tax_amount', sa.Numeric(precision=10, scale=2), server_default='0', nullable=False),
    sa.Column('round_off', sa.Numeric(precision=10, scale=2), server_default='0', nullable=False),
    sa.Column('total_amount', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('commission_amount', sa.Numeric(precision=10, scale=2), server_default='0', nullable=False),
    sa.Column('loyalty_points_earned', sa.Integer(), server_default='0', nullable=False),
    sa.Column('loyalty_points_redeemed', sa.Integer(), server_default='0', nullable=False),
    sa.Column('stock_deducted', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('cancel_reason', sa.Text(), nullable=True),
    sa.Column('created_by', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('completed_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['brand_id'], ['brands.id'], name=op.f('fk_orders_brand_id_brands')),
    sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], name=op.f('fk_orders_customer_id_customers')),
    sa.ForeignKeyConstraint(['location_id'], ['locations.id'], name=op.f('fk_orders_location_id_locations')),
    sa.ForeignKeyConstraint(['table_id'], ['tables.id'], name=op.f('fk_orders_table_id_tables')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_orders')),
    sa.UniqueConstraint('tenant_id', 'code', name='uq_orders_tenant_code'),
    info={'rls': 'tenant'}
    )
    op.create_index('ix_orders_tenant_created', 'orders', ['tenant_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_orders_tenant_id'), 'orders', ['tenant_id'], unique=False)
    enable_tenant_rls("orders")


def downgrade() -> None:
    op.drop_index(op.f('ix_orders_tenant_id'), table_name='orders')
    op.drop_index('ix_orders_tenant_created', table_name='orders')
    op.drop_table('orders')
