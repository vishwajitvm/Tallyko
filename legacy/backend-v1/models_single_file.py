import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Numeric, Boolean, Integer, JSON, Text, UniqueConstraint, Index, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

def _updated_at():
    return Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, server_default=func.now(), nullable=False)

# --- GLOBAL SCHEMA ---

class GlobalVendor(Base):
    __tablename__ = "global_vendors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    plan_type = Column(String, nullable=False)  # 'free', 'premium', 'lifetime'
    business_type = Column(String, nullable=True)  # 'restaurant', 'retail', 'cloud_kitchen'
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    tenant_configs = relationship("TenantConfig", back_populates="vendor", cascade="all, delete-orphan")
    subscriptions = relationship("Subscription", back_populates="vendor", cascade="all, delete-orphan")


class TenantConfig(Base):
    __tablename__ = "tenant_configs"

    vendor_id = Column(UUID(as_uuid=True), ForeignKey("global_vendors.id"), primary_key=True)
    db_url = Column(String, nullable=True)  # Nullable means default to shared DB
    status = Column(String, default="active", nullable=False)  # 'active', 'suspended'

    vendor = relationship("GlobalVendor", back_populates="tenant_configs")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vendor_id = Column(UUID(as_uuid=True), ForeignKey("global_vendors.id"), nullable=False)
    snap_entitlements = Column(JSON, nullable=False)  # Snapshotted JSON entitlements
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)

    vendor = relationship("GlobalVendor", back_populates="subscriptions")


class GlobalUser(Base):
    __tablename__ = "global_users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, index=True, nullable=False)
    phone = Column(String, unique=True, index=True, nullable=True)
    full_name = Column(String, nullable=True)
    password_hash = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


# --- TENANT SCHEMA (Shared or Dedicated) ---

class BusinessSettings(Base):
    __tablename__ = "business_settings"

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
    default_tax_rate = Column(Numeric(5, 2), default=5, server_default="5", nullable=False)
    invoice_prefix = Column(String, default="INV", server_default="INV", nullable=False)
    receipt_footer = Column(Text, nullable=True)
    loyalty_enabled = Column(Boolean, default=True, server_default="true", nullable=False)
    loyalty_points_per_100 = Column(Integer, default=1, server_default="1", nullable=False)  # points earned per ₹100
    loyalty_point_value = Column(Numeric(10, 2), default=1, server_default="1", nullable=False)  # ₹ per point redeemed
    store_enabled = Column(Boolean, default=False, server_default="false", nullable=False)
    qr_ordering_enabled = Column(Boolean, default=False, server_default="false", nullable=False)
    low_stock_default = Column(Integer, default=10, server_default="10", nullable=False)
    updated_at = _updated_at()


class TenantCounter(Base):
    """Atomic per-tenant sequences (invoice numbers, daily tokens, KOT numbers, internal barcodes)."""
    __tablename__ = "tenant_counters"

    tenant_id = Column(UUID(as_uuid=True), primary_key=True)
    name = Column(String, primary_key=True)
    value = Column(Integer, default=0, nullable=False)


class Location(Base):
    __tablename__ = "locations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    name = Column(String, nullable=False)
    address = Column(String, nullable=True)


class TenantUser(Base):
    __tablename__ = "users"  # Tenant specific staff users

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    username = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    role = Column(String, nullable=False)  # 'owner', 'manager', 'cashier', 'waiter', 'kitchen'
    password_hash = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)


class Brand(Base):
    """Virtual brands for cloud kitchens (one kitchen, several storefronts)."""
    __tablename__ = "brands"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)
    updated_at = _updated_at()


class SalesChannel(Base):
    """Where orders come from: POS, QR table ordering, own online store, and aggregators."""
    __tablename__ = "sales_channels"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_sales_channels_tenant_code"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    code = Column(String, nullable=False)  # POS, QR, ONLINE, SWIGGY, ZOMATO, ONDC, MAGICPIN, OTHER
    name = Column(String, nullable=False)
    enabled = Column(Boolean, default=True, server_default="true", nullable=False)
    commission_pct = Column(Numeric(5, 2), default=0, server_default="0", nullable=False)
    price_adjust_pct = Column(Numeric(5, 2), default=0, server_default="0", nullable=False)  # menu markup on this channel
    external_store_id = Column(String, nullable=True)
    webhook_secret = Column(String, nullable=True)
    auto_accept = Column(Boolean, default=False, server_default="false", nullable=False)
    updated_at = _updated_at()


class ProductCategory(Base):
    __tablename__ = "product_categories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    name = Column(String, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    updated_at = _updated_at()


class Product(Base):
    __tablename__ = "products"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    category_id = Column(UUID(as_uuid=True), ForeignKey("product_categories.id"), nullable=True)
    brand_id = Column(UUID(as_uuid=True), ForeignKey("brands.id"), nullable=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    base_price = Column(Numeric(10, 2), nullable=False)
    cost_price = Column(Numeric(10, 2), nullable=True)
    tax_rate = Column(Numeric(5, 2), nullable=True)  # NULL = business default
    barcode = Column(String, nullable=True, index=True)
    sku = Column(String, nullable=True)
    unit = Column(String, default="pcs", server_default="pcs", nullable=False)
    is_veg = Column(Boolean, nullable=True)
    print_to_kitchen = Column(Boolean, default=False, nullable=False)
    track_stock = Column(Boolean, default=False, server_default="false", nullable=False)
    low_stock_threshold = Column(Integer, nullable=True)
    sort_order = Column(Integer, default=0, server_default="0", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)
    updated_at = _updated_at()

    category = relationship("ProductCategory")
    variants = relationship("ProductVariant", back_populates="product", order_by="ProductVariant.sort_order")


class ProductVariant(Base):
    __tablename__ = "product_variants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    variant_name = Column(String, nullable=False)
    price_modifier = Column(Numeric(10, 2), default=0.00, nullable=False)
    sort_order = Column(Integer, default=0, server_default="0", nullable=False)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)

    product = relationship("Product", back_populates="variants")


