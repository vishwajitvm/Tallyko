from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from fastapi import HTTPException, status
from app.models.models import GlobalVendor, GlobalUser, TenantConfig, TenantUser, Location
from app.schemas.auth import VendorSignupRequest, LoginRequest, TokenResponse
from app.core.security import get_password_hash, verify_password, create_access_token, create_refresh_token
from app.core.tenant import SharedSessionLocal

from sqlalchemy.exc import IntegrityError

async def register_vendor(signup_data: VendorSignupRequest):
    async with SharedSessionLocal() as session:
        try:
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
        except IntegrityError as e:
            await session.rollback()
            raise HTTPException(status_code=400, detail="A user with this email or phone number already exists.")
        except Exception as e:
            await session.rollback()
            raise e

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
        
        access_token = create_access_token(data=token_data)
        refresh_token_str = create_refresh_token(data={"sub": str(user.id)})
        
        return TokenResponse(
            success=True,
            access_token=access_token,
            refresh_token=refresh_token_str,
            tenant_id=tenant_user.tenant_id,
            role=tenant_user.role
        )

from app.schemas.auth import RefreshRequest, InviteRequest
from jose import jwt, JWTError
from app.core.config import settings

async def refresh_token(refresh_data: RefreshRequest) -> TokenResponse:
    try:
        payload = jwt.decode(refresh_data.refresh_token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id = payload.get("sub")
        token_type = payload.get("type")
        if user_id is None or token_type != "refresh":
            raise HTTPException(status_code=401, detail="Invalid refresh token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    async with SharedSessionLocal() as session:
        # Fetch the user and tenant logic similar to login
        user_result = await session.execute(select(GlobalUser).where(GlobalUser.id == user_id))
        user = user_result.scalars().first()
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
            
        tenant_result = await session.execute(
            select(TenantUser).where(TenantUser.username == user.email)
        )
        tenant_user = tenant_result.scalars().first()
        if not tenant_user:
            raise HTTPException(status_code=401, detail="User is not associated with any tenant")
            
        token_data = {
            "sub": str(user.id),
            "tenant_id": str(tenant_user.tenant_id),
            "role": tenant_user.role
        }
        
        access_token = create_access_token(data=token_data)
        new_refresh_token_str = create_refresh_token(data={"sub": str(user.id)})
        
        return TokenResponse(
            success=True,
            access_token=access_token,
            refresh_token=new_refresh_token_str,
            tenant_id=tenant_user.tenant_id,
            role=tenant_user.role
        )

async def invite_user(invite_data: InviteRequest, tenant_id: str):
    async with SharedSessionLocal() as session:
        # Check if they are already in the system globally
        existing_user = await session.execute(
            select(GlobalUser).where(GlobalUser.email == invite_data.email)
        )
        user = existing_user.scalars().first()
        
        if not user:
            # We would typically send an invite email here with a signup link.
            # But we'll create a stub global user for now without a password so they can set it later.
            user = GlobalUser(
                email=invite_data.email,
                phone="",
                password_hash="" # Requires a password set flow in real world
            )
            session.add(user)
            await session.flush()
            
        # Add them to the tenant
        existing_tenant_user = await session.execute(
            select(TenantUser).where(TenantUser.username == invite_data.email).where(TenantUser.tenant_id == tenant_id)
        )
        if existing_tenant_user.scalars().first():
            raise HTTPException(status_code=400, detail="User is already part of this tenant")
            
        tenant_user = TenantUser(
            tenant_id=tenant_id,
            username=invite_data.email,
            role=invite_data.role,
            password_hash=user.password_hash
        )
        session.add(tenant_user)
        await session.commit()
        return {"success": True, "message": f"Successfully invited {invite_data.email} as {invite_data.role}"}
