"""Menu / product catalog."""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, JSON, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.models.base import Base, TENANT_RLS, TenantScoped, child_rls, created_at_column, updated_at_column, uuid_pk

class ProductCategory(TenantScoped, Base):
    __tablename__ = "product_categories"
    __table_args__ = (TENANT_RLS,)

    id = uuid_pk()
    name = Column(String, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    updated_at = updated_at_column()

class Product(TenantScoped, Base):
    """A menu item or retail SKU. ``tax_rate`` null means "use the business default GST rate"."""
    __tablename__ = "products"
    __table_args__ = (TENANT_RLS,)

    id = uuid_pk()
    category_id = Column(UUID(as_uuid=True), ForeignKey("product_categories.id"), nullable=True)
    brand_id = Column(UUID(as_uuid=True), ForeignKey("brands.id"), nullable=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    base_price = Column(Numeric(10, 2), nullable=False)
    cost_price = Column(Numeric(10, 2), nullable=True)
    tax_rate = Column(Numeric(5, 2), nullable=True)  # deprecated: use tax_class_id (kept for older data/apps)
    tax_class_id = Column(UUID(as_uuid=True), ForeignKey("tax_classes.id"), nullable=True)  # null = business default class
    barcode = Column(String, nullable=True, index=True)
    sku = Column(String, nullable=True)
    unit = Column(String, default="pcs", server_default="pcs", nullable=False)
    is_veg = Column(Boolean, nullable=True)
    print_to_kitchen = Column(Boolean, default=False, nullable=False)
    track_stock = Column(Boolean, default=False, server_default="false", nullable=False)
    low_stock_threshold = Column(Integer, nullable=True)
    sort_order = Column(Integer, default=0, server_default="0", nullable=False)
    # Per sales channel: {"SWIGGY": {"price": 260}, "ONLINE": {"available": false}} (see app/services/channel_menu.py)
    channel_prices = Column(JSON, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = created_at_column()
    updated_at = updated_at_column()

    category = relationship("ProductCategory")
    variants = relationship("ProductVariant", back_populates="product", order_by="ProductVariant.sort_order")

class ProductVariant(Base):
    """An option such as Half/Full or Small/Large. Price = product base price + ``price_modifier``."""
    __tablename__ = "product_variants"
    __table_args__ = (child_rls("product_id", "products"),)

    id = uuid_pk()
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    variant_name = Column(String, nullable=False)
    price_modifier = Column(Numeric(10, 2), default=0.00, nullable=False)
    sort_order = Column(Integer, default=0, server_default="0", nullable=False)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)

    product = relationship("Product", back_populates="variants")


class ProductVersion(TenantScoped, Base):
    """Every change to a menu item is a new version (append-only: the app's database role can't edit or delete these).
    Old bills keep their own price snapshot; this is the menu's history (who changed what, when, from → to)."""
    __tablename__ = "product_versions"
    __table_args__ = (UniqueConstraint("product_id", "version", name="uq_product_versions_product_version"), TENANT_RLS)

    id = uuid_pk()
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    snapshot = Column(JSON, nullable=False)  # name, prices, variants, tax class, channel prices, category, active…
    change = Column(String, nullable=False)  # "Price ₹220 → ₹240", "Created", "Hidden from menu", "Restored version 3"
    changed_by_staff_id = Column(UUID(as_uuid=True), nullable=True)
    changed_by_name = Column(String, nullable=True)
    created_at = created_at_column()
