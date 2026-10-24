"""Create payments table — Payments against bills

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_child_rls

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('payments',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('order_id', sa.UUID(), nullable=False),
    sa.Column('method', sa.String(), nullable=False),
    sa.Column('amount', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('reference', sa.String(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], name=op.f('fk_payments_order_id_orders')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_payments')),
    info={'rls': 'child', 'rls_fk': 'order_id', 'rls_parent': 'orders'}
    )
    op.create_index(op.f('ix_payments_order_id'), 'payments', ['order_id'], unique=False)
    enable_child_rls("payments", "order_id", "orders")


def downgrade() -> None:
    op.drop_index(op.f('ix_payments_order_id'), table_name='payments')
    op.drop_table('payments')
