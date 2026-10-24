"""Built-in customer email templates and the branded HTML layout they render into.

Businesses customise subject / heading / body / button / accent colour (stored in `email_templates`).
Their text is plain text with {placeholders}: only known keys are substituted and everything is HTML-escaped,
so a template can never inject markup or scripts.
"""
import html
import re

PLACEHOLDERS = {
    "customer_name": "Customer's first name",
    "business_name": "Your business name",
    "business_phone": "Your phone number",
    "business_address": "Your address",
    "offer_name": "Offer name",
    "offer_details": "What the offer gives (e.g. 20% off on bills above ₹500)",
    "offer_code": "Offer code (if any)",
    "offer_valid_until": "Last date of the offer",
    "visits": "Number of visits",
    "points": "Loyalty points balance",
    "bill_no": "Bill / invoice number",
    "bill_total": "Bill total",
    "bill_date": "Bill date",
    "store_url": "Link to your online store",
}

DEFAULTS: dict[str, dict] = {
    "loyalty_reward": {
        "label": "Loyalty reward unlocked",
        "description": "Sent automatically when a customer qualifies for a loyalty reward (e.g. their 5th visit).",
        "subject": "{customer_name}, you've unlocked a reward at {business_name} 🎉",
        "heading": "Thank you for coming back!",
        "body": "Hi {customer_name},\n\nYou've visited us {visits} times — that makes you one of our favourite guests. "
                "As a thank you, you've unlocked:\n\n{offer_name}: {offer_details}\n\n"
                "Just share your phone number at the counter on your next visit and we'll apply it for you.",
        "button_text": "See our menu",
        "button_url": "{store_url}",
    },
    "offer_announcement": {
        "label": "New offer announcement",
        "description": "Sent when you announce an offer to customers who agreed to receive offers.",
        "subject": "{offer_name} at {business_name}",
        "heading": "{offer_name}",
        "body": "Hi {customer_name},\n\nWe've got something special for you: {offer_details}.\n\n"
                "Valid until {offer_valid_until}. Mention code {offer_code} or your phone number when you order.",
        "button_text": "Order now",
        "button_url": "{store_url}",
    },
    "order_receipt": {
        "label": "E-receipt",
        "description": "Sent after a bill is paid when the customer has an email address.",
        "subject": "Your bill {bill_no} from {business_name}",
        "heading": "Thanks for visiting, {customer_name}!",
        "body": "Here's a summary of your bill {bill_no} dated {bill_date}.\n\nTotal paid: {bill_total}\n"
                "Loyalty points balance: {points}\n\nWe hope to see you again soon.",
        "button_text": "",
        "button_url": "",
    },
    "welcome": {
        "label": "Welcome (first visit)",
        "description": "Sent after a new customer's first bill.",
        "subject": "Welcome to {business_name}!",
        "heading": "Welcome, {customer_name}!",
        "body": "Thank you for choosing {business_name}. You've started earning loyalty points with every bill — "
                "come back soon to unlock rewards.",
        "button_text": "Order online",
        "button_url": "{store_url}",
    },
}

DEFAULT_ACCENT = "#0F766E"
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")

def fill(text: str | None, values: dict) -> str:
    """Replace known {placeholders}; leave unknown ones visible so the owner notices typos."""
    if not text:
        return ""
    return _PLACEHOLDER.sub(lambda m: str(values.get(m.group(1), m.group(0))) if m.group(1) in PLACEHOLDERS else m.group(0), text)

def unknown_placeholders(*texts: str | None) -> list[str]:
    found = set()
    for text in texts:
        found.update(m.group(1) for m in _PLACEHOLDER.finditer(text or ""))
    return sorted(found - set(PLACEHOLDERS))

def _paragraphs(text: str) -> str:
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    return "".join(f'<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#334155;">'
                   f'{html.escape(b).replace(chr(10), "<br>")}</p>' for b in blocks)

def render(template: dict, values: dict, business: dict) -> tuple[str, str, str]:
    """-> (subject, html, plain text). `template` has subject/heading/body/button_text/button_url/accent_color."""
    accent = template.get("accent_color") if _HEX.match(template.get("accent_color") or "") else DEFAULT_ACCENT
    subject = fill(template["subject"], values)
    heading = fill(template["heading"], values)
    body = fill(template["body"], values)
    button_text = fill(template.get("button_text"), values)
    button_url = fill(template.get("button_url"), values)
    if not re.match(r"^https?://", button_url or ""):
        button_url = ""
    name = html.escape(business.get("name") or "")
    contact = " · ".join(html.escape(x) for x in (business.get("address"), business.get("phone")) if x)

    button = ""
    if button_text and button_url:
        button = (f'<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 24px;"><tr>'
                  f'<td style="border-radius:10px;background:{accent};">'
                  f'<a href="{html.escape(button_url, quote=True)}" style="display:inline-block;padding:13px 26px;font-size:15px;'
                  f'font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">{html.escape(button_text)}</a></td></tr></table>')

    page = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>{html.escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">{html.escape(body[:120])}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
    <tr><td style="background:{accent};padding:22px 28px;">
      <div style="font-size:18px;font-weight:700;color:#ffffff;">{name}</div>
    </td></tr>
    <tr><td style="padding:32px 28px 8px;">
      <h1 style="margin:0 0 18px;font-size:22px;line-height:30px;color:#0f172a;">{html.escape(heading)}</h1>
      {_paragraphs(body)}
      {button}
    </td></tr>
    <tr><td style="padding:18px 28px 26px;border-top:1px solid #e2e8f0;">
      <div style="font-size:12px;line-height:18px;color:#64748b;">{name}{('<br>' + contact) if contact else ''}</div>
      <div style="font-size:11px;line-height:17px;color:#94a3b8;margin-top:8px;">You're receiving this because you're a customer of {name}.
      To stop offer emails, reply to this email or tell us at the counter.</div>
    </td></tr>
  </table>
  <div style="font-size:11px;color:#94a3b8;margin-top:14px;">Sent with Tallyko</div>
</td></tr></table></body></html>"""
    text = f"{heading}\n\n{body}\n\n{button_text + ': ' + button_url if button_text and button_url else ''}\n\n— {business.get('name') or ''}".strip()
    return subject, page, text
