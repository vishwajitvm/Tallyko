"""Global (not tenant-scoped) tables: businesses, their database routing, subscriptions and login accounts."""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.models.base import Base, created_at_column, uuid_pk

class GlobalVendor(Base):
    """A business (tenant). Its id is the ``tenant_id`` used everywhere else."""
    __tablename__ = "global_vendors"

    id = uuid_pk()
    name = Column(String, nullable=False)
    plan_type = Column(String, nullable=False)  # 'free', 'premium', 'lifetime'
    business_type = Column(String, nullable=True)  # 'restaurant', 'retail', 'cloud_kitchen', 'cafe'
    created_at = created_at_column(server_default=False)

    tenant_configs = relationship("TenantConfig", back_populates="vendor", cascade="all, delete-orphan")
    subscriptions = relationship("Subscription", back_populates="vendor", cascade="all, delete-orphan")

class TenantConfig(Base):
    """Where a tenant's data lives (shared DB when ``db_url`` is null) and whether it is active."""
    __tablename__ = "tenant_configs"

    vendor_id = Column(UUID(as_uuid=True), ForeignKey("global_vendors.id"), primary_key=True)
    db_url = Column(String, nullable=True)
    status = Column(String, default="active", nullable=False)  # 'active', 'suspended', 'deleted'
    status_reason = Column(String, nullable=True)
    plan_key = Column(String, ForeignKey("plans.key"), nullable=True)  # null = default plan
    feature_overrides = Column(JSON, nullable=True)  # {feature: true|false} on top of the plan
    limit_overrides = Column(JSON, nullable=True)  # {"max_staff": 50, …} on top of the plan
    admin_notes = Column(Text, nullable=True)
    # End of the latest trial/paid subscription. After it (plus the platform grace period) the business is locked
    # until it renews; its data and devices' offline bills are kept.
    paid_until = Column(DateTime, nullable=True)
    session_version = Column(Integer, default=1, server_default="1", nullable=False)  # bump = every device signed out
    lapsed_at = Column(DateTime, nullable=True)  # when the daily check locked it for non-payment; cleared on renewal

    vendor = relationship("GlobalVendor", back_populates="tenant_configs")

class Subscription(Base):
    """Immutable plan snapshot: entitlements are copied at purchase so later price changes never affect it."""
    __tablename__ = "subscriptions"

    id = uuid_pk()
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("global_vendors.id"), nullable=False)
    snap_entitlements = Column(JSON, nullable=False)
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)

    vendor = relationship("GlobalVendor", back_populates="subscriptions")

class GlobalUser(Base):
    """A login (owner or staff). Linked to businesses through ``users`` (TenantUser) by email."""
    __tablename__ = "global_users"

    id = uuid_pk()
    email = Column(String, unique=True, index=True, nullable=False)
    phone = Column(String, unique=True, index=True, nullable=True)
    full_name = Column(String, nullable=True)
    password_hash = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    # Tallyko platform staff only: 'super_admin' or 'support' (see app.core.catalog.PLATFORM_ROLES)
    platform_role = Column(String, nullable=True)
    created_at = created_at_column(server_default=False)

class UserSession(Base):
    """One signed-in device. Tokens carry its id, so a single device or a whole business can be signed out."""
    __tablename__ = "user_sessions"

    id = uuid_pk()
    user_id = Column(UUID(as_uuid=True), ForeignKey("global_users.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=True, index=True)  # null for platform (super admin) logins
    staff_id = Column(UUID(as_uuid=True), nullable=True)
    kind = Column(String, default="business", server_default="business", nullable=False)  # business | platform
    device = Column(String, nullable=True)  # from the User-Agent, e.g. "Chrome on Windows"
    ip = Column(String, nullable=True)
    created_at = created_at_column()
    last_seen_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    revoked_reason = Column(String, nullable=True)
