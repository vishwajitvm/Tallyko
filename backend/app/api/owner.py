"""Owner's watch: everything that took money off the table, and who did it. Only the owner sees this (never a permission
that can be given to managers or staff), and nobody in the business can edit or delete what's here.

- Cancelled bills (with reason and who cancelled)
- Items cancelled after the kitchen had them, and items removed before they were sent
- On the house, discounts, split / merged bills
- Menu changes (price edits, items taken off the menu) — the full version history
Corrections (e.g. archiving test bills) go to Tallyko as a request; only Tallyko's super admin can archive or delete.
"""
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.tenant import get_shared_session_maker, get_tenant_db
from app.models import AuditLog, Order, OrderItem, OwnerRequest, Product, ProductVersion, TenantUser
from app.services import audit, menu_history
from app.services.access import Access, get_access

router = APIRouter(prefix="/owner", tags=["Owner"])

async def require_owner(access: Access = Depends(get_access)) -> Access:
    if not access.is_owner:
        raise HTTPException(status_code=403, detail="Only the owner can see this")
    return access

def _utc(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo is None else (dt - dt.utcoffset()).replace(tzinfo=None)

def _f(v) -> float:
    return float(Decimal(v or 0).quantize(Decimal("0.01")))

@router.get("/watch")
async def watch(date_from: datetime | None = None, date_to: datetime | None = None, staff_id: uuid.UUID | None = None,
                limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0),
                access: Access = Depends(require_owner), db: AsyncSession = Depends(get_tenant_db)):
    """Summary + timeline for a period (default: last 7 days)."""
    end = _utc(date_to) or datetime.utcnow()
    start = _utc(date_from) or end - timedelta(days=7)
    tenant_id = access.tenant_id
    names = {u.id: (u.full_name or u.username) for u in (await db.execute(select(TenantUser).where(TenantUser.tenant_id == tenant_id))).scalars().all()}

    cancelled = (await db.execute(select(Order).where(Order.tenant_id == tenant_id, Order.status == "cancelled",
                                                      Order.updated_at >= start, Order.updated_at < end))).scalars().all()
    gone = (await db.execute(select(OrderItem, Order.code, Order.status).join(Order, Order.id == OrderItem.order_id)
                             .where(Order.tenant_id == tenant_id, OrderItem.kitchen_status.in_(["void", "removed"]),
                                    OrderItem.status_at >= start, OrderItem.status_at < end))).all()
    comps = (await db.execute(select(OrderItem, Order.code, Order.waiter_id, Order.settled_by).join(Order, Order.id == OrderItem.order_id)
                              .where(Order.tenant_id == tenant_id, OrderItem.comp_reason.isnot(None), Order.status != "cancelled",
                                     Order.created_at >= start, Order.created_at < end))).all()
    discounted = (await db.execute(select(Order).where(Order.tenant_id == tenant_id, Order.status == "completed",
                                                       Order.completed_at >= start, Order.completed_at < end,
                                                       Order.discount_amount > Order.offer_discount))).scalars().all()
    events_q = select(AuditLog).where(AuditLog.tenant_id == tenant_id, AuditLog.action.in_(audit.OWNER_ONLY_ACTIONS),
                                      AuditLog.created_at >= start, AuditLog.created_at < end)
    if staff_id:
        events_q = events_q.where(AuditLog.actor_staff_id == staff_id)
    events_total = (await db.execute(select(func.count()).select_from(events_q.subquery()))).scalar_one()
    events = (await db.execute(events_q.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset))).scalars().all()
    menu_changes = (await db.execute(select(ProductVersion, Product.name).join(Product, Product.id == ProductVersion.product_id)
                                     .where(ProductVersion.tenant_id == tenant_id, ProductVersion.version > 1,
                                            ProductVersion.created_at >= start, ProductVersion.created_at < end)
                                     .order_by(ProductVersion.created_at.desc()).limit(200))).all()

    # who cancelled which bill (from the activity log)
    cancel_actor = {}
    for e in (await db.execute(select(AuditLog).where(AuditLog.tenant_id == tenant_id, AuditLog.action == "order.cancel",
                                                       AuditLog.entity_id.in_([str(o.id) for o in cancelled] or ["-"])))).scalars().all():
        cancel_actor[e.entity_id] = (e.actor_staff_id, e.actor_name)

    comp_actor = {}
    for e in (await db.execute(select(AuditLog).where(AuditLog.tenant_id == tenant_id, AuditLog.action == "order.comp",
                                                       AuditLog.entity_id.in_([str(i.order_id) for i, *_ in comps] or ["-"])))).scalars().all():
        comp_actor[e.entity_id] = (str(e.actor_staff_id) if e.actor_staff_id else None, e.actor_name)

    by_staff: dict = defaultdict(lambda: {"cancelled_bills": 0, "cancelled_bills_value": 0.0, "items_cancelled": 0, "items_cancelled_value": 0.0,
                                          "items_removed": 0, "items_removed_value": 0.0, "discounts": 0, "discount_value": 0.0})
    for o in cancelled:
        sid, _ = cancel_actor.get(str(o.id), (None, None))
        row = by_staff[sid]
        row["cancelled_bills"] += 1
        row["cancelled_bills_value"] += _f(o.total_amount)
    totals = {"cancelled_bills": len(cancelled), "cancelled_bills_value": round(sum(_f(o.total_amount) for o in cancelled), 2),
              "items_cancelled": 0, "items_cancelled_value": 0.0, "items_removed": 0, "items_removed_value": 0.0,
              "on_the_house": len(comps), "on_the_house_value": round(sum(_f(i.comp_value) for i, *_ in comps), 2),
              "discounted_bills": len(discounted),
              "discount_value": round(sum(_f(Decimal(o.discount_amount) - Decimal(o.offer_discount or 0)) for o in discounted), 2),
              "menu_changes": len(menu_changes)}
    gone_rows = []
    for item, code, status in gone:
        value = _f(Decimal(item.unit_price) * item.quantity)
        key = "items_cancelled" if item.kitchen_status == "void" else "items_removed"
        totals[key] += item.quantity
        totals[key + "_value"] = round(totals[key + "_value"] + value, 2)
        row = by_staff[item.voided_by]
        row[key] += item.quantity
        row[key + "_value"] = round(row[key + "_value"] + value, 2)
        gone_rows.append({"order_id": str(item.order_id), "bill": code, "bill_status": status, "name": item.name, "variant": item.variant_name,
                          "quantity": item.quantity, "value": value, "after_kitchen": item.kitchen_status == "void",
                          "reason": item.void_reason, "by": names.get(item.voided_by), "by_staff_id": str(item.voided_by) if item.voided_by else None,
                          "at": item.status_at.isoformat() + "Z" if item.status_at else None})
    for o in discounted:
        row = by_staff[o.settled_by]
        row["discounts"] += 1
        row["discount_value"] = round(row["discount_value"] + _f(Decimal(o.discount_amount) - Decimal(o.offer_discount or 0)), 2)

    result = {
        "from": start.isoformat() + "Z", "to": end.isoformat() + "Z", "totals": totals, "events_total": int(events_total),
        "by_staff": sorted(({"staff_id": str(sid) if sid else None, "name": names.get(sid, "Unknown / system") if sid else "Unknown / system", **v}
                            for sid, v in by_staff.items()), key=lambda r: -(r["cancelled_bills_value"] + r["items_cancelled_value"] + r["items_removed_value"])),
        "cancelled_bills": [{"id": str(o.id), "bill": o.invoice_no or o.code, "total": _f(o.total_amount), "reason": o.cancel_reason,
                             "by": cancel_actor.get(str(o.id), (None, None))[1],
                             "by_staff_id": str(cancel_actor.get(str(o.id), (None, None))[0]) if cancel_actor.get(str(o.id), (None, None))[0] else None,
                             "table_id": str(o.table_id) if o.table_id else None,
                             "created_at": o.created_at.isoformat() + "Z", "cancelled_at": o.updated_at.isoformat() + "Z"} for o in cancelled],
        "items": sorted(gone_rows, key=lambda r: r["at"] or "", reverse=True),
        "on_the_house": [{"order_id": str(i.order_id), "bill": code, "name": i.name, "quantity": i.quantity, "value": _f(i.comp_value),
                          "reason": i.comp_reason, "by": comp_actor.get(str(i.order_id), (None, None))[1],
                          "by_staff_id": comp_actor.get(str(i.order_id), (None, None))[0]} for i, code, *_ in comps],
        "discounts": [{"order_id": str(o.id), "bill": o.invoice_no or o.code, "total": _f(o.total_amount),
                       "discount": _f(Decimal(o.discount_amount) - Decimal(o.offer_discount or 0)), "by": names.get(o.settled_by),
                       "by_staff_id": str(o.settled_by) if o.settled_by else None} for o in discounted],
        "menu_changes": [{"product_id": str(v.product_id), "name": name, **menu_history.serialize(v)} for v, name in menu_changes],
        "events": [{"id": str(e.id), "action": e.action, "order_id": e.entity_id if e.entity_type == "order" else None, "label": audit.ACTION_LABELS.get(e.action, e.action), "by": e.actor_name,
                    "by_staff_id": str(e.actor_staff_id) if e.actor_staff_id else None, "summary": e.summary, "details": e.details,
                    "at": e.created_at.isoformat() + "Z"} for e in events],
    }
    if staff_id:  # one person: every list and total narrowed to what they did
        sid = str(staff_id)
        for key in ("cancelled_bills", "items", "on_the_house", "discounts"):
            result[key] = [r for r in result[key] if r.get("by_staff_id") == sid]
        result["menu_changes"] = [m for m in result["menu_changes"] if m.get("changed_by_staff_id") == sid]
        mine = next((r for r in result["by_staff"] if r["staff_id"] == sid), None)
        result["totals"] = {**totals, **({k: v for k, v in mine.items() if k not in ("staff_id", "name")} if mine else
                                         {k: 0 for k in totals if k != "menu_changes"}),
                            "on_the_house": len(result["on_the_house"]),
                            "on_the_house_value": round(sum(r["value"] for r in result["on_the_house"]), 2),
                            "menu_changes": len(result["menu_changes"])}
    return result

