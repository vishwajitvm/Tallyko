"""Platform-level tables managed by the Tallyko super admin (not tenant data, no RLS)."""
import uuid
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from app.models.base import Base, created_at_column, updated_at_column, uuid_pk

class Plan(Base):
    """A sellable package: which features (modules) a business gets and its limits."""
    __tablename__ = "plans"

    key = Column(String, primary_key=True)  # basic, standard, pro, …
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    price_monthly = Column(Numeric(10, 2), default=0, server_default="0", nullable=False)
    features = Column(JSON, nullable=False)  # list of feature keys (app.core.catalog.FEATURES)
    limits = Column(JSON, nullable=False)  # {"max_staff": int|null, "max_products": …, "max_locations": …}
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    sort_order = Column(Integer, default=0, server_default="0", nullable=False)
    # Ways to buy it: [{"months": 1, "price": 499}, {"months": 12, "price": 4990, "label": "Yearly · 2 months free"}].
    # Empty = monthly price × months.
    billing_options = Column(JSON, nullable=True)
    created_at = created_at_column()
    updated_at = updated_at_column()

class PlatformAuditLog(Base):
    """Every super-admin action (plan changes, suspensions, password resets)."""
    __tablename__ = "platform_audit_logs"

    id = uuid_pk()
    actor_user_id = Column(UUID(as_uuid=True), nullable=True)
    actor_email = Column(String, nullable=True)
    action = Column(String, nullable=False)
    target_tenant_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    details = Column(JSON, nullable=True)
    created_at = created_at_column()

class SubscriptionOffer(Base):
    """A promotion on Tallyko subscriptions, e.g. "Diwali: 25% off yearly plans" or "First month free"."""
    __tablename__ = "subscription_offers"

    id = uuid_pk()
    code = Column(String, nullable=True, unique=True)  # optional coupon code (upper-case)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    discount_type = Column(String, default="percent", server_default="percent", nullable=False)  # percent | flat | none
    discount_value = Column(Numeric(10, 2), default=0, server_default="0", nullable=False)
    extra_days = Column(Integer, default=0, server_default="0", nullable=False)  # free days added on top
    plan_keys = Column(JSON, nullable=True)  # null = every plan
    min_months = Column(Integer, default=1, server_default="1", nullable=False)
    starts_at = Column(DateTime, nullable=True)
    ends_at = Column(DateTime, nullable=True)
    max_redemptions = Column(Integer, nullable=True)
    redemptions = Column(Integer, default=0, server_default="0", nullable=False)
    new_businesses_only = Column(Boolean, default=False, server_default="false", nullable=False)  # never paid before
    show_to_owners = Column(Boolean, default=True, server_default="true", nullable=False)  # listed on the renewal screen
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    created_at = created_at_column()
    updated_at = updated_at_column()

class SubscriptionRequest(Base):
    """An owner says "I paid" (e.g. UPI reference) from the renewal screen; a super admin approves it into a subscription."""
    __tablename__ = "subscription_requests"

    id = uuid_pk()
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("global_vendors.id"), nullable=False, index=True)
    plan_key = Column(String, ForeignKey("plans.key"), nullable=False)
    months = Column(Integer, nullable=False)
    offer_code = Column(String, nullable=True)
    amount = Column(Numeric(10, 2), nullable=False)  # what the owner says they paid
    method = Column(String, nullable=False)
    reference = Column(String, nullable=True)
    note = Column(Text, nullable=True)
    status = Column(String, default="pending", server_default="pending", nullable=False)  # pending | approved | rejected
    requested_by = Column(String, nullable=True)
    reviewed_by = Column(String, nullable=True)
    review_note = Column(Text, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = created_at_column()

class PlatformSetting(Base):
    """Platform-wide settings edited in the console (trial length, grace days, how owners pay, job status)."""
    __tablename__ = "platform_settings"

    key = Column(String, primary_key=True)
    value = Column(JSON, nullable=True)
    updated_at = updated_at_column()

class OwnerRequest(Base):
    """An owner asks Tallyko to archive or permanently delete records (businesses can never delete bills themselves)."""
    __tablename__ = "owner_requests"

    id = uuid_pk()
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("global_vendors.id"), nullable=False, index=True)
    kind = Column(String, nullable=False)  # archive_bills | delete_bills | other
    order_ids = Column(JSON, nullable=True)
    message = Column(Text, nullable=False)
    status = Column(String, default="pending", server_default="pending", nullable=False)  # pending | done | rejected
    requested_by = Column(String, nullable=True)
    handled_by = Column(String, nullable=True)
    action_taken = Column(String, nullable=True)  # archived | deleted | none
    response = Column(Text, nullable=True)
    created_at = created_at_column()
    handled_at = Column(DateTime, nullable=True)
