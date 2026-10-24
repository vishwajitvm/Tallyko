"""Per-business roles (built-in + custom) and the audit log."""
from sqlalchemy import Boolean, Column, Index, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from app.models.base import Base, TENANT_RLS, TenantScoped, created_at_column, updated_at_column, uuid_pk

class Role(TenantScoped, Base):
    """A named set of permissions. Built-in roles (owner, manager, cashier, waiter, kitchen) have is_system=True;
    owners can add custom ones. Staff reference roles by ``key``."""
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("tenant_id", "key", name="uq_roles_tenant_key"), TENANT_RLS)

    id = uuid_pk()
    key = Column(String, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    permissions = Column(JSON, nullable=False)  # list of permission codes (app.core.catalog.PERMISSIONS)
    is_system = Column(Boolean, default=False, server_default="false", nullable=False)
    created_at = created_at_column()
    updated_at = updated_at_column()

class AuditLog(TenantScoped, Base):
    """Who did what: voids, discounts, cancellations, refunds, role and settings changes."""
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_tenant_created", "tenant_id", "created_at"), TENANT_RLS)

    id = uuid_pk()
    actor_staff_id = Column(UUID(as_uuid=True), nullable=True)
    actor_name = Column(String, nullable=True)
    action = Column(String, nullable=False)  # e.g. order.cancel, order.discount, staff.role_change
    entity_type = Column(String, nullable=True)
    entity_id = Column(String, nullable=True)
    summary = Column(Text, nullable=True)
    details = Column(JSON, nullable=True)
    created_at = created_at_column()
