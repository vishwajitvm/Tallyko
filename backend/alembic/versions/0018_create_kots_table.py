"""Create kots table — Kitchen order tickets

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_tenant_rls

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('kots',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('order_id', sa.UUID(), nullable=False),
    sa.Column('kot_no', sa.Integer(), nullable=True),
    sa.Column('status', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], name=op.f('fk_kots_order_id_orders')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_kots')),
    info={'rls': 'tenant'}
    )
    op.create_index(op.f('ix_kots_tenant_id'), 'kots', ['tenant_id'], unique=False)
    enable_tenant_rls("kots")


def downgrade() -> None:
    op.drop_index(op.f('ix_kots_tenant_id'), table_name='kots')
    op.drop_table('kots')
