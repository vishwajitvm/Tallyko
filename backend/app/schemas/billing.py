from datetime import datetime
from typing import List, Literal
from uuid import UUID
from pydantic import BaseModel, Field, field_validator, model_validator

OrderType = Literal["DINE_IN", "TAKEAWAY", "DELIVERY", "RETAIL_WALKIN"]
PaymentMethod = Literal["CASH", "CARD", "UPI", "WALLET", "AGGREGATOR", "CREDIT", "OTHER"]
PHONE_PATTERN = r"^\+?[0-9 ]{6,16}$"

class OrderItemIn(BaseModel):
    product_id: UUID
    variant_id: UUID | None = None
    quantity: int = Field(ge=1, le=9999)
    notes: str | None = Field(None, max_length=200)

class PaymentIn(BaseModel):
    method: PaymentMethod
    amount: float = Field(gt=0, le=10_000_000)
    reference: str | None = Field(None, max_length=100)

class DiscountIn(BaseModel):
    type: Literal["flat", "percent"]
    value: float = Field(ge=0, le=10_000_000)

    @model_validator(mode="after")
    def _percent_range(self):
        if self.type == "percent" and self.value > 100:
            raise ValueError("Percent discount cannot exceed 100")
        return self

class OrderCreate(BaseModel):
    id: UUID | None = None  # client-generated so offline retries are idempotent
    order_type: OrderType = "TAKEAWAY"
    channel: str = Field("POS", max_length=20)
    table_id: UUID | None = None
    customer_id: UUID | None = None
    customer_name: str | None = Field(None, max_length=100)
    customer_phone: str | None = Field(None, pattern=PHONE_PATTERN)
    delivery_address: str | None = Field(None, max_length=500)
    notes: str | None = Field(None, max_length=500)
    brand_id: UUID | None = None
    external_order_id: str | None = Field(None, max_length=64)
    items: List[OrderItemIn] = Field(min_length=1, max_length=200)
    discount: DiscountIn | None = None
    redeem_points: int = Field(0, ge=0, le=1_000_000)
    payments: List[PaymentIn] = Field(default_factory=list, max_length=10)
    send_to_kitchen: bool = True
    created_at: datetime | None = None  # original time for orders taken offline
    offer_id: UUID | None = None  # apply this offer (server re-checks eligibility)
    offer_code: str | None = Field(None, max_length=32)  # coupon code quoted by the customer
    auto_offers: bool = True  # apply the best auto-apply offer when no offer is chosen
    waiter_id: UUID | None = None  # staff serving the order (defaults to whoever creates it)
    supply_type: Literal["intra", "inter"] = "intra"  # inter-state supply → IGST instead of CGST+SGST
    new_bill: bool = False  # the table already has a bill: open another one on it (shared table, separate cheques)
    bill_label: str | None = Field(None, max_length=40)
    guests: int | None = Field(None, ge=1, le=500)

    @field_validator("channel")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.strip().upper()

class OrderAddItems(BaseModel):
    items: List[OrderItemIn] = Field(min_length=1, max_length=200)
    send_to_kitchen: bool = True

class OrderPay(BaseModel):
    payments: List[PaymentIn] = Field(min_length=1, max_length=10)
    discount: DiscountIn | None = None
    redeem_points: int | None = Field(None, ge=0, le=1_000_000)
    offer_id: UUID | None = None  # apply / change the offer before paying
    remove_offer: bool = False

class OrderOffer(BaseModel):
    offer_id: UUID | None = None  # null + remove=True removes the current offer
    offer_code: str | None = Field(None, max_length=32)
    remove: bool = False

class OrderCancel(BaseModel):
    reason: str = Field(min_length=2, max_length=300)

class OrderTransfer(BaseModel):
    table_id: UUID

class OrderCustomer(BaseModel):
    customer_id: UUID | None = None
    customer_name: str | None = Field(None, max_length=100)
    customer_phone: str | None = Field(None, pattern=PHONE_PATTERN)


# --- Running bills on the floor (see app/services/floor_service.py) ---

class ItemQty(BaseModel):
    item_id: UUID
    quantity: int | None = Field(None, ge=1, le=10_000)  # part of a line; empty = the whole line

class ItemsStatus(BaseModel):
    item_ids: List[UUID] = Field(min_length=1, max_length=200)
    status: Literal["pending", "preparing", "ready", "served"]

class ItemsVoid(BaseModel):
    items: List[ItemQty] = Field(min_length=1, max_length=200)
    reason: str | None = Field(None, max_length=200)  # required for items the kitchen already has
    waste: bool = False  # it was already made: book it as wastage in stock

class ItemsComp(BaseModel):
    items: List[ItemQty] = Field(min_length=1, max_length=200)
    reason: str = Field(min_length=2, max_length=200)

class ItemsMove(BaseModel):
    items: List[ItemQty] = Field(min_length=1, max_length=200)
    target_order_id: UUID | None = None  # another open bill; empty = a new bill on the same table
    new_bill_label: str | None = Field(None, max_length=40)

class BillMerge(BaseModel):
    source_order_id: UUID  # this bill's items move into the bill in the URL; it closes as "merged"

class BillDetails(BaseModel):
    bill_label: str | None = Field(None, max_length=40)
    guests: int | None = Field(None, ge=1, le=500)
