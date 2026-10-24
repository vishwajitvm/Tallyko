"""All ORM models. Import from here: ``from app.models import Order, Product``.

Modules by domain:
  accounts   – global_vendors, tenant_configs, subscriptions, global_users (not tenant-scoped)
  business   – locations, users (staff), business_settings, tenant_counters, brands, sales_channels
  catalog    – product_categories, products, product_variants
  sales      – tables, customers, orders, kots, order_items, payments
  inventory  – inventory_logs
  access     – roles, audit_logs
  marketing  – offers, offer_redemptions, email_templates, email_logs
  platform   – plans, platform_audit_logs (super admin; not tenant-scoped)
  tax        – tax_presets, tax_preset_rates (platform GST library), tax_classes, tax_class_rates (per business)
"""
from app.models.base import Base, NAMING_CONVENTION, TENANT_RLS, child_rls
from app.models.accounts import GlobalVendor, TenantConfig, Subscription, GlobalUser, UserSession
from app.models.business import Location, TenantUser, BusinessSettings, TenantCounter, Brand, SalesChannel
from app.models.catalog import ProductCategory, Product, ProductVariant, ProductVersion
from app.models.sales import TableEntity, Customer, Order, KOT, OrderItem, Payment
from app.models.inventory import InventoryLog
from app.models.access import Role, AuditLog
from app.models.marketing import Offer, OfferRedemption, EmailTemplate, EmailLog
from app.models.platform import OwnerRequest, Plan, PlatformAuditLog, PlatformSetting, SubscriptionOffer, SubscriptionRequest
from app.models.tax import TaxPreset, TaxPresetRate, TaxClass, TaxClassRate

__all__ = [
    "Base", "NAMING_CONVENTION", "TENANT_RLS", "child_rls",
    "GlobalVendor", "TenantConfig", "Subscription", "GlobalUser", "UserSession",
    "PlatformSetting", "SubscriptionOffer", "SubscriptionRequest", "OwnerRequest", "ProductVersion",
    "Location", "TenantUser", "BusinessSettings", "TenantCounter", "Brand", "SalesChannel",
    "ProductCategory", "Product", "ProductVariant",
    "TableEntity", "Customer", "Order", "KOT", "OrderItem", "Payment",
    "InventoryLog",
    "Role", "AuditLog",
    "Offer", "OfferRedemption", "EmailTemplate", "EmailLog",
    "Plan", "PlatformAuditLog",
    "TaxPreset", "TaxPresetRate", "TaxClass", "TaxClassRate",
]
