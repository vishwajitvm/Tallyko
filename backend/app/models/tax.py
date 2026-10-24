"""GST: platform rate library (presets) and per-business tax classes, both with dated rate versions.

Why versions: rates change by government notification (e.g. GST 2.0 from 22 Sep 2025). A new version with an
`effective_from` date switches bills automatically at that moment, while every bill line keeps the exact
rate/components it was issued with (order_items.tax_components), so old invoices never change.
"""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.models.base import Base, TENANT_RLS, TenantScoped, child_rls, created_at_column, updated_at_column, uuid_pk

class TaxPreset(Base):
    """Platform-wide GST slab maintained by the super admin (e.g. GST_5, GST_18). Not tenant data."""
    __tablename__ = "tax_presets"

    key = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    hsn_sac = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    sort_order = Column(Integer, default=0, server_default="0", nullable=False)
    created_at = created_at_column()
    updated_at = updated_at_column()

class TaxPresetRate(Base):
    """A dated version of a preset's rate. Publishing one propagates to every business class that follows the preset."""
    __tablename__ = "tax_preset_rates"
    __table_args__ = (UniqueConstraint("preset_key", "effective_from", name="uq_tax_preset_rates_preset_effective"),)

    id = uuid_pk()
    preset_key = Column(String, ForeignKey("tax_presets.key"), nullable=False, index=True)
    effective_from = Column(DateTime, nullable=False)
    components = Column(JSON, nullable=False)  # [{"name": "CGST", "rate": 2.5}, {"name": "SGST", "rate": 2.5}]
    total_rate = Column(Numeric(5, 2), nullable=False)
    note = Column(Text, nullable=True)  # e.g. "Notification 9/2025-CT(Rate)"
    created_at = created_at_column()

class TaxClass(TenantScoped, Base):
    """A business's tax category that products point to (instead of a raw rate on every product)."""
    __tablename__ = "tax_classes"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_tax_classes_tenant_code"), TENANT_RLS)

    id = uuid_pk()
    name = Column(String, nullable=False)  # "GST 5% – Restaurant service"
    code = Column(String, nullable=False)  # GST5, GST18, EXEMPT …
    hsn_sac = Column(String, nullable=True)  # printed on invoices
    preset_key = Column(String, nullable=True)  # follows a platform preset
    follow_preset = Column(Boolean, default=True, server_default="true", nullable=False)  # apply the platform's rate changes automatically
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    created_at = created_at_column()
    updated_at = updated_at_column()

    rates = relationship("TaxClassRate", order_by="TaxClassRate.effective_from", cascade="all, delete-orphan")

class TaxClassRate(Base):
    __tablename__ = "tax_class_rates"
    __table_args__ = (UniqueConstraint("tax_class_id", "effective_from", name="uq_tax_class_rates_class_effective"),
                      child_rls("tax_class_id", "tax_classes"))

    id = uuid_pk()
    tax_class_id = Column(UUID(as_uuid=True), ForeignKey("tax_classes.id"), nullable=False, index=True)
    effective_from = Column(DateTime, nullable=False)
    components = Column(JSON, nullable=False)
    total_rate = Column(Numeric(5, 2), nullable=False)
    note = Column(Text, nullable=True)
    source = Column(String, default="manual", server_default="manual", nullable=False)  # manual | preset
    created_at = created_at_column()
