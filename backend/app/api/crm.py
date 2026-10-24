import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.security import MANAGERS
from app.core.tenant import get_tenant_db
from app.services.access import Access, get_access, require
from app.models import Customer, Order
from app.schemas.billing import PHONE_PATTERN

router = APIRouter(prefix="/crm", tags=["Crm"])

class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    phone: str = Field(pattern=PHONE_PATTERN)
    email: EmailStr | None = None
    notes: str | None = Field(None, max_length=500)
    marketing_opt_in: bool = False  # customer agreed to receive offers by email

class CustomerUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    phone: str | None = Field(None, pattern=PHONE_PATTERN)
    email: EmailStr | None = None
    notes: str | None = Field(None, max_length=500)
    points: int | None = Field(None, ge=0, le=10_000_000)
    marketing_opt_in: bool | None = None

def get_tier(points: int) -> str:
    if points >= 500:
        return "Gold"
    if points >= 100:
        return "Silver"
    return "Bronze"

def serialize_customer(c: Customer) -> dict:
    return {
        "id": str(c.id), "name": c.name, "phone": c.phone, "email": c.email, "notes": c.notes, "points": c.points,
        "marketing_opt_in": bool(c.marketing_opt_in), "tier": get_tier(c.points), "total_spent": float(c.total_spent or 0), "visits": c.visits or 0,
        "last_visit_at": c.last_visit_at.isoformat() + "Z" if c.last_visit_at else None,
    }

async def _get(db: AsyncSession, tenant_id: str, customer_id) -> Customer:
    result = await db.execute(select(Customer).where(Customer.id == customer_id, Customer.tenant_id == tenant_id))
    customer = result.scalars().first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer

@router.get("/customers")
async def get_customers(response: Response, q: str | None = Query(None, max_length=60), limit: int = Query(100, ge=1, le=500),
                        offset: int = Query(0, ge=0), sort: str = Query("recent", pattern="^(recent|name|points|spent|visits)$"),
                        tier: str | None = Query(None, pattern="^(Gold|Silver|Bronze)$"), opted_in: bool | None = None,
                        access: Access = Depends(require("customers.view", feature="customers")), db: AsyncSession = Depends(get_tenant_db)):
    """Server-paged; total in `X-Total-Count`, tier counts (for the chips) in `X-Counts`."""
    import json
    query = select(Customer).where(Customer.tenant_id == access.tenant_id)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(Customer.name.ilike(like), Customer.phone.ilike(like), Customer.email.ilike(like)))
    tiers = (await db.execute(query.with_only_columns(
        func.count().filter(Customer.points >= 500), func.count().filter((Customer.points >= 100) & (Customer.points < 500)),
        func.count().filter(Customer.points < 100), func.count(),
        func.count().filter((Customer.marketing_opt_in == True) & Customer.email.isnot(None))))).one()
    response.headers["X-Counts"] = json.dumps({"Gold": tiers[0], "Silver": tiers[1], "Bronze": tiers[2], "all": tiers[3],
                                               "opted_in": tiers[4]})
    if opted_in is not None:
        query = query.where((Customer.marketing_opt_in == True) & Customer.email.isnot(None)) if opted_in else \
            query.where(or_(Customer.marketing_opt_in == False, Customer.email.is_(None)))
    if tier == "Gold":
        query = query.where(Customer.points >= 500)
    elif tier == "Silver":
        query = query.where(Customer.points >= 100, Customer.points < 500)
    elif tier == "Bronze":
        query = query.where(Customer.points < 100)
    response.headers["X-Total-Count"] = str((await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
    order = {"recent": (Customer.last_visit_at.desc().nullslast(), Customer.name), "name": (Customer.name,),
             "points": (Customer.points.desc(), Customer.name), "spent": (Customer.total_spent.desc(), Customer.name),
             "visits": (Customer.visits.desc(), Customer.name)}[sort]
    result = await db.execute(query.order_by(*order).limit(limit).offset(offset))
    return [serialize_customer(c) for c in result.scalars().all()]

@router.get("/customers/lookup")
async def lookup_customer(phone: str = Query(..., pattern=PHONE_PATTERN), access: Access = Depends(require("customers.view", feature="customers")),
                          db: AsyncSession = Depends(get_tenant_db)):
    result = await db.execute(select(Customer).where(Customer.tenant_id == access.tenant_id, Customer.phone == phone.replace(" ", "")))
    customer = result.scalars().first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return serialize_customer(customer)

@router.post("/customers")
async def create_customer(data: CustomerIn, access: Access = Depends(require("customers.manage", feature="customers")), db: AsyncSession = Depends(get_tenant_db)):
    tenant_id = access.tenant_id
    phone = data.phone.replace(" ", "")
    result = await db.execute(select(Customer).where(Customer.phone == phone, Customer.tenant_id == tenant_id))
    if result.scalars().first():
        raise HTTPException(status_code=409, detail="A customer with this phone number already exists")
    customer = Customer(tenant_id=tenant_id, name=data.name.strip(), phone=phone, email=data.email, notes=data.notes, points=0,
                        marketing_opt_in=data.marketing_opt_in)
    db.add(customer)
    await db.commit()
    await db.refresh(customer)
    return serialize_customer(customer)

@router.put("/customers/{customer_id}")
async def update_customer(customer_id: uuid.UUID, data: CustomerUpdate, access: Access = Depends(require("customers.manage", feature="customers")),
                          db: AsyncSession = Depends(get_tenant_db)):
    customer = await _get(db, access.tenant_id, customer_id)
    update = data.model_dump(exclude_unset=True)
    if "points" in update and not (access.can("customers.manage") and access.role in MANAGERS):
        raise HTTPException(status_code=403, detail="Only managers can change loyalty points")
    if update.get("phone"):
        update["phone"] = update["phone"].replace(" ", "")
        dup = await db.execute(select(Customer.id).where(Customer.tenant_id == access.tenant_id, Customer.phone == update["phone"], Customer.id != customer.id))
        if dup.first():
            raise HTTPException(status_code=409, detail="A customer with this phone number already exists")
    for key, value in update.items():
        setattr(customer, key, value)
    await db.commit()
    await db.refresh(customer)
    return serialize_customer(customer)

@router.get("/customers/{customer_id}")
async def get_customer_detail(customer_id: uuid.UUID, access: Access = Depends(require("customers.view", feature="customers")), db: AsyncSession = Depends(get_tenant_db)):
    customer = await _get(db, access.tenant_id, customer_id)
    orders = (await db.execute(select(Order).where(Order.customer_id == customer_id, Order.tenant_id == access.tenant_id)
                               .order_by(Order.created_at.desc()).limit(50))).scalars().all()
    data = serialize_customer(customer)
    data["orders"] = [{
        "id": str(o.id), "code": o.code, "invoice_no": o.invoice_no, "total_amount": float(o.total_amount), "type": o.type,
        "channel": o.channel, "status": o.status, "created_at": o.created_at.isoformat() + "Z",
    } for o in orders]
    return data
