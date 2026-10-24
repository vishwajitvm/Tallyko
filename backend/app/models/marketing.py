"""Offers, loyalty rewards and customer emails."""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text, Time, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from app.models.base import Base, TENANT_RLS, TenantScoped, created_at_column, updated_at_column, uuid_pk

class Offer(TenantScoped, Base):
    """A discount rule.

    kind:          bill (whole order) · items (only some products/categories) · loyalty (customer milestone reward)
    benefit_type:  percent · flat (₹) · free_item (a product on the house)
    Conditions:    min_order_amount, channels, order_types, schedule (dates, weekdays, time window),
                   loyalty: min_visits within visits_window_days; usage caps.
    """
    __tablename__ = "offers"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_offers_tenant_code"), TENANT_RLS)

    id = uuid_pk()
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    code = Column(String, nullable=True)  # optional coupon code customers can quote
    kind = Column(String, default="bill", server_default="bill", nullable=False)
    benefit_type = Column(String, nullable=False)
    benefit_value = Column(Numeric(10, 2), default=0, server_default="0", nullable=False)
    max_discount = Column(Numeric(10, 2), nullable=True)
    free_product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=True)
    free_quantity = Column(Integer, default=1, server_default="1", nullable=False)
    min_order_amount = Column(Numeric(10, 2), default=0, server_default="0", nullable=False)
    product_ids = Column(JSON, nullable=True)
    category_ids = Column(JSON, nullable=True)
    min_visits = Column(Integer, nullable=True)
    visits_window_days = Column(Integer, nullable=True)
    channels = Column(JSON, nullable=True)  # null = every channel
    order_types = Column(JSON, nullable=True)  # null = every order type
    days_of_week = Column(JSON, nullable=True)  # 0=Mon … 6=Sun; null = every day
    start_time = Column(Time, nullable=True)  # daily window, e.g. happy hours
    end_time = Column(Time, nullable=True)
    starts_at = Column(DateTime, nullable=True)
    ends_at = Column(DateTime, nullable=True)
    auto_apply = Column(Boolean, default=False, server_default="false", nullable=False)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    priority = Column(Integer, default=0, server_default="0", nullable=False)
    max_uses_total = Column(Integer, nullable=True)
    max_uses_per_customer = Column(Integer, nullable=True)
    uses_count = Column(Integer, default=0, server_default="0", nullable=False)
    notify_email = Column(Boolean, default=False, server_default="false", nullable=False)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = created_at_column()
    updated_at = updated_at_column()

class OfferRedemption(TenantScoped, Base):
    __tablename__ = "offer_redemptions"
    __table_args__ = (Index("ix_offer_redemptions_offer_customer", "offer_id", "customer_id"), TENANT_RLS)

    id = uuid_pk()
    offer_id = Column(UUID(as_uuid=True), ForeignKey("offers.id"), nullable=False)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False, unique=True)
    customer_id = Column(UUID(as_uuid=True), ForeignKey("customers.id"), nullable=True)
    discount_amount = Column(Numeric(10, 2), default=0, server_default="0", nullable=False)
    created_at = created_at_column()

class EmailTemplate(TenantScoped, Base):
    """A business's customised version of a built-in email (app/services/email/templates.py has the defaults)."""
    __tablename__ = "email_templates"
    __table_args__ = (UniqueConstraint("tenant_id", "key", name="uq_email_templates_tenant_key"), TENANT_RLS)

    id = uuid_pk()
    key = Column(String, nullable=False)  # loyalty_reward, offer_announcement, order_receipt, welcome
    subject = Column(String, nullable=False)
    heading = Column(String, nullable=False)
    body = Column(Text, nullable=False)  # plain text with {placeholders}; escaped when rendered
    button_text = Column(String, nullable=True)
    button_url = Column(String, nullable=True)
    accent_color = Column(String, nullable=True)
    enabled = Column(Boolean, default=True, server_default="true", nullable=False)
    updated_at = updated_at_column()

class EmailLog(TenantScoped, Base):
    __tablename__ = "email_logs"
    __table_args__ = (Index("ix_email_logs_tenant_created", "tenant_id", "created_at"), TENANT_RLS)

    id = uuid_pk()
    to_email = Column(String, nullable=False)
    template_key = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    status = Column(String, default="queued", server_default="queued", nullable=False)  # queued, sent, failed, skipped
    error = Column(Text, nullable=True)
    customer_id = Column(UUID(as_uuid=True), nullable=True)
    order_id = Column(UUID(as_uuid=True), nullable=True)
    offer_id = Column(UUID(as_uuid=True), nullable=True)
    context = Column(JSON, nullable=True)  # placeholder values captured when queued
    created_at = created_at_column()
    sent_at = Column(DateTime, nullable=True)