class TableEntity(Base):
    __tablename__ = "tables"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False)
    table_number = Column(String, nullable=False)
    section = Column(String, nullable=True)
    capacity = Column(Integer, default=4, nullable=False)
    status = Column(String, default="free", server_default="free", nullable=False)  # free, occupied
    current_order_id = Column(UUID(as_uuid=True), nullable=True)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    updated_at = _updated_at()


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        Index("ix_orders_tenant_created", "tenant_id", "created_at"),
        UniqueConstraint("tenant_id", "code", name="uq_orders_tenant_code"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False)
    table_id = Column(UUID(as_uuid=True), ForeignKey("tables.id"), nullable=True)
    customer_id = Column(UUID(as_uuid=True), ForeignKey("customers.id"), nullable=True)
    brand_id = Column(UUID(as_uuid=True), ForeignKey("brands.id"), nullable=True)
    code = Column(String, nullable=True)  # short code printed as the bill barcode; derived from id so it works offline
    invoice_no = Column(String, nullable=True)
    token_no = Column(Integer, nullable=True)
    type = Column(String, nullable=False)  # 'DINE_IN', 'TAKEAWAY', 'DELIVERY', 'RETAIL_WALKIN'
    channel = Column(String, default="POS", server_default="POS", nullable=False)
    external_order_id = Column(String, nullable=True)
    # open -> (placed -> accepted ->) preparing -> ready -> completed ; or cancelled
    status = Column(String, default="pending", nullable=False)
    payment_status = Column(String, default="unpaid", server_default="unpaid", nullable=False)  # unpaid, partial, paid
    customer_name = Column(String, nullable=True)
    customer_phone = Column(String, nullable=True)
    delivery_address = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    subtotal = Column(Numeric(10, 2), default=0, server_default="0", nullable=False)
    discount_amount = Column(Numeric(10, 2), default=0, server_default="0", nullable=False)
    tax_amount = Column(Numeric(10, 2), default=0, server_default="0", nullable=False)
    round_off = Column(Numeric(10, 2), default=0, server_default="0", nullable=False)
    total_amount = Column(Numeric(10, 2), nullable=False)
    commission_amount = Column(Numeric(10, 2), default=0, server_default="0", nullable=False)
    loyalty_points_earned = Column(Integer, default=0, server_default="0", nullable=False)
    loyalty_points_redeemed = Column(Integer, default=0, server_default="0", nullable=False)
    stock_deducted = Column(Boolean, default=False, server_default="false", nullable=False)
    cancel_reason = Column(Text, nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    updated_at = _updated_at()

    items = relationship("OrderItem", back_populates="order", order_by="OrderItem.created_at")
    payments = relationship("Payment", back_populates="order", order_by="Payment.created_at")


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False, index=True)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    variant_id = Column(UUID(as_uuid=True), ForeignKey("product_variants.id"), nullable=True)
    kot_id = Column(UUID(as_uuid=True), ForeignKey("kots.id"), nullable=True)
    name = Column(String, nullable=True)  # snapshot at sale time
    variant_name = Column(String, nullable=True)
    quantity = Column(Integer, default=1, nullable=False)
    unit_price = Column(Numeric(10, 2), nullable=False)
    tax_rate = Column(Numeric(5, 2), default=0, server_default="0", nullable=False)
    tax_amount = Column(Numeric(10, 2), default=0, server_default="0", nullable=False)
    subtotal = Column(Numeric(10, 2), nullable=False)  # line total as charged (incl. tax if prices include tax)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)

    order = relationship("Order", back_populates="items")
    product = relationship("Product")
    variant = relationship("ProductVariant")


class Payment(Base):
    __tablename__ = "payments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False, index=True)
    method = Column(String, nullable=False)  # 'CASH', 'CARD', 'UPI', 'WALLET', 'AGGREGATOR', 'CREDIT'
    amount = Column(Numeric(10, 2), nullable=False)
    reference = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)

    order = relationship("Order", back_populates="payments")


class InventoryLog(Base):
    __tablename__ = "inventory_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False)
    quantity_change = Column(Integer, nullable=False)
    reason = Column(String, nullable=False)  # 'sale', 'wastage', 'restock', 'adjustment', 'return'
    note = Column(String, nullable=True)
    unit_cost = Column(Numeric(10, 2), nullable=True)
    order_id = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)


class Customer(Base):
    __tablename__ = "customers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    email = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    points = Column(Integer, default=0, nullable=False)
    total_spent = Column(Numeric(12, 2), default=0, server_default="0", nullable=False)
    visits = Column(Integer, default=0, server_default="0", nullable=False)
    last_visit_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)
    updated_at = _updated_at()

class KOT(Base):
    __tablename__ = "kots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    kot_no = Column(Integer, nullable=True)
    status = Column(String, default="pending", nullable=False) # pending, preparing, ready, served, cancelled
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = _updated_at()

    order = relationship("Order")
