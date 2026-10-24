import logging
import secrets
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.future import select
from fastapi import HTTPException
from app.models import GlobalVendor, GlobalUser, TenantConfig, TenantUser, Location, BusinessSettings, SalesChannel
from app.schemas.auth import VendorSignupRequest, LoginRequest, TokenResponse, RefreshRequest, ChangePasswordRequest, UserInfo
from app.core.security import (get_password_hash, verify_password, create_access_token, create_refresh_token, decode_token,
                               hash_password_async, verify_password_async)
from app.core.tenant import get_shared_session_maker
from app.services.settings_service import DEFAULT_CHANNELS, ensure_roles
from app.services.tax import ensure_tax_classes
from app.services.sessions import check_refreshable, start_session
from app.services.subscription import current_kind, get_platform_settings, start_trial, state_for

logger = logging.getLogger("tallyko")

# Constant-time-ish failure path: always run one bcrypt check so response time doesn't reveal valid emails
_DUMMY_HASH = get_password_hash(secrets.token_hex(16))

async def _issue_tokens(session, user: GlobalUser, tenant_user: TenantUser, session_id: str | None = None) -> TokenResponse:
    settings = (await session.execute(select(BusinessSettings).where(BusinessSettings.tenant_id == tenant_user.tenant_id))).scalars().first()
    if settings is None:
        vendor = await session.get(GlobalVendor, tenant_user.tenant_id)
        business_name = vendor.name if vendor else None
    else:
        business_name = settings.business_name
    config = await session.get(TenantConfig, tenant_user.tenant_id)
    version = (config.session_version if config else 1) or 1
    token_data = {"sub": str(user.id), "tenant_id": str(tenant_user.tenant_id), "role": tenant_user.role, "staff_id": str(tenant_user.id),
                  "sid": session_id, "sv": version}
    grace = int((await get_platform_settings(session)).get("grace_days") or 0)
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token({"sub": str(user.id), "sid": session_id, "sv": version}),
        subscription=state_for(config.paid_until if config else None, grace, await current_kind(session, tenant_user.tenant_id)),
        tenant_id=tenant_user.tenant_id,
        role=tenant_user.role,
        user=UserInfo(id=str(user.id), email=user.email, full_name=user.full_name or tenant_user.full_name, role=tenant_user.role,
                      staff_id=str(tenant_user.id)),
        business_name=business_name,
    )

def _issue_platform_tokens(user: GlobalUser, session_id: str | None = None) -> TokenResponse:
    """Tallyko staff (super admin / support): a token for the platform console only — never for a business."""
    return TokenResponse(
        access_token=create_access_token({"sub": str(user.id), "platform_role": user.platform_role, "email": user.email, "sid": session_id}),
        refresh_token=create_refresh_token({"sub": str(user.id), "sid": session_id}),
        account_type="platform", platform_role=user.platform_role,
        user=UserInfo(id=str(user.id), email=user.email, full_name=user.full_name),
    )

async def _tenant_user_for(session, user: GlobalUser) -> TenantUser:
    result = await session.execute(
        select(TenantUser).where(func.lower(TenantUser.username) == user.email.lower(), TenantUser.is_active == True)
        .order_by(TenantUser.created_at)
    )
    tenant_user = result.scalars().first()
    if not tenant_user:
        raise HTTPException(status_code=401, detail="This account is not active for any business")
    config = await session.get(TenantConfig, tenant_user.tenant_id)
    if config and config.status != "active":
        raise HTTPException(status_code=403, detail="This business account is suspended")
    return tenant_user

