"""Audit trail helpers. Record sensitive actions in the same transaction as the change itself."""
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import AuditLog, PlatformAuditLog

# Actions surfaced in the business audit log (Settings → Audit log)
ACTION_LABELS = {
    "order.cancel": "Cancelled a bill",
    "order.void_item": "Cancelled items",
    "order.remove_item": "Removed items",
    "order.archive": "Archived bills (by Tallyko)",
    "menu.change": "Changed a menu item",
    "order.comp": "Gave items on the house",
    "order.claim_rejected": "Rejected a customer's UPI payment",
    "order.split": "Split a bill",
    "order.merge": "Merged bills",
    "order.discount": "Gave a discount",
    "order.offer": "Applied an offer",
    "order.reprint": "Reprinted a bill",
    "staff.create": "Added staff",
    "staff.update": "Changed staff",
    "role.create": "Created a role",
    "role.update": "Changed a role's permissions",
    "role.delete": "Deleted a role",
    "settings.update": "Changed business settings",
    "modules.update": "Changed enabled modules",
    "tax.class_update": "Changed a tax class",
    "tax.rate_schedule": "Scheduled a GST rate change",
    "offer.create": "Created an offer",
    "offer.update": "Changed an offer",
    "inventory.adjust": "Adjusted stock",
    "customer.points": "Adjusted loyalty points",
}

# Only the owner sees these (Owner → Watch). Managers' and staff's activity log never lists them, and no one in the business
# can edit or delete them (the database role can only insert into audit_logs).
OWNER_ONLY_ACTIONS = frozenset({"order.cancel", "order.void_item", "order.remove_item", "order.comp", "order.discount",
                                "order.split", "order.merge", "order.reprint", "order.archive", "menu.change"})

def record(db: AsyncSession, access, action: str, *, entity_type: str | None = None, entity_id=None,
           summary: str | None = None, details: dict | None = None) -> None:
    db.add(AuditLog(tenant_id=access.tenant_id, actor_staff_id=access.staff_id, actor_name=access.staff_name or access.role,
                    action=action, entity_type=entity_type, entity_id=str(entity_id) if entity_id else None,
                    summary=summary, details=details))

def record_platform(db: AsyncSession, user, action: str, *, tenant_id=None, details: dict | None = None) -> None:
    db.add(PlatformAuditLog(actor_user_id=user.user_id, actor_email=user.email, action=action,
                            target_tenant_id=tenant_id, details=details))
