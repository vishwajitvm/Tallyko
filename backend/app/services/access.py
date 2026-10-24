"""Effective access for a request: plan features × owner-hidden modules × role permissions.

    @router.post("/orders/{id}/cancel")
    async def cancel(..., access: Access = Depends(require("orders.cancel"))):
        access.can("orders.view_all"); access.staff_id; access.has("loyalty")

Results are cached per process for a short time and invalidated whenever plans, roles or settings change.
"""
import time
from dataclasses import dataclass, field
from fastapi import Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.future import select
from app.core.catalog import (ALL_FEATURES, ALL_PERMISSIONS, DEFAULT_PLAN_KEY, DEFAULT_PLANS, FEATURES, PERMISSION_FEATURE,
                              PERMISSIONS, SYSTEM_ROLES)
from app.core.security import TokenData, get_current_user
from app.core.tenant import get_shared_session_maker

CACHE_SECONDS = 30
_entitlements_cache: dict[str, tuple[float, dict]] = {}
_role_cache: dict[tuple[str, str], tuple[float, frozenset]] = {}
_staff_cache: dict[tuple[str, str], tuple[float, tuple[str | None, str | None]]] = {}

@dataclass
class Access:
    user_id: str
    tenant_id: str
    role: str
    staff_id: str | None
    staff_name: str | None
    permissions: frozenset = field(default_factory=frozenset)
    features: frozenset = field(default_factory=frozenset)
    plan_key: str = DEFAULT_PLAN_KEY
    limits: dict = field(default_factory=dict)

    def can(self, permission: str) -> bool:
        return permission in self.permissions

    def has(self, feature: str) -> bool:
        return feature in self.features

    @property
    def is_owner(self) -> bool:
        return self.role == "owner"

def invalidate(tenant_id: str | None = None) -> None:
    """Drop cached access (call after changing plans, roles, staff or business modules)."""
    if tenant_id is None:
        _entitlements_cache.clear(); _role_cache.clear(); _staff_cache.clear()
        return
    _entitlements_cache.pop(str(tenant_id), None)
    for key in [k for k in _role_cache if k[0] == str(tenant_id)]:
        _role_cache.pop(key, None)
    for key in [k for k in _staff_cache if k[0] == str(tenant_id)]:
        _staff_cache.pop(key, None)

def _fresh(entry) -> bool:
    return entry is not None and time.monotonic() - entry[0] < CACHE_SECONDS

def _plan_defaults(plan_key: str) -> dict:
    return next((p for p in DEFAULT_PLANS if p["key"] == plan_key), next(p for p in DEFAULT_PLANS if p["key"] == DEFAULT_PLAN_KEY))

async def entitlements(tenant_id: str) -> dict:
    """{"plan_key", "plan_name", "features": set, "limits": dict, "plan_features": set} for a business."""
    cached = _entitlements_cache.get(str(tenant_id))
    if _fresh(cached):
        return cached[1]
    from app.models import BusinessSettings, Plan, TenantConfig
    async with get_shared_session_maker()() as session:  # plans/config are platform data; settings read by explicit tenant
        config = await session.get(TenantConfig, tenant_id)
        plan_key = (config.plan_key if config and config.plan_key else None) or DEFAULT_PLAN_KEY
        plan = await session.get(Plan, plan_key)
        defaults = _plan_defaults(plan_key)
        plan_features = set(plan.features if plan else defaults["features"]) & ALL_FEATURES
        limits = dict(plan.limits if plan else defaults["limits"])
        overrides = (config.feature_overrides or {}) if config else {}
        for feature, enabled in overrides.items():
            if feature in ALL_FEATURES:
                (plan_features.add if enabled else plan_features.discard)(feature)
        limits.update((config.limit_overrides or {}) if config else {})
        settings = (await session.execute(select(BusinessSettings).where(BusinessSettings.tenant_id == tenant_id))).scalars().first()
        hidden = set((settings.disabled_modules or []) if settings else [])
        data = {"plan_key": plan_key, "plan_name": plan.name if plan else defaults["name"], "plan_features": frozenset(plan_features),
                "features": frozenset(plan_features - hidden), "limits": limits, "hidden": frozenset(hidden & plan_features)}
    _entitlements_cache[str(tenant_id)] = (time.monotonic(), data)
    return data

