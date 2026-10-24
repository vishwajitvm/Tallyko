"""Email queue and delivery.

Emails are written to `email_logs` with status "queued" inside the same transaction as the event that caused
them (a bill, an unlocked reward), so nothing is sent for work that rolls back. A background worker started with
the API delivers them over SMTP and retries transient failures.
"""
import asyncio
import logging
import smtplib
import ssl
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.config import settings
from app.services.email import templates

logger = logging.getLogger("tallyko")
MAX_ATTEMPTS = 3

def email_configured() -> bool:
    return bool(settings.SMTP_HOST)

async def template_for(db: AsyncSession, tenant_id: str, key: str) -> dict:
    """The business's customised template, or the built-in default."""
    from app.models import EmailTemplate
    row = (await db.execute(select(EmailTemplate).where(EmailTemplate.tenant_id == tenant_id, EmailTemplate.key == key))).scalars().first()
    base = dict(templates.DEFAULTS[key])
    if row:
        base.update(subject=row.subject, heading=row.heading, body=row.body, button_text=row.button_text,
                    button_url=row.button_url, accent_color=row.accent_color, enabled=row.enabled)
    base.setdefault("enabled", True)
    return base

def business_values(settings_row) -> dict:
    return {
        "business_name": settings_row.business_name, "business_phone": settings_row.phone or "",
        "business_address": settings_row.address or "",
        "store_url": f"{settings.PUBLIC_APP_URL.rstrip('/')}/store/{settings_row.tenant_id}",
    }

async def queue_email(db: AsyncSession, tenant_id: str, key: str, to_email: str, values: dict, *, customer_id=None,
                      order_id=None, offer_id=None) -> object | None:
    """Render and queue one email. Returns the EmailLog, or None if this email type is switched off."""
    from app.models import BusinessSettings, EmailLog
    settings_row = (await db.execute(select(BusinessSettings).where(BusinessSettings.tenant_id == tenant_id))).scalars().first()
    if settings_row is None or not settings_row.email_enabled:
        return None
    template = await template_for(db, tenant_id, key)
    if not template.get("enabled", True):
        return None
    merged = {**business_values(settings_row), **values}
    subject, _, _ = templates.render(template, merged, {"name": settings_row.business_name})
    log = EmailLog(tenant_id=tenant_id, to_email=to_email.strip(), template_key=key, subject=subject[:300],
                   status="queued" if email_configured() else "skipped",
                   error=None if email_configured() else "Email sending is not configured on this server (SMTP_HOST)",
                   customer_id=customer_id, order_id=order_id, offer_id=offer_id,
                   context={k: (v if isinstance(v, (str, int, float)) or v is None else str(v)) for k, v in values.items()})
    db.add(log)
    return log

def _send_smtp(to_email: str, subject: str, html_body: str, text_body: str, sender_name: str, reply_to: str | None) -> None:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((sender_name or settings.SMTP_FROM_NAME, settings.SMTP_FROM_EMAIL))
    message["To"] = to_email
    if reply_to:
        message["Reply-To"] = reply_to
    message["Message-ID"] = make_msgid(domain=settings.SMTP_FROM_EMAIL.split("@")[-1])
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")
    if settings.SMTP_SSL:
        with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, context=ssl.create_default_context(), timeout=20) as smtp:
            if settings.SMTP_USERNAME:
                smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            smtp.send_message(message)
        return
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as smtp:
        if settings.SMTP_STARTTLS:
            smtp.starttls(context=ssl.create_default_context())
        if settings.SMTP_USERNAME:
            smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        smtp.send_message(message)

async def deliver(system_db: AsyncSession, log) -> None:
    """Send one queued email (system session: the worker serves every business)."""
    from app.models import BusinessSettings
    settings_row = (await system_db.execute(select(BusinessSettings).where(BusinessSettings.tenant_id == log.tenant_id))).scalars().first()
    template = await template_for(system_db, str(log.tenant_id), log.template_key)
    values = business_values(settings_row) if settings_row else {}
    values.update(_stored_values(log))
    subject, html_body, text_body = templates.render(template, values, {"name": settings_row.business_name if settings_row else "",
                                                                         "address": settings_row.address if settings_row else None,
                                                                         "phone": settings_row.phone if settings_row else None})
    sender = (settings_row.email_sender_name or settings_row.business_name) if settings_row else settings.SMTP_FROM_NAME
    reply_to = (settings_row.email_reply_to or settings_row.email) if settings_row else None
    await asyncio.to_thread(_send_smtp, log.to_email, subject, html_body, text_body, sender, reply_to)

def _stored_values(log) -> dict:
    return dict(log.context or {})

async def run_worker(stop: asyncio.Event, interval: float = 5.0) -> None:
    """Deliver queued emails until `stop` is set. Started from app lifespan."""
    from app.core.tenant import get_shared_session_maker
    from app.models import EmailLog
    while not stop.is_set():
        try:
            async with get_shared_session_maker()() as db:
                rows = (await db.execute(select(EmailLog).where(EmailLog.status == "queued").order_by(EmailLog.created_at).limit(20)
                                         .with_for_update(skip_locked=True))).scalars().all()
                for log in rows:
                    try:
                        await deliver(db, log)
                        log.status, log.sent_at, log.error = "sent", datetime.utcnow(), None
                    except Exception as exc:  # network / auth / recipient errors
                        attempts = int((log.error or "").count("[attempt")) + 1
                        log.error = f"[attempt {attempts}] {exc}"[:500]
                        if attempts >= MAX_ATTEMPTS or isinstance(exc, smtplib.SMTPRecipientsRefused):
                            log.status = "failed"
                        logger.warning(f"[Email] delivery failed ({attempts}/{MAX_ATTEMPTS}): {exc}", extra={"tenant_id": str(log.tenant_id)})
                await db.commit()
        except Exception as exc:
            logger.error(f"[Email] worker error: {exc}")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass
