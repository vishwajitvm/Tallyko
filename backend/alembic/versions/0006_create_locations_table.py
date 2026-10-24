"""Create locations table — Branches / outlets

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa
from app.db.rls import enable_tenant_rls

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('locations',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('address', sa.String(), nullable=True),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_locations')),
    info={'rls': 'tenant'}
    )
    op.create_index(op.f('ix_locations_tenant_id'), 'locations', ['tenant_id'], unique=False)
    enable_tenant_rls("locations")


def downgrade() -> None:
    op.drop_index(op.f('ix_locations_tenant_id'), table_name='locations')
    op.drop_table('locations')
