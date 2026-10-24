import uuid
from datetime import datetime, timedelta
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.future import select
from app.core.tenant import get_tenant_db
from app.services.access import Access, get_access, require
from app.services import floor_service
from app.models import KOT, Order, OrderItem, TableEntity, Brand
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/kitchen", tags=["Kitchen"])

KotStatus = Literal["pending", "preparing", "ready", "served", "cancelled"]

class KotStatusUpdate(BaseModel):
    status: KotStatus

@router.get("/tickets")
async def get_tickets(
    status: str = Query("active", pattern="^(active|ready|recent|all)$"),
    access: Access = Depends(require("kitchen.view", feature="kitchen")),
    db=Depends(get_tenant_db),
):
    tenant_id = access.tenant_id
    query = select(KOT).where(KOT.tenant_id == tenant_id)
    if status == "active":
        query = query.where(KOT.status.in_(["pending", "preparing", "ready"]))
    elif status == "ready":
        query = query.where(KOT.status == "ready")
    elif status == "recent":  # Recall: bumped / served in the last 2 hours, newest first
        query = query.where(KOT.status.in_(["served", "cancelled"]), KOT.updated_at >= datetime.utcnow() - timedelta(hours=2))
    else:
        query = query.where(KOT.created_at >= datetime.utcnow() - timedelta(hours=24))
    order_by = KOT.updated_at.desc() if status == "recent" else KOT.created_at
    kots = (await db.execute(query.order_by(order_by).limit(200 if status != "recent" else 50))).scalars().all()
    if not kots:
        return []

    order_ids = {k.order_id for k in kots}
    orders = {o.id: o for o in (await db.execute(select(Order).where(Order.id.in_(order_ids), Order.tenant_id == tenant_id))).scalars().all()}
    items = (await db.execute(select(OrderItem).where(OrderItem.kot_id.in_({k.id for k in kots})))).scalars().all()
    table_ids = {o.table_id for o in orders.values() if o.table_id}
    tables = {}
    if table_ids:
        tables = {tid: n for tid, n in (await db.execute(select(TableEntity.id, TableEntity.table_number).where(TableEntity.id.in_(table_ids)))).all()}
    brand_ids = {o.brand_id for o in orders.values() if o.brand_id}
    brands = {}
    if brand_ids:
        brands = {bid: n for bid, n in (await db.execute(select(Brand.id, Brand.name).where(Brand.id.in_(brand_ids)))).all()}

    by_kot: dict = {}
    for item in items:
        by_kot.setdefault(item.kot_id, []).append({
            "id": str(item.id), "name": item.name, "variant_name": item.variant_name, "quantity": item.quantity, "notes": item.notes,
            "status": item.kitchen_status or "pending", "is_void": item.kitchen_status == "void", "void_reason": item.void_reason,
        })
    response = []
    for kot in kots:
        order = orders.get(kot.order_id)
        if not order:
            continue
        response.append({
            "id": str(kot.id), "kot_no": kot.kot_no, "status": kot.status, "order_id": str(order.id), "order_code": order.code,
            "token_no": order.token_no, "type": order.type, "channel": order.channel, "table_label": tables.get(order.table_id),
            "brand": brands.get(order.brand_id), "customer_name": order.customer_name, "notes": order.notes,
            "bill_label": order.bill_label,
            "created_at": kot.created_at.isoformat() + "Z", "items": by_kot.get(kot.id, []),
            "updated_at": kot.updated_at.isoformat() + "Z" if kot.updated_at else None,
            "bumped_at": kot.updated_at.isoformat() + "Z" if kot.updated_at and kot.status in ("served", "cancelled") else None,
        })
    return response

@router.put("/tickets/{kot_id}/status")
async def update_ticket_status(kot_id: uuid.UUID, data: KotStatusUpdate, access: Access = Depends(require("kitchen.update", feature="kitchen")), db=Depends(get_tenant_db)):
    result = await db.execute(select(KOT).where(KOT.id == kot_id, KOT.tenant_id == access.tenant_id))
    kot = result.scalars().first()
    if not kot:
        raise HTTPException(status_code=404, detail="KOT not found")
    if kot.status == "cancelled" and data.status != "cancelled":
        raise HTTPException(status_code=409, detail="This ticket was cancelled")
    await floor_service.set_ticket_status(db, access.tenant_id, kot, data.status)
    await db.commit()
    logger.info(f"[Kitchen] KOT {kot.kot_no} -> {kot.status}", extra={"tenant_id": access.tenant_id})
    return {"id": str(kot.id), "status": kot.status}

# Backwards-compatible aliases used by older app builds
@router.get("/kds/orders")
async def legacy_kds_orders(access: Access = Depends(require("kitchen.view", feature="kitchen")), db=Depends(get_tenant_db)):
    return await get_tickets("active", access, db)

@router.put("/kds/orders/{kot_id}/status")
async def legacy_kds_status(kot_id: uuid.UUID, data: KotStatusUpdate, access: Access = Depends(require("kitchen.update", feature="kitchen")), db=Depends(get_tenant_db)):
    return await update_ticket_status(kot_id, data, access, db)