async def register_vendor(signup_data: VendorSignupRequest, user_agent: str | None = None, ip: str | None = None,
                          demo_days: int | None = None) -> TokenResponse:
    email = signup_data.email.lower()
    phone = signup_data.phone.replace(" ", "")
    maker = get_shared_session_maker()
    async with maker() as session:
        try:
            existing = await session.execute(select(GlobalUser).where(or_(func.lower(GlobalUser.email) == email, GlobalUser.phone == phone)))
            if existing.scalars().first():
                raise HTTPException(status_code=409, detail="An account with this email or phone number already exists")

            vendor = GlobalVendor(name=signup_data.vendor_name.strip(), plan_type=signup_data.plan_type, business_type=signup_data.business_type)
            session.add(vendor)
            await session.flush()

            hashed_pw = await hash_password_async(signup_data.password)
            user = GlobalUser(email=email, phone=phone, full_name=signup_data.owner_name, password_hash=hashed_pw)
            session.add(user)
            session.add(TenantConfig(vendor_id=vendor.id, db_url=None, status="active"))
            tenant_user = TenantUser(tenant_id=vendor.id, username=email, full_name=signup_data.owner_name, role="owner", password_hash=hashed_pw)
            session.add(tenant_user)
            session.add(Location(tenant_id=vendor.id, name="Main Branch"))
            session.add(BusinessSettings(tenant_id=vendor.id, business_name=vendor.name, business_type=signup_data.business_type,
                                         phone=phone, email=email))
            for code, name, enabled, commission in DEFAULT_CHANNELS:
                session.add(SalesChannel(tenant_id=vendor.id, code=code, name=name, enabled=enabled, commission_pct=commission,
                                         webhook_secret=secrets.token_urlsafe(32)))
            await session.flush()
            await ensure_roles(session, vendor.id)
            business_settings = (await session.execute(select(BusinessSettings).where(BusinessSettings.tenant_id == vendor.id))).scalars().first()
            await ensure_tax_classes(session, vendor.id, signup_data.business_type, business_settings)
            await session.flush()
            await start_trial(session, vendor.id, days=demo_days)
            device = await start_session(session, user.id, vendor.id, tenant_user.id, user_agent=user_agent, ip=ip)
            tokens = await _issue_tokens(session, user, tenant_user, str(device.id))
            await session.commit()
            logger.info("[Auth] user_registered", extra={"tenant_id": str(vendor.id)})
            return tokens
        except IntegrityError:
            await session.rollback()
            raise HTTPException(status_code=409, detail="An account with this email or phone number already exists")

