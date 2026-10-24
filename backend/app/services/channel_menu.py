"""What an item costs, and whether it's sold, on each sales channel (counter, Swiggy, Zomato, own store, QR…).

Each product can carry per-channel overrides in `products.channel_prices`:
    {"SWIGGY": {"price": 260}, "ZOMATO": {"price": 255, "available": true}, "ONLINE": {"available": false}}
- price: the item's price on that channel (options/variants keep their extra cost on top)
- available: false hides it from that channel's menu (e.g. a combo only on Zomato, family packs not on the counter)
Without an override the channel's percentage mark-up (`sales_channels.price_adjust_pct`) applies to the counter price,
rounded to the nearest rupee.
"""
from decimal import Decimal
from fastapi import HTTPException
from app.services.pricing import money

CHANNEL_NAMES = {"POS": "counter", "QR": "QR table", "ONLINE": "online store", "SWIGGY": "Swiggy", "ZOMATO": "Zomato",
                 "ONDC": "ONDC", "MAGICPIN": "magicpin", "OTHER": "other channel"}

def _entry(product, channel: str | None) -> dict:
    if not channel:
        return {}
    return (getattr(product, "channel_prices", None) or {}).get(channel.upper()) or {}

def available_on(product, channel: str | None) -> bool:
    return bool(product.is_active) and _entry(product, channel).get("available", True) is not False

def unit_price(product, channel: str | None, adjust_pct: Decimal | float | int = 0, variant_modifier: Decimal | float = 0) -> Decimal:
    """Price of one unit (incl. the variant) on `channel`, before tax/offers."""
    entry = _entry(product, channel)
    modifier = Decimal(str(variant_modifier or 0))
    if entry.get("price") is not None:
        return money(Decimal(str(entry["price"])) + modifier)
    adjust = Decimal(str(adjust_pct or 0))
    price = Decimal(product.base_price) + modifier
    if not adjust:
        return money(price)
    # Apps list whole-rupee prices: a mark-up rounds to the nearest rupee (₹249 + 8% → ₹269)
    return (price * (1 + adjust / Decimal(100))).quantize(Decimal("1"), rounding="ROUND_HALF_UP")

def require_available(products: dict, items, channel: str | None) -> None:
    for item in items:
        product = products[item.product_id]
        if not available_on(product, channel):
            raise HTTPException(status_code=400, detail=f"{product.name} isn't on the {CHANNEL_NAMES.get((channel or '').upper(), channel)} menu")

def clean_overrides(raw: dict | None, valid_codes: set[str]) -> dict | None:
    """Validate what the menu editor sends; drops empty entries."""
    if not raw:
        return None
    out = {}
    for code, entry in raw.items():
        code = str(code).upper()
        if code not in valid_codes:
            raise HTTPException(status_code=422, detail=f"Unknown sales channel {code}")
        if not isinstance(entry, dict):
            raise HTTPException(status_code=422, detail="Channel prices must be objects")
        clean = {}
        if entry.get("price") not in (None, ""):
            try:
                price = round(float(entry["price"]), 2)
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail=f"Enter a valid {code} price")
            if not 0 <= price <= 1_000_000:
                raise HTTPException(status_code=422, detail=f"Enter a valid {code} price")
            clean["price"] = price
        if entry.get("available") is False:
            clean["available"] = False
        if clean:
            out[code] = clean
    return out or None
