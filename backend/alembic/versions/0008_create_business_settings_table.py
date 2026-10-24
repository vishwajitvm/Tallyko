"""Create business_settings table — Receipt header, GST, UPI, loyalty and ordering settings

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_tenant_rls

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('business_settings',
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('business_name', sa.String(), nullable=False),
    sa.Column('business_type', sa.String(), server_default='restaurant', nullable=False),
    sa.Column('address', sa.Text(), nullable=True),
    sa.Column('phone', sa.String(), nullable=True),
    sa.Column('email', sa.String(), nullable=True),
    sa.Column('gstin', sa.String(), nullable=True),
    sa.Column('fssai', sa.String(), nullable=True),
    sa.Column('upi_id', sa.String(), nullable=True),
    sa.Column('currency_symbol', sa.String(), server_default='₹', nullable=False),
    sa.Column('prices_include_tax', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('default_tax_rate', sa.Numeric(precision=5, scale=2), server_default='5', nullable=False),
    sa.Column('invoice_prefix', sa.String(), server_default='INV', nullable=False),
    sa.Column('receipt_footer', sa.Text(), nullable=True),
    sa.Column('loyalty_enabled', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('loyalty_points_per_100', sa.Integer(), server_default='1', nullable=False),
    sa.Column('loyalty_point_value', sa.Numeric(precision=10, scale=2), server_default='1', nullable=False),
    sa.Column('store_enabled', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('qr_ordering_enabled', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('low_stock_default', sa.Integer(), server_default='10', nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('tenant_id', name=op.f('pk_business_settings')),
    info={'rls': 'tenant'}
    )
    enable_tenant_rls("business_settings")


def downgrade() -> None:
    op.drop_table('business_settings')