@router.get("/watch/events")
async def watch_events(date_from: datetime | None = None, date_to: datetime | None = None, staff_id: uuid.UUID | None = None,
                       limit: int = Query(200, ge=1, le=1000), offset: int = Query(0, ge=0),
                       access: Access = Depends(require_owner), db: AsyncSession = Depends(get_tenant_db)):
    """Just the timeline, paged (the full /owner/watch report is heavier)."""
    end = _utc(date_to) or datetime.utcnow()
    start = _utc(date_from) or end - timedelta(days=7)
    query = select(AuditLog).where(AuditLog.tenant_id == access.tenant_id, AuditLog.action.in_(audit.OWNER_ONLY_ACTIONS),
                                   AuditLog.created_at >= start, AuditLog.created_at < end)
    if staff_id:
        query = query.where(AuditLog.actor_staff_id == staff_id)
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    events = (await db.execute(query.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset))).scalars().all()
    return {"total": int(total), "events": [
        {"id": str(e.id), "action": e.action, "order_id": e.entity_id if e.entity_type == "order" else None,
         "label": audit.ACTION_LABELS.get(e.action, e.action), "by": e.actor_name,
         "by_staff_id": str(e.actor_staff_id) if e.actor_staff_id else None, "summary": e.summary, "details": e.details,
         "at": e.created_at.isoformat() + "Z"} for e in events]}

