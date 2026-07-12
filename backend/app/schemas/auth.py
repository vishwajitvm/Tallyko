from pydantic import BaseModel, EmailStr
from uuid import UUID

class VendorSignupRequest(BaseModel):
    vendor_name: str
    email: EmailStr
    phone: str
    password: str
    plan_type: str = "free"
    db_mode: str = "shared"  # 'shared' or 'dedicated'

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    success: bool = True
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    tenant_id: UUID
    role: str

class RefreshRequest(BaseModel):
    refresh_token: str

class InviteRequest(BaseModel):
    email: EmailStr
    role: str
