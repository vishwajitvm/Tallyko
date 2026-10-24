"""What the signed-in person can do, the permission catalog, roles (built-in + custom) and the audit log."""
import re
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.catalog import FEATURES, PERMISSIONS, PERMISSION_FEATURE, SYSTEM_ROLES
from app.core.tenant import get_tenant_db
from app.models import AuditLog, Role, TenantUser
from app.services import audit
from app.services.access import Access, entitlements, get_access, invalidate, require
from app.services.settings_service import ensure_roles

router = APIRouter(tags=["Access"])

@router.get("/access/me")
async def my_access(access: Access = Depends(get_access)):
    """Everything the app needs to decide which screens and buttons to show."""
    ent = await entitlements(access.tenant_id)
    return {
        "role": access.role, "staff_id": access.staff_id, "name": access.staff_name,
        "permissions": sorted(access.permissions), "features": sorted(access.features),
        "plan": {"key": ent["plan_key"], "name": ent["plan_name"], "limits": ent["limits"]},
    }

@router.get("/access/permissions")
async def permission_catalog(access: Access = Depends(get_access)):
    groups: dict[str, list] = {}
    for code, (group, description) in PERMISSIONS.items():
        feature = PERMISSION_FEATURE.get(code)
        groups.setdefault(group, []).append({"code": code, "description": description, "feature": feature,
                                             "available": feature is None or access.has(feature)})
    return [{"group": g, "permissions": perms} for g, perms in groups.items()]

# --- Roles ---

class RoleIn(BaseModel):
    name: str = Field(min_length=2, max_length=40)
    description: str | None = Field(None, max_length=200)
    permissions: list[str] = Field(default_factory=list, max_length=len(PERMISSIONS))

class RoleUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=40)
    description: str | None = Field(None, max_length=200)
    permissions: list[str] | None = Field(None, max_length=len(PERMISSIONS))

def _clean_permissions(perms: list[str]) -> list[str]:
    unknown = [p for p in perms if p not in PERMISSIONS]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown permissions: {', '.join(unknown)}")
    return sorted(set(perms))

async def _role_counts(db: AsyncSession, tenant_id: str) -> dict:
    rows = await db.execute(select(TenantUser.role, func.count(TenantUser.id)).where(TenantUser.tenant_id == tenant_id, TenantUser.is_active == True)
                            .group_by(TenantUser.role))
    return dict(rows.all())

def _serialize_role(role: Role, counts: dict) -> dict:
    return {"id": str(role.id), "key": role.key, "name": role.name, "description": role.description,
            "permissions": sorted(role.permissions or []) if role.key != "owner" else sorted(PERMISSIONS),
            "is_system": role.is_system, "editable": role.key != "owner", "staff_count": counts.get(role.key, 0)}

@router.get("/roles")
async def list_roles(access: Access = Depends(require("staff.view", feature="staff")), db: AsyncSession = Depends(get_tenant_db)):
    await ensure_roles(db, access.tenant_id)
    await db.commit()
    roles = (await db.execute(select(Role).where(Role.tenant_id == access.tenant_id).order_by(Role.is_system.desc(), Role.created_at))).scalars().all()
    counts = await _role_counts(db, access.tenant_id)
    order = list(SYSTEM_ROLES)
    return sorted((_serialize_role(r, counts) for r in roles), key=lambda r: (order.index(r["key"]) if r["key"] in order else 99, r["name"]))

@router.post("/roles")
async def create_role(data: RoleIn, access: Access = Depends(require("staff.manage", feature="custom_roles")), db: AsyncSession = Depends(get_tenant_db)):
    if not access.is_owner:
        raise HTTPException(status_code=403, detail="Only the owner can create roles")
    key = re.sub(r"[^a-z0-9]+", "_", data.name.lower()).strip("_")[:30] or "role"
    if key in SYSTEM_ROLES or (await db.execute(select(Role.id).where(Role.tenant_id == access.tenant_id, Role.key == key))).first():
        key = f"{key}_{uuid.uuid4().hex[:4]}"
    role = Role(tenant_id=access.tenant_id, key=key, name=data.name.strip(), description=data.description,
                permissions=_clean_permissions(data.permissions), is_system=False)
    db.add(role)
    audit.record(db, access, "role.create", entity_type="role", entity_id=key, summary=f"{role.name}: {len(role.permissions)} permissions")
    await db.commit()
    return _serialize_role(role, {})

