"""Per-business setup: branches, staff, settings, counters, sales channels and cloud-kitchen brands."""
from sqlalchemy import Boolean, Column, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from app.models.base import Base, TENANT_RLS, TenantScoped, created_at_column, updated_at_column, uuid_pk

class Location(TenantScoped, Base):
    """A branch/outlet. Every business starts with "Main Branch"."""
    __tablename__ = "locations"
    __table_args__ = (TENANT_RLS,)

    id = uuid_pk()
    name = Column(String, nullable=False)
    address = Column(String, nullable=True)

class TenantUser(TenantScoped, Base):
    """A login's membership and role in one business (``username`` = the login email)."""
    __tablename__ = "users"
    __table_args__ = (TENANT_RLS,)

    id = uuid_pk()
    username = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    role = Column(String, nullable=False)  # key of a row in `roles` (owner, manager, cashier, waiter, kitchen, custom…)
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=True)  # null = every branch
    password_hash = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    created_at = created_at_column()

class BusinessSettings(Base):
    """One row per business: receipt header, GST, UPI, loyalty, online ordering switches."""
    __tablename__ = "business_settings"
    __table_args__ = (TENANT_RLS,)

    tenant_id = Column(UUID(as_uuid=True), primary_key=True)
    business_name = Column(String, nullable=False)
    business_type = Column(String, default="restaurant", server_default="restaurant", nullable=False)
    address = Column(Text, nullable=True)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    gstin = Column(String, nullable=True)
    fssai = Column(String, nullable=True)
    upi_id = Column(String, nullable=True)
    currency_symbol = Column(String, default="₹", server_default="₹", nullable=False)
    prices_include_tax = Column(Boolean, default=False, server_default="false", nullable=False)
    default_tax_rate = Column(Numeric(5, 2), default=5, server_default="5", nullable=False)  # fallback when no tax class applies
    gst_registration = Column(String, default="regular", server_default="regular", nullable=False)  # regular | composition | unregistered
    default_tax_class_id = Column(UUID(as_uuid=True), ForeignKey("tax_classes.id"), nullable=True)
    invoice_prefix = Column(String, default="INV", server_default="INV", nullable=False)
    receipt_footer = Column(Text, nullable=True)
    loyalty_enabled = Column(Boolean, default=True, server_default="true", nullable=False)
    loyalty_points_per_100 = Column(Integer, default=1, server_default="1", nullable=False)  # points earned per ₹100
    loyalty_point_value = Column(Numeric(10, 2), default=1, server_default="1", nullable=False)  # ₹ per point redeemed
    store_enabled = Column(Boolean, default=False, server_default="false", nullable=False)
    qr_ordering_enabled = Column(Boolean, default=False, server_default="false", nullable=False)
    # How customers who order by scanning the table QR pay: "counter" (cash/card at the counter or to the waiter),
    # "upi" (pay now from their UPI app, staff confirm), or "both"
    qr_payment_mode = Column(String, default="both", server_default="both", nullable=False)
    # When the floor screens warn: {"table_amber_min": 45, "table_red_min": 75, "kitchen_amber_min": 10, "kitchen_red_min": 20,
    # "online_wait_min": 3}; missing keys use app.api.admin.OPS_DEFAULTS
    ops_thresholds = Column(JSON, nullable=True)
    low_stock_default = Column(Integer, default=10, server_default="10", nullable=False)
    disabled_modules = Column(JSON, nullable=True)  # modules the owner chose to hide (subset of their plan)
    email_enabled = Column(Boolean, default=True, server_default="true", nullable=False)
    email_sender_name = Column(String, nullable=True)
    email_reply_to = Column(String, nullable=True)
    updated_at = updated_at_column()

class TenantCounter(Base):
    """Atomic per-business sequences: invoice numbers (per financial year), daily tokens, KOT numbers, barcodes."""
    __tablename__ = "tenant_counters"
    __table_args__ = (TENANT_RLS,)

    tenant_id = Column(UUID(as_uuid=True), primary_key=True)
    name = Column(String, primary_key=True)
    value = Column(Integer, default=0, nullable=False)

class Brand(TenantScoped, Base):
    """Virtual brands for cloud kitchens (one kitchen, several storefronts)."""
    __tablename__ = "brands"
    __table_args__ = (TENANT_RLS,)

    id = uuid_pk()
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    created_at = created_at_column()
    updated_at = updated_at_column()

class SalesChannel(TenantScoped, Base):
    """Where orders come from: counter, QR tables, own online store, Swiggy/Zomato/ONDC/magicpin, phone."""
    __tablename__ = "sales_channels"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_sales_channels_tenant_code"), TENANT_RLS)

    id = uuid_pk()
    code = Column(String, nullable=False)  # POS, QR, ONLINE, SWIGGY, ZOMATO, ONDC, MAGICPIN, OTHER
    name = Column(String, nullable=False)
    enabled = Column(Boolean, default=True, server_default="true", nullable=False)
    commission_pct = Column(Numeric(5, 2), default=0, server_default="0", nullable=False)
    price_adjust_pct = Column(Numeric(5, 2), default=0, server_default="0", nullable=False)  # menu mark-up on this channel
    external_store_id = Column(String, nullable=True)
    webhook_secret = Column(String, nullable=True)
    auto_accept = Column(Boolean, default=False, server_default="false", nullable=False)
    updated_at = updated_at_column()