async def role_permissions(tenant_id: str, role_key: str) -> frozenset:
    if role_key == "owner":
        return ALL_PERMISSIONS  # owners can never lock themselves out
    cached = _role_cache.get((str(tenant_id), role_key))
    if _fresh(cached):
        return cached[1]
    from app.models import Role
    async with get_shared_session_maker()() as session:
        role = (await session.execute(select(Role).where(Role.tenant_id == tenant_id, Role.key == role_key))).scalars().first()
    if role is not None:
        perms = frozenset(p for p in (role.permissions or []) if p in ALL_PERMISSIONS)
    else:
        perms = frozenset(SYSTEM_ROLES.get(role_key, {}).get("permissions", []))
    _role_cache[(str(tenant_id), role_key)] = (time.monotonic(), perms)
    return perms

async def staff_identity(tenant_id: str, user_id: str) -> tuple[str | None, str | None]:
    """(tenant user id, display name) for the login inside this business."""
    cached = _staff_cache.get((str(tenant_id), str(user_id)))
    if _fresh(cached):
        return cached[1]
    from app.models import GlobalUser, TenantUser
    async with get_shared_session_maker()() as session:
        account = await session.get(GlobalUser, user_id)
        member = None
        if account:
            member = (await session.execute(select(TenantUser).where(TenantUser.tenant_id == tenant_id,
                                                                     func.lower(TenantUser.username) == account.email.lower()))).scalars().first()
        result = (str(member.id) if member else None, (member.full_name if member else None) or (account.full_name if account else None))
    _staff_cache[(str(tenant_id), str(user_id))] = (time.monotonic(), result)
    return result

def effective_permissions(role_perms: frozenset, features: frozenset) -> frozenset:
    """A permission is usable only if the module it belongs to is enabled for the business."""
    return frozenset(p for p in role_perms if PERMISSION_FEATURE.get(p) is None or PERMISSION_FEATURE[p] in features)

async def build_access(token: TokenData) -> Access:
    ent = await entitlements(token.tenant_id)
    perms = effective_permissions(await role_permissions(token.tenant_id, token.role), ent["features"])
    staff_id, name = token.staff_id, None
    if not staff_id:
        staff_id, name = await staff_identity(token.tenant_id, token.user_id)
    else:
        _, name = await staff_identity(token.tenant_id, token.user_id)
    return Access(user_id=token.user_id, tenant_id=token.tenant_id, role=token.role, staff_id=staff_id, staff_name=name,
                  permissions=perms, features=ent["features"], plan_key=ent["plan_key"], limits=ent["limits"])

async def get_access(current_user: TokenData = Depends(get_current_user)) -> Access:
    return await build_access(current_user)

def require(*permissions: str, feature: str | None = None, any_of: bool = False):
    """FastAPI dependency: the business must have `feature` and the user must hold the permission(s)."""
    for p in permissions:
        assert p in PERMISSIONS, f"unknown permission {p}"
    assert feature is None or feature in FEATURES, f"unknown feature {feature}"

    async def dependency(access: Access = Depends(get_access)) -> Access:
        if feature and not access.has(feature):
            raise HTTPException(status_code=403, detail=f"{FEATURES[feature]} isn't included in your plan or is turned off for this business.")
        if permissions:
            granted = [p for p in permissions if access.can(p)]
            if (any_of and not granted) or (not any_of and len(granted) != len(permissions)):
                missing = next(p for p in permissions if not access.can(p))
                module = PERMISSION_FEATURE.get(missing)
                if module and not access.has(module):
                    raise HTTPException(status_code=403, detail=f"{FEATURES[module]} isn't included in your plan or is turned off for this business.")
                raise HTTPException(status_code=403, detail=f"Your role doesn't allow this: {PERMISSIONS[missing][1].lower()}.")
        return access
    return dependency

def check_limit(access: Access, limit: str, current_count: int, label: str) -> None:
    maximum = access.limits.get(limit)
    if maximum is not None and current_count >= int(maximum):
        raise HTTPException(status_code=403, detail=f"Your plan allows up to {maximum} {label}. Ask Tallyko support to upgrade.")