@router.put("/roles/{key}")
async def update_role(key: str, data: RoleUpdate, access: Access = Depends(require("staff.manage", feature="staff")), db: AsyncSession = Depends(get_tenant_db)):
    if not access.is_owner:
        raise HTTPException(status_code=403, detail="Only the owner can change roles")
    if key == "owner":
        raise HTTPException(status_code=400, detail="The owner role always has full access")
    role = (await db.execute(select(Role).where(Role.tenant_id == access.tenant_id, Role.key == key))).scalars().first()
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    if data.permissions is not None:
        if not access.has("custom_roles"):
            raise HTTPException(status_code=403, detail=f"{FEATURES['custom_roles']} isn't included in your plan")
        before = set(role.permissions or [])
        role.permissions = _clean_permissions(data.permissions)
        added, removed = sorted(set(role.permissions) - before), sorted(before - set(role.permissions))
        audit.record(db, access, "role.update", entity_type="role", entity_id=key, summary=role.name,
                     details={"added": added, "removed": removed})
    if data.permissions is None and ((data.name is not None and data.name.strip() != role.name)
                                     or (data.description is not None and data.description != role.description)):
        audit.record(db, access, "role.update", entity_type="role", entity_id=key,
                     summary=f"{role.name} renamed to {data.name.strip()}" if data.name and data.name.strip() != role.name else f"{role.name}: description changed")
    if data.name is not None:
        role.name = data.name.strip()
    if data.description is not None:
        role.description = data.description
    await db.commit()
    invalidate(access.tenant_id)
    return _serialize_role(role, await _role_counts(db, access.tenant_id))

@router.post("/roles/{key}/reset")
async def reset_role(key: str, access: Access = Depends(require("staff.manage", feature="staff")), db: AsyncSession = Depends(get_tenant_db)):
    """Put a built-in role back to Tallyko's default permissions."""
    if not access.is_owner or key not in SYSTEM_ROLES or key == "owner":
        raise HTTPException(status_code=400, detail="Only built-in roles can be reset, by the owner")
    role = (await db.execute(select(Role).where(Role.tenant_id == access.tenant_id, Role.key == key))).scalars().first()
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    role.permissions = list(SYSTEM_ROLES[key]["permissions"])
    audit.record(db, access, "role.update", entity_type="role", entity_id=key, summary=f"{role.name} reset to defaults")
    await db.commit()
    invalidate(access.tenant_id)
    return _serialize_role(role, await _role_counts(db, access.tenant_id))

@router.delete("/roles/{key}")
async def delete_role(key: str, access: Access = Depends(require("staff.manage", feature="custom_roles")), db: AsyncSession = Depends(get_tenant_db)):
    if not access.is_owner:
        raise HTTPException(status_code=403, detail="Only the owner can delete roles")
    role = (await db.execute(select(Role).where(Role.tenant_id == access.tenant_id, Role.key == key))).scalars().first()
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.is_system:
        raise HTTPException(status_code=400, detail="Built-in roles can't be deleted")
    in_use = (await _role_counts(db, access.tenant_id)).get(key, 0)
    if in_use:
        raise HTTPException(status_code=409, detail=f"{in_use} staff member(s) still have this role. Move them to another role first.")
    await db.delete(role)
    audit.record(db, access, "role.delete", entity_type="role", entity_id=key, summary=role.name)
    await db.commit()
    invalidate(access.tenant_id)
    return {"success": True}

# --- Audit log ---

def _utc_naive(dt: datetime) -> datetime:
    """Timestamps are stored as naive UTC; a client sending +05:30 means that local moment."""
    return dt if dt.tzinfo is None else (dt - dt.utcoffset()).replace(tzinfo=None)

@router.get("/audit")
async def audit_log(action: str | None = Query(None, max_length=40), staff_id: uuid.UUID | None = None,
                    date_from: datetime | None = None, date_to: datetime | None = None,
                    limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0),
                    access: Access = Depends(require("audit.view", feature="audit_log")), db: AsyncSession = Depends(get_tenant_db)):
    query = select(AuditLog).where(AuditLog.tenant_id == access.tenant_id)
    if action:
        query = query.where(AuditLog.action.like(f"{action}%"))
    if staff_id:
        query = query.where(AuditLog.actor_staff_id == staff_id)
    if not access.is_owner:
        query = query.where(AuditLog.action.notin_(audit.OWNER_ONLY_ACTIONS))  # owner's watch list stays private
    if date_from:
        query = query.where(AuditLog.created_at >= _utc_naive(date_from))
    if date_to:
        query = query.where(AuditLog.created_at < _utc_naive(date_to))
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    rows = (await db.execute(query.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset))).scalars().all()
    return {"total": total, "items": [{
        "id": str(r.id), "action": r.action, "label": audit.ACTION_LABELS.get(r.action, r.action), "actor_name": r.actor_name,
        "actor_staff_id": str(r.actor_staff_id) if r.actor_staff_id else None, "entity_type": r.entity_type, "entity_id": r.entity_id,
        "summary": r.summary, "details": r.details, "created_at": r.created_at.isoformat() + "Z"} for r in rows]}