async def authenticate_user(login_data: LoginRequest, user_agent: str | None = None, ip: str | None = None) -> TokenResponse:
    identifier = login_data.email.strip().lower()
    maker = get_shared_session_maker()
    async with maker() as session:
        result = await session.execute(
            select(GlobalUser).where(or_(func.lower(GlobalUser.email) == identifier, GlobalUser.phone == identifier.replace(" ", "")))
        )
        user = result.scalars().first()
        if not user or not user.is_active:
            await verify_password_async(login_data.password, _DUMMY_HASH)
            raise HTTPException(status_code=401, detail="Incorrect email/phone or password")
        if not await verify_password_async(login_data.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Incorrect email/phone or password")
        if user.platform_role:
            device = await start_session(session, user.id, kind="platform", user_agent=user_agent, ip=ip)
            await session.commit()
            return _issue_platform_tokens(user, str(device.id))
        tenant_user = await _tenant_user_for(session, user)
        device = await start_session(session, user.id, tenant_user.tenant_id, tenant_user.id, user_agent=user_agent, ip=ip)
        tokens = await _issue_tokens(session, user, tenant_user, str(device.id))
        await session.commit()
        return tokens

async def refresh_token(refresh_data: RefreshRequest) -> TokenResponse:
    payload = decode_token(refresh_data.refresh_token, "refresh")
    user_id = payload.get("sub")
    maker = get_shared_session_maker()
    async with maker() as session:
        user = await session.get(GlobalUser, user_id)
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
        session_id = payload.get("sid")
        await check_refreshable(session, session_id)
        if user.platform_role:
            await session.commit()
            return _issue_platform_tokens(user, session_id)
        tenant_user = await _tenant_user_for(session, user)
        config = await session.get(TenantConfig, tenant_user.tenant_id)
        if config is not None and int(payload.get("sv", 1)) != int(config.session_version or 1):
            raise HTTPException(status_code=401, detail="You were signed out of this device. Please sign in again.")
        tokens = await _issue_tokens(session, user, tenant_user, session_id)
        await session.commit()
        return tokens

async def me(user_id: str) -> dict:
    async with get_shared_session_maker()() as session:
        user = await session.get(GlobalUser, user_id)
        if not user:
            raise HTTPException(status_code=401, detail="Account not found")
        if user.platform_role:
            return {"id": str(user.id), "email": user.email, "full_name": user.full_name, "platform_role": user.platform_role,
                    "account_type": "platform"}
        tenant_user = await _tenant_user_for(session, user)
        return {"account_type": "business", "staff_id": str(tenant_user.id),"id": str(user.id), "email": user.email, "phone": user.phone, "full_name": user.full_name or tenant_user.full_name,
                "role": tenant_user.role, "tenant_id": str(tenant_user.tenant_id)}

async def delete_account(user_id: str, password: str) -> dict:
    """App Store 5.1.1(v) / Play account-deletion policy.

    Staff: personal data erased, login disabled. Owner: the whole business is closed — every staff login is
    disabled and customer contact details are erased. Invoice/financial records are retained (anonymised)
    as GST law requires, which the privacy policy discloses.
    """
    from app.models import Customer
    async with get_shared_session_maker()() as session:
        user = await session.get(GlobalUser, user_id)
        if not user or not await verify_password_async(password, user.password_hash):
            raise HTTPException(status_code=400, detail="Password is incorrect")
        tenant_user = await _tenant_user_for(session, user)
        tenant_id = tenant_user.tenant_id
        closed_business = tenant_user.role == "owner"

        affected = [tenant_user]
        if closed_business:
            rows = await session.execute(select(TenantUser).where(TenantUser.tenant_id == tenant_id))
            affected = rows.scalars().all()
            config = await session.get(TenantConfig, tenant_id)
            if config:
                config.status = "deleted"
            customers = await session.execute(select(Customer).where(Customer.tenant_id == tenant_id))
            for customer in customers.scalars().all():
                customer.name, customer.phone, customer.email, customer.notes = "Deleted customer", f"deleted-{customer.id.hex[:8]}", None, None

        for member in affected:
            account = (await session.execute(select(GlobalUser).where(func.lower(GlobalUser.email) == member.username.lower()))).scalars().first()
            erased_email = f"deleted-{secrets.token_hex(8)}@deleted.invalid"
            if account:
                account.email, account.phone, account.full_name = erased_email, None, None
                account.password_hash, account.is_active = get_password_hash(secrets.token_hex(16)), False
            member.username, member.full_name, member.is_active = erased_email, None, False
            member.password_hash = account.password_hash if account else get_password_hash(secrets.token_hex(16))
        await session.commit()

    from app.core.tenant import drop_tenant_cache
    await drop_tenant_cache(tenant_id)  # the closed business stops resolving immediately
    logger.info(f"[Auth] account_deleted (business closed: {closed_business})", extra={"tenant_id": str(tenant_id)})
    return {"success": True, "business_closed": closed_business}

async def change_password(user_id: str, data: ChangePasswordRequest, keep_session_id: str | None = None) -> None:
    """New password: every other device of this login is signed out."""
    async with get_shared_session_maker()() as session:
        user = await session.get(GlobalUser, user_id)
        if not user or not await verify_password_async(data.current_password, user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        hashed = await hash_password_async(data.new_password)
        user.password_hash = hashed
        rows = await session.execute(select(TenantUser).where(func.lower(TenantUser.username) == user.email.lower()))
        for tenant_user in rows.scalars().all():
            tenant_user.password_hash = hashed
        from app.services.sessions import revoke
        await revoke(session, reason="Password changed", user_id=user.id, keep_session_id=keep_session_id)
        await session.commit()
