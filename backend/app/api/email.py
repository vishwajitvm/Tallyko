"""Customer email templates (customisable per business), preview, test send and delivery log."""
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.tenant import get_tenant_db
from app.models import EmailLog, EmailTemplate
from app.services.access import Access, require
from app.services.email import templates
from app.services.email.service import business_values, email_configured, queue_email, template_for
from app.services.settings_service import get_settings

router = APIRouter(prefix="/email", tags=["Email"])

TemplateKey = Literal["loyalty_reward", "offer_announcement", "order_receipt", "welcome"]
SAMPLE = {"customer_name": "Priya", "offer_name": "Weekend Feast", "offer_details": "20% off (max ₹150) on bills above ₹500",
          "offer_code": "FEAST20", "offer_valid_until": "31 Dec 2026", "visits": 5, "points": 120, "bill_no": "INV/26-27/00042",
          "bill_total": "₹1,240.00", "bill_date": "24 Oct 2026"}

class TemplateIn(BaseModel):
    subject: str = Field(min_length=3, max_length=150)
    heading: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=3000)
    button_text: str | None = Field(None, max_length=40)
    button_url: str | None = Field(None, max_length=300)
    accent_color: str | None = Field(None, pattern=r"^$|^#[0-9a-fA-F]{6}$")
    enabled: bool = True

@router.get("/status")
async def email_status(access: Access = Depends(require("email.manage", feature="email"))):
    return {"configured": email_configured(), "placeholders": [{"key": k, "description": v} for k, v in templates.PLACEHOLDERS.items()]}

@router.get("/templates")
async def list_templates(access: Access = Depends(require("email.manage", feature="email")), db: AsyncSession = Depends(get_tenant_db)):
    custom = {t.key for t in (await db.execute(select(EmailTemplate).where(EmailTemplate.tenant_id == access.tenant_id))).scalars().all()}
    out = []
    for key, spec in templates.DEFAULTS.items():
        current = await template_for(db, access.tenant_id, key)
        out.append({"key": key, "label": spec["label"], "description": spec["description"], "customised": key in custom,
                    **{k: current.get(k) for k in ("subject", "heading", "body", "button_text", "button_url", "accent_color", "enabled")}})
    return out

@router.put("/templates/{key}")
async def save_template(key: TemplateKey, data: TemplateIn, access: Access = Depends(require("email.manage", feature="email")),
                        db: AsyncSession = Depends(get_tenant_db)):
    unknown = templates.unknown_placeholders(data.subject, data.heading, data.body, data.button_text, data.button_url)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown placeholders: {', '.join('{' + u + '}' for u in unknown)}")
    row = (await db.execute(select(EmailTemplate).where(EmailTemplate.tenant_id == access.tenant_id, EmailTemplate.key == key))).scalars().first()
    if row is None:
        row = EmailTemplate(tenant_id=access.tenant_id, key=key)
        db.add(row)
    for field, value in data.model_dump().items():
        setattr(row, field, value or None if field in ("button_text", "button_url", "accent_color") else value)
    await db.commit()
    return {"key": key, "customised": True, **data.model_dump()}

@router.delete("/templates/{key}")
async def reset_template(key: TemplateKey, access: Access = Depends(require("email.manage", feature="email")), db: AsyncSession = Depends(get_tenant_db)):
    row = (await db.execute(select(EmailTemplate).where(EmailTemplate.tenant_id == access.tenant_id, EmailTemplate.key == key))).scalars().first()
    if row:
        await db.delete(row)
        await db.commit()
    return {"key": key, "customised": False, **{k: v for k, v in templates.DEFAULTS[key].items() if k not in ("label", "description")}}

class PreviewIn(BaseModel):
    subject: str | None = None
    heading: str | None = None
    body: str | None = None
    button_text: str | None = None
    button_url: str | None = None
    accent_color: str | None = None

@router.post("/templates/{key}/preview")
async def preview_template(key: TemplateKey, data: PreviewIn, access: Access = Depends(require("email.manage", feature="email")),
                           db: AsyncSession = Depends(get_tenant_db)):
    """Render with sample values (unsaved edits can be passed in the body)."""
    settings = await get_settings(db, access.tenant_id)
    template = {**(await template_for(db, access.tenant_id, key)), **{k: v for k, v in data.model_dump().items() if v is not None}}
    subject, html, text = templates.render(template, {**business_values(settings), **SAMPLE},
                                           {"name": settings.business_name, "address": settings.address, "phone": settings.phone})
    return {"subject": subject, "html": html, "text": text}

class TestIn(BaseModel):
    to: EmailStr

@router.post("/templates/{key}/test")
async def send_test(key: TemplateKey, data: TestIn, access: Access = Depends(require("email.manage", feature="email")),
                    db: AsyncSession = Depends(get_tenant_db)):
    log = await queue_email(db, access.tenant_id, key, data.to, SAMPLE)
    await db.commit()
    if log is None:
        raise HTTPException(status_code=409, detail="This email is switched off (or customer emails are turned off in settings)")
    return {"status": log.status, "error": log.error}

@router.get("/logs")
async def email_logs(status: str | None = Query(None, pattern="^(queued|sent|failed|skipped)$"), limit: int = Query(100, ge=1, le=500),
                     access: Access = Depends(require("email.manage", feature="email")), db: AsyncSession = Depends(get_tenant_db)):
    query = select(EmailLog).where(EmailLog.tenant_id == access.tenant_id)
    if status:
        query = query.where(EmailLog.status == status)
    rows = (await db.execute(query.order_by(EmailLog.created_at.desc()).limit(limit))).scalars().all()
    counts = dict((await db.execute(select(EmailLog.status, func.count()).where(EmailLog.tenant_id == access.tenant_id).group_by(EmailLog.status))).all())
    return {"counts": counts, "items": [{"id": str(r.id), "to": r.to_email, "template": r.template_key, "subject": r.subject, "status": r.status,
                                         "error": r.error, "created_at": r.created_at.isoformat() + "Z",
                                         "sent_at": r.sent_at.isoformat() + "Z" if r.sent_at else None} for r in rows]}
