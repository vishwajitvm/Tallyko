"""Dining tables, customers, orders, order lines, payments and kitchen tickets."""
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.models.base import Base, TENANT_RLS, TenantScoped, child_rls, created_at_column, updated_at_column, uuid_pk

class TableEntity(TenantScoped, Base):
    __tablename__ = "tables"
    __table_args__ = (TENANT_RLS,)

    id = uuid_pk()
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False)
    table_number = Column(String, nullable=False)
    section = Column(String, nullable=True)
    capacity = Column(Integer, default=4, nullable=False)
    status = Column(String, default="free", server_default="free", nullable=False)  # free, occupied
    current_order_id = Column(UUID(as_uuid=True), nullable=True)
    assigned_staff_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)  # waiter / captain for this table
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    updated_at = updated_at_column()

class Customer(TenantScoped, Base):
    """A shop's customer (saved automatically from bills with a phone number) with loyalty balance."""
    __tablename__ = "customers"
    __table_args__ = (Index("ix_customers_tenant_phone", "tenant_id", "phone"), TENANT_RLS)

    id = uuid_pk()
    name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    email = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    marketing_opt_in = Column(Boolean, default=False, server_default="false", nullable=False)  # consent for offer emails
    points = Column(Integer, default=0, nullable=False)
    total_spent = Column(Numeric(12, 2), default=0, server_default="0", nullable=False)
    visits = Column(Integer, default=0, server_default="0", nullable=False)
    last_visit_at = Column(DateTime, nullable=True)
    created_at = created_at_column()
    updated_at = updated_at_column()

class Order(TenantScoped, Base):
    """A bill. Status: placed (online, awaiting acceptance) -> open (running) -> completed | cancelled.
    Kitchen progress lives on KOTs, not here."""
    __tablename__ = "orders"
    __table_args__ = (
        Index("ix_orders_tenant_created", "tenant_id", "created_at"),
        UniqueConstraint("tenant_id", "code", name="uq_orders_tenant_code"),
        TENANT_RLS,
    )

    id = uuid_pk()
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False)
    table_id = Column(UUID(as_uuid=True), ForeignKey("tables.id"), nullable=True)
    customer_id = Column(UUID(as_uuid=True), ForeignKey("customers.id"), nullable=True)
    brand_id = Column(UUID(as_uuid=True), ForeignKey("brands.id"), nullable=True)
    code = Column(String, nullable=True)  # short code printed as the bill barcode; derived from id so it works offline
    invoice_no = Column(String, nullable=True)
    token_no = Column(Integer, nullable=True)
    type = Column(String, nullable=False)  # DINE_IN, TAKEAWAY, DELIVERY, RETAIL_WALKIN
    channel = Column(String, default="POS", server_default="POS", nullable=False)
    external_order_id = Column(String, nullable=True)
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
    created_by = Column(UUID(as_uuid=True), nullable=True)  # login (global user) that created it
    waiter_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)  # staff who took / serves the order
    settled_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)  # staff who collected the final payment
    offer_id = Column(UUID(as_uuid=True), ForeignKey("offers.id"), nullable=True)
    offer_name = Column(String, nullable=True)
    offer_discount = Column(Numeric(10, 2), default=0, server_default="0", nullable=False)  # part of discount_amount from the offer
    bill_type = Column(String, default="tax_invoice", server_default="tax_invoice", nullable=False)  # tax_invoice | bill_of_supply
    supply_type = Column(String, default="intra", server_default="intra", nullable=False)  # intra (CGST+SGST) | inter (IGST)
    bill_label = Column(String, nullable=True)  # tells bills on one table apart: "Bill 2", "Window seat", a guest's name
    # Archived by Tallyko on the owner's request (e.g. test bills): hidden from lists and reports, never deleted by the business
    archived_at = Column(DateTime, nullable=True)
    archived_reason = Column(String, nullable=True)
    # A customer's "I've paid by UPI" from the table QR page, waiting for staff to confirm against their UPI app:
    # {"method": "UPI", "amount": 334.0, "reference": "4091…", "at": "…"}; cleared when confirmed or rejected
    payment_claim = Column(JSON, nullable=True)
    guests = Column(Integer, nullable=True)  # covers
    created_at = created_at_column(server_default=False)
    completed_at = Column(DateTime, nullable=True)
    updated_at = updated_at_column()

    items = relationship("OrderItem", back_populates="order", order_by="OrderItem.created_at")
    payments = relationship("Payment", back_populates="order", order_by="Payment.created_at")

class KOT(TenantScoped, Base):
    """Kitchen order ticket: one per batch of items sent to the kitchen."""
    __tablename__ = "kots"
    __table_args__ = (TENANT_RLS,)

    id = uuid_pk()
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False)
    kot_no = Column(Integer, nullable=True)
    status = Column(String, default="pending", nullable=False)  # pending, preparing, ready, served, cancelled
    created_at = created_at_column(server_default=False)
    updated_at = updated_at_column()

    order = relationship("Order")

class OrderItem(Base):
    """A bill line with name/price/tax snapshotted at sale time (menu edits never change old bills)."""
    __tablename__ = "order_items"
    __table_args__ = (child_rls("order_id", "orders"),)

    id = uuid_pk()
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False, index=True)
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    variant_id = Column(UUID(as_uuid=True), ForeignKey("product_variants.id"), nullable=True)
    kot_id = Column(UUID(as_uuid=True), ForeignKey("kots.id"), nullable=True)
    name = Column(String, nullable=True)
    variant_name = Column(String, nullable=True)
    quantity = Column(Integer, default=1, nullable=False)
    unit_price = Column(Numeric(10, 2), nullable=False)
    tax_rate = Column(Numeric(5, 2), default=0, server_default="0", nullable=False)
    tax_amount = Column(Numeric(10, 2), default=0, server_default="0", nullable=False)
    tax_components = Column(JSON, nullable=True)  # snapshot: [{"name": "CGST", "rate": 2.5, "amount": 4.5}, …]
    hsn_sac = Column(String, nullable=True)
    subtotal = Column(Numeric(10, 2), nullable=False)  # line total as charged (incl. tax if prices include tax)
    notes = Column(String, nullable=True)
    # Kitchen progress per line: pending → preparing → ready → served; void = cancelled (not billed). Null = not a kitchen item.
    kitchen_status = Column(String, nullable=True)
    status_at = Column(DateTime, nullable=True)
    void_reason = Column(String, nullable=True)
    voided_by = Column(UUID(as_uuid=True), nullable=True)
    comp_reason = Column(String, nullable=True)  # complimentary ("on the house"): unit price set to 0
    comp_value = Column(Numeric(10, 2), nullable=True)  # what it would have cost, for reports
    created_at = created_at_column()

    order = relationship("Order", back_populates="items")
    product = relationship("Product")
    variant = relationship("ProductVariant")

class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (child_rls("order_id", "orders"),)

    id = uuid_pk()
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False, index=True)
    method = Column(String, nullable=False)  # CASH, CARD, UPI, WALLET, AGGREGATOR, CREDIT, OTHER
    amount = Column(Numeric(10, 2), nullable=False)
    reference = Column(String, nullable=True)
    created_at = created_at_column()

    order = relationship("Order", back_populates="payments")