# --- Requests to Tallyko (archive / delete records — the business itself never can) -------------------------------------

class OwnerRequestIn(BaseModel):
    kind: Literal["archive_bills", "delete_bills", "other"]
    order_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)
    message: str = Field(min_length=5, max_length=1000)

def _request_row(r: OwnerRequest) -> dict:
    return {"id": str(r.id), "kind": r.kind, "order_ids": r.order_ids or [], "message": r.message, "status": r.status,
            "action_taken": r.action_taken, "response": r.response, "created_at": r.created_at.isoformat() + "Z",
            "handled_at": r.handled_at.isoformat() + "Z" if r.handled_at else None}

@router.get("/requests")
async def my_requests(access: Access = Depends(require_owner)):
    async with get_shared_session_maker()() as db:
        rows = (await db.execute(select(OwnerRequest).where(OwnerRequest.vendor_id == access.tenant_id)
                                 .order_by(OwnerRequest.created_at.desc()).limit(50))).scalars().all()
    return [_request_row(r) for r in rows]

@router.post("/requests")
async def ask_tallyko(data: OwnerRequestIn, access: Access = Depends(require_owner), db: AsyncSession = Depends(get_tenant_db)):
    if data.kind != "other" and not data.order_ids:
        raise HTTPException(status_code=422, detail="Choose the bills")
    if data.order_ids:
        found = {oid for (oid,) in (await db.execute(select(Order.id).where(Order.tenant_id == access.tenant_id,
                                                                            Order.id.in_(data.order_ids)))).all()}
        if found != set(data.order_ids):
            raise HTTPException(status_code=404, detail="Some bills don't belong to your business")
    staff = await db.get(TenantUser, access.staff_id) if access.staff_id else None
    async with get_shared_session_maker()() as system:
        pending = (await system.execute(select(func.count()).select_from(OwnerRequest)
                                        .where(OwnerRequest.vendor_id == access.tenant_id, OwnerRequest.status == "pending"))).scalar_one()
        if pending >= 10:
            raise HTTPException(status_code=429, detail="You have many requests waiting; Tallyko will get to them shortly")
        row = OwnerRequest(vendor_id=access.tenant_id, kind=data.kind, order_ids=[str(o) for o in data.order_ids], message=data.message.strip(),
                           requested_by=staff.username if staff else None)
        system.add(row)
        await system.commit()
        return _request_row(row)
