"""Create sales_channels table — Sales channels (counter, QR, online store, aggregators)

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_tenant_rls

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('sales_channels',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('code', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('enabled', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('commission_pct', sa.Numeric(precision=5, scale=2), server_default='0', nullable=False),
    sa.Column('price_adjust_pct', sa.Numeric(precision=5, scale=2), server_default='0', nullable=False),
    sa.Column('external_store_id', sa.String(), nullable=True),
    sa.Column('webhook_secret', sa.String(), nullable=True),
    sa.Column('auto_accept', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_sales_channels')),
    sa.UniqueConstraint('tenant_id', 'code', name='uq_sales_channels_tenant_code'),
    info={'rls': 'tenant'}
    )
    op.create_index(op.f('ix_sales_channels_tenant_id'), 'sales_channels', ['tenant_id'], unique=False)
    enable_tenant_rls("sales_channels")


def downgrade() -> None:
    op.drop_index(op.f('ix_sales_channels_tenant_id'), table_name='sales_channels')
    op.drop_table('sales_channels')
