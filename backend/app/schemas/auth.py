from typing import Literal
from pydantic import BaseModel, EmailStr, Field
from uuid import UUID

class VendorSignupRequest(BaseModel):
    vendor_name: str = Field(min_length=2, max_length=100)
    owner_name: str | None = Field(None, max_length=80)
    email: EmailStr
    phone: str = Field(pattern=r"^\+?[0-9 ]{6,16}$")
    password: str = Field(min_length=8, max_length=64)
    business_type: Literal["restaurant", "retail", "cloud_kitchen", "cafe"] = "restaurant"
    plan_type: Literal["free"] = "free"
    db_mode: Literal["shared"] = "shared"  # dedicated databases are provisioned by an operator, not self-serve

class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)  # email or phone number
    password: str = Field(min_length=1, max_length=128)

class UserInfo(BaseModel):
    id: str
    email: str
    full_name: str | None = None
    role: str | None = None
    staff_id: str | None = None

class TokenResponse(BaseModel):
    success: bool = True
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    account_type: Literal["business", "platform"] = "business"
    tenant_id: UUID | None = None  # null for platform (super admin / support) logins
    role: str | None = None
    platform_role: str | None = None
    user: UserInfo | None = None
    business_name: str | None = None
    subscription: dict | None = None  # {"state": trial|active|grace|lapsed, "paid_until", "days_left", "locked"}

class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=10, max_length=2048)

class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=64)
