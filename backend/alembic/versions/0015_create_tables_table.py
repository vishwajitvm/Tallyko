"""Create tables table — Dining tables

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_tenant_rls

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('tables',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('location_id', sa.UUID(), nullable=False),
    sa.Column('table_number', sa.String(), nullable=False),
    sa.Column('section', sa.String(), nullable=True),
    sa.Column('capacity', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(), server_default='free', nullable=False),
    sa.Column('current_order_id', sa.UUID(), nullable=True),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['location_id'], ['locations.id'], name=op.f('fk_tables_location_id_locations')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_tables')),
    info={'rls': 'tenant'}
    )
    op.create_index(op.f('ix_tables_tenant_id'), 'tables', ['tenant_id'], unique=False)
    enable_tenant_rls("tables")


def downgrade() -> None:
    op.drop_index(op.f('ix_tables_tenant_id'), table_name='tables')
    op.drop_table('tables')
