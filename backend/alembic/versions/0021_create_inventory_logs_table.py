"""Create inventory_logs table — Stock ledger

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_tenant_rls

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('inventory_logs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('product_id', sa.UUID(), nullable=False),
    sa.Column('location_id', sa.UUID(), nullable=False),
    sa.Column('quantity_change', sa.Integer(), nullable=False),
    sa.Column('reason', sa.String(), nullable=False),
    sa.Column('note', sa.String(), nullable=True),
    sa.Column('unit_cost', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('order_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['location_id'], ['locations.id'], name=op.f('fk_inventory_logs_location_id_locations')),
    sa.ForeignKeyConstraint(['product_id'], ['products.id'], name=op.f('fk_inventory_logs_product_id_products')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_inventory_logs')),
    info={'rls': 'tenant'}
    )
    op.create_index(op.f('ix_inventory_logs_tenant_id'), 'inventory_logs', ['tenant_id'], unique=False)
    enable_tenant_rls("inventory_logs")


def downgrade() -> None:
    op.drop_index(op.f('ix_inventory_logs_tenant_id'), table_name='inventory_logs')
    op.drop_table('inventory_logs')
