import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Numeric, Boolean, Integer, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

# --- GLOBAL SCHEMA ---

class GlobalVendor(Base):
    __tablename__ = "global_vendors"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    plan_type = Column(String, nullable=False)  # 'free', 'premium', 'lifetime'
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
    phone = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


# --- TENANT SCHEMA (Shared or Dedicated) ---

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
    role = Column(String, nullable=False)  # 'owner', 'manager', 'cashier', 'kitchen'
    password_hash = Column(String, nullable=False)


class ProductCategory(Base):
    __tablename__ = "product_categories"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    name = Column(String, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)


class Product(Base):
    __tablename__ = "products"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    category_id = Column(UUID(as_uuid=True), ForeignKey("product_categories.id"), nullable=True)
    name = Column(String, nullable=False)
    base_price = Column(Numeric(10, 2), nullable=False)
    barcode = Column(String, nullable=True, index=True)
    print_to_kitchen = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    category = relationship("ProductCategory")


class ProductVariant(Base):
    __tablename__ = "product_variants"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    variant_name = Column(String, nullable=False)
    price_modifier = Column(Numeric(10, 2), default=0.00, nullable=False)

    product = relationship("Product")


class TableEntity(Base):
    __tablename__ = "tables"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False)
    table_number = Column(String, nullable=False)
    capacity = Column(Integer, default=4, nullable=False)


class Order(Base):
    __tablename__ = "orders"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False)
    table_id = Column(UUID(as_uuid=True), ForeignKey("tables.id"), nullable=True)
    total_amount = Column(Numeric(10, 2), nullable=False)
    type = Column(String, nullable=False)  # 'DINE_IN', 'TAKEAWAY', 'DELIVERY', 'RETAIL_WALKIN'
    status = Column(String, default="pending", nullable=False)  # 'pending', 'completed'


class OrderItem(Base):
    __tablename__ = "order_items"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    variant_id = Column(UUID(as_uuid=True), ForeignKey("product_variants.id"), nullable=True)
    quantity = Column(Integer, default=1, nullable=False)
    unit_price = Column(Numeric(10, 2), nullable=False)
    subtotal = Column(Numeric(10, 2), nullable=False)

    order = relationship("Order")
    product = relationship("Product")
    variant = relationship("ProductVariant")


class Payment(Base):
    __tablename__ = "payments"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    method = Column(String, nullable=False)  # 'CASH', 'CARD', 'UPI'
    amount = Column(Numeric(10, 2), nullable=False)

    order = relationship("Order")


class InventoryLog(Base):
    __tablename__ = "inventory_logs"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False)
    quantity_change = Column(Integer, nullable=False)
    reason = Column(String, nullable=False)  # 'sale', 'wastage', 'restock'


class Customer(Base):
    __tablename__ = "customers"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    email = Column(String, nullable=True)
    points = Column(Integer, default=0, nullable=False)

class KOT(Base):
    __tablename__ = "kots"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    status = Column(String, default="pending", nullable=False) # pending, preparing, ready
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    order = relationship("Order")
