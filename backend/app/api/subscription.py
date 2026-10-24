"""The business's own Tallyko subscription: status, plans & offers, how to pay, "I've paid" requests.

These routes keep working after the subscription ends (everything else answers 402), so a locked business can renew.
"""
from datetime import datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.future import select
from app.core.security import TokenData, get_current_user_allow_lapsed
from app.core.tenant import get_shared_session_maker
from app.models import Plan, Subscription, SubscriptionOffer, SubscriptionRequest, TenantConfig, TenantUser
from app.services import subscription as subs

router = APIRouter(prefix="/subscription", tags=["Subscription"])

def _request_row(r: SubscriptionRequest) -> dict:
    return {"id": str(r.id), "plan_key": r.plan_key, "months": r.months, "offer_code": r.offer_code, "amount": float(r.amount),
            "method": r.method, "reference": r.reference, "note": r.note, "status": r.status, "review_note": r.review_note,
            "created_at": r.created_at.isoformat() + "Z", "reviewed_at": r.reviewed_at.isoformat() + "Z" if r.reviewed_at else None}

def _history_row(s: Subscription) -> dict:
    snap = s.snap_entitlements or {}
    return {"id": str(s.id), "start_date": s.start_date.isoformat() + "Z", "end_date": s.end_date.isoformat() + "Z",
            "kind": snap.get("kind", "paid"), "plan_name": snap.get("plan_name"), "months": snap.get("months"),
            "amount_paid": snap.get("amount_paid", 0), "offer": (snap.get("offer") or {}).get("name")}

def _offer_visible(o: SubscriptionOffer, now: datetime) -> bool:
    return (o.is_active and o.show_to_owners and (o.starts_at is None or o.starts_at <= now) and (o.ends_at is None or o.ends_at > now)
            and not (o.max_redemptions and (o.redemptions or 0) >= o.max_redemptions))

@router.get("")
async def my_subscription(user: TokenData = Depends(get_current_user_allow_lapsed)):
    now = datetime.utcnow()
    async with get_shared_session_maker()() as db:
        platform = await subs.get_platform_settings(db)
        config = await db.get(TenantConfig, user.tenant_id)
        history = (await db.execute(select(Subscription).where(Subscription.vendor_id == user.tenant_id)
                                    .order_by(Subscription.start_date.desc()).limit(24))).scalars().all()
        current = next((h for h in history if h.start_date <= now < h.end_date), history[0] if history else None)
        kind = (current.snap_entitlements or {}).get("kind") if current else None
        plans = (await db.execute(select(Plan).where(Plan.is_active == True).order_by(Plan.sort_order))).scalars().all()
        offers = [o for o in (await db.execute(select(SubscriptionOffer))).scalars().all() if _offer_visible(o, now)]
        requests = (await db.execute(select(SubscriptionRequest).where(SubscriptionRequest.vendor_id == user.tenant_id)
                                     .order_by(SubscriptionRequest.created_at.desc()).limit(10))).scalars().all()
    plan_key = (config.plan_key if config else None) or subs.DEFAULT_PLAN_KEY
    return {
        **subs.state_for(config.paid_until if config else None, int(platform.get("grace_days") or 0), kind),
        "kind": kind, "plan_key": plan_key, "plan_name": next((p.name for p in plans if p.key == plan_key), plan_key),
        "grace_days": int(platform.get("grace_days") or 0), "can_pay": user.role == "owner",
        "plans": [{"key": p.key, "name": p.name, "description": p.description, "price_monthly": float(p.price_monthly),
                   "features": sorted(p.features or []), "limits": p.limits or {}, "options": subs.price_options(p)} for p in plans],
        "offers": [{k: v for k, v in subs.serialize_offer(o).items() if k not in ("redemptions", "max_redemptions")} for o in offers],
        # Payment details and claims are the owner's business
        "payment": platform["payment"] if user.role == "owner" else None,
        "requests": [_request_row(r) for r in requests] if user.role == "owner" else [],
        "history": [_history_row(h) for h in history],
    }

class QuoteIn(BaseModel):
    plan_key: str = Field(max_length=40)
    months: int = Field(ge=1, le=60)
    offer_code: str | None = Field(None, max_length=40)

@router.post("/quote")
async def price_quote(data: QuoteIn, user: TokenData = Depends(get_current_user_allow_lapsed)):
    async with get_shared_session_maker()() as db:
        return await subs.quote(db, user.tenant_id, data.plan_key, data.months, data.offer_code)

class PaymentClaim(QuoteIn):
    amount: float = Field(gt=0, le=10_000_000)
    method: Literal["upi", "bank_transfer", "cash", "card", "cheque", "other"] = "upi"
    reference: str = Field(min_length=4, max_length=100)  # UPI / bank reference (UTR)
    note: str | None = Field(None, max_length=300)

@router.post("/requests")
async def claim_payment(data: PaymentClaim, user: TokenData = Depends(get_current_user_allow_lapsed)):
    """Owner: "I've paid" — Tallyko checks the payment and switches the business on (super admin → Payment requests)."""
    if user.role != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can renew the subscription")
    async with get_shared_session_maker()() as db:
        pending = (await db.execute(select(func.count()).select_from(SubscriptionRequest)
                                    .where(SubscriptionRequest.vendor_id == user.tenant_id, SubscriptionRequest.status == "pending"))).scalar_one()
        if pending >= 3:
            raise HTTPException(status_code=429, detail="You already have payments waiting for confirmation. We'll confirm them shortly.")
        quote = await subs.quote(db, user.tenant_id, data.plan_key, data.months, data.offer_code)
        if data.offer_code and quote["offer_error"]:
            raise HTTPException(status_code=400, detail=quote["offer_error"])
        dup = (await db.execute(select(SubscriptionRequest.id).where(SubscriptionRequest.reference == data.reference.strip(),
                                                                     SubscriptionRequest.status != "rejected"))).first()
        if dup:
            raise HTTPException(status_code=409, detail="This payment reference was already submitted")
        owner = await db.get(TenantUser, user.staff_id) if user.staff_id else None
        row = SubscriptionRequest(vendor_id=user.tenant_id, plan_key=data.plan_key, months=data.months,
                                  offer_code=(data.offer_code or "").strip().upper() or None, amount=data.amount, method=data.method,
                                  reference=data.reference.strip(), note=data.note, requested_by=owner.username if owner else None)
        db.add(row)
        await db.commit()
        return {**_request_row(row), "expected_amount": quote["amount"]}
