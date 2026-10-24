"""Create customers table — Customers and loyalty balances

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_tenant_rls

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('customers',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('phone', sa.String(), nullable=False),
    sa.Column('email', sa.String(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('points', sa.Integer(), nullable=False),
    sa.Column('total_spent', sa.Numeric(precision=12, scale=2), server_default='0', nullable=False),
    sa.Column('visits', sa.Integer(), server_default='0', nullable=False),
    sa.Column('last_visit_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_customers')),
    info={'rls': 'tenant'}
    )
    op.create_index(op.f('ix_customers_tenant_id'), 'customers', ['tenant_id'], unique=False)
    op.create_index('ix_customers_tenant_phone', 'customers', ['tenant_id', 'phone'], unique=False)
    enable_tenant_rls("customers")


def downgrade() -> None:
    op.drop_index('ix_customers_tenant_phone', table_name='customers')
    op.drop_index(op.f('ix_customers_tenant_id'), table_name='customers')
    op.drop_table('customers')
