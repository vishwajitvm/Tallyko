"""Create global_users table — Login accounts

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('global_users',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('email', sa.String(), nullable=False),
    sa.Column('phone', sa.String(), nullable=True),
    sa.Column('full_name', sa.String(), nullable=True),
    sa.Column('password_hash', sa.String(), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_global_users'))
    )
    op.create_index(op.f('ix_global_users_email'), 'global_users', ['email'], unique=True)
    op.create_index(op.f('ix_global_users_phone'), 'global_users', ['phone'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_global_users_phone'), table_name='global_users')
    op.drop_index(op.f('ix_global_users_email'), table_name='global_users')
    op.drop_table('global_users')
