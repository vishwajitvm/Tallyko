"""Create the tallyko_app database role used for Row-Level Security

Revision ID: 0001
Revises: 
Create Date: 2026-10-23
"""
from alembic import op
from app.db.rls import create_tenant_role

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    create_tenant_role()


def downgrade() -> None:
    op.execute("REVOKE USAGE ON SCHEMA public FROM tallyko_app")
    # The role is cluster-wide and may be used by other (dedicated tenant) databases, so it is kept.
