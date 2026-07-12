from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from fastapi import HTTPException, status
from app.models.models import GlobalVendor, GlobalUser, TenantConfig, TenantUser, Location
from app.schemas.auth import VendorSignupRequest, LoginRequest, TokenResponse
from app.core.security import get_password_hash, verify_password, create_access_token
from app.core.tenant import SharedSessionLocal

async def register_vendor(signup_data: VendorSignupRequest):
    async with SharedSessionLocal() as session:
        # Check if user already exists globally
        existing_user = await session.execute(
            select(GlobalUser).where(GlobalUser.email == signup_data.email)
        )
        if existing_user.scalars().first():
            raise HTTPException(status_code=400, detail="Email already registered globally")

        # 1. Create Global Vendor
        new_vendor = GlobalVendor(
            name=signup_data.vendor_name,
            plan_type=signup_data.plan_type
        )
        session.add(new_vendor)
        await session.flush() # get new_vendor.id

        # 2. Create Global User
        hashed_pw = get_password_hash(signup_data.password)
        new_global_user = GlobalUser(
            email=signup_data.email,
            phone=signup_data.phone,
            password_hash=hashed_pw
        )
        session.add(new_global_user)

        # 3. Create Tenant Config (Shared or Dedicated DB logic)
        db_url = None
        if signup_data.db_mode == "dedicated":
            # For this scaffolding, we simulate a dedicated DB URL. In reality, this would provision a new RDS/Postgres instance.
            db_url = f"postgresql+asyncpg://postgres:password_to_change_in_prod@db:5432/tenant_{new_vendor.id}"
            
        tenant_config = TenantConfig(
            vendor_id=new_vendor.id,
            db_url=db_url,
            status="active"
        )
        session.add(tenant_config)
        
        # 4. Initialize Tenant-specific Admin User in the Shared DB (assuming shared for now)
        tenant_admin = TenantUser(
            tenant_id=new_vendor.id,
            username=signup_data.email,
            role="owner",
            password_hash=hashed_pw
        )
        session.add(tenant_admin)
        
        # 5. Initialize default location
        default_location = Location(
            tenant_id=new_vendor.id,
            name="Main Branch"
        )
        session.add(default_location)
        
        await session.commit()
        return {"message": "Vendor registered successfully", "vendor_id": str(new_vendor.id)}

async def authenticate_user(login_data: LoginRequest) -> TokenResponse:
    async with SharedSessionLocal() as session:
        # Check Global User (could also check TenantUser depending on routing strategy)
        result = await session.execute(
            select(GlobalUser).where(GlobalUser.email == login_data.email)
        )
        user = result.scalars().first()
        
        if not user or not verify_password(login_data.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid credentials")
            
        # We need the vendor_id. Since the user might own multiple vendors, for simplicity we look up the TenantUser entry
        # that matches the email (username) to find the primary tenant_id.
        tenant_result = await session.execute(
            select(TenantUser).where(TenantUser.username == login_data.email)
        )
        tenant_user = tenant_result.scalars().first()
        
        if not tenant_user:
            raise HTTPException(status_code=401, detail="User is not associated with any tenant")
            
        token_data = {
            "sub": str(user.id),
            "tenant_id": str(tenant_user.tenant_id),
            "role": tenant_user.role
        }
        
        token = create_access_token(data=token_data)
        
        return TokenResponse(
            access_token=token,
            tenant_id=tenant_user.tenant_id,
            role=tenant_user.role
        )
