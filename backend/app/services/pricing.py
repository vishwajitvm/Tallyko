"""Order pricing: GST per line, inclusive/exclusive prices, discounts, rounding.

All money is Decimal and rounded half-up to paise. Prices always come from the server-side
catalog, never from the client.
"""
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP

PAISE = Decimal("0.01")
RUPEE = Decimal("1")
ZERO = Decimal("0")

def money(value) -> Decimal:
    return Decimal(str(value)).quantize(PAISE, rounding=ROUND_HALF_UP)

@dataclass
class PricedLine:
    key: object  # caller's reference (e.g. the item payload)
    unit_price: Decimal
    quantity: int
    tax_rate: Decimal  # percent, e.g. 5
    gross: Decimal = ZERO  # unit_price * quantity, as shown on the menu
    taxable: Decimal = ZERO  # pre-tax value before discount
    discount: Decimal = ZERO
    tax: Decimal = ZERO

@dataclass
class PricedOrder:
    lines: list[PricedLine]
    subtotal: Decimal  # pre-tax, pre-discount
    discount: Decimal
    tax: Decimal
    round_off: Decimal
    total: Decimal
    tax_breakup: list[dict] = field(default_factory=list)  # [{rate, taxable, cgst, sgst}]

def price_order(lines: list[PricedLine], prices_include_tax: bool, discount_flat: Decimal = ZERO,
                discount_percent: Decimal = ZERO, round_to_rupee: bool = True,
                line_discounts: dict[int, Decimal] | None = None) -> PricedOrder:
    """`line_discounts` (index -> pre-tax amount) target specific lines (item offers); flat/percent discounts
    are then spread over what's left of every line."""
    for line in lines:
        line.gross = money(line.unit_price * line.quantity)
        rate = line.tax_rate / Decimal(100)
        line.taxable = money(line.gross / (1 + rate)) if prices_include_tax else line.gross

    subtotal = sum((l.taxable for l in lines), ZERO)

    targeted = ZERO
    for i, line in enumerate(lines):
        line.discount = min(line.taxable, money((line_discounts or {}).get(i, ZERO)))
        targeted += line.discount
    remaining_value = subtotal - targeted

    bill_discount = money(remaining_value * discount_percent / Decimal(100)) if discount_percent else ZERO
    bill_discount = min(remaining_value, bill_discount + money(discount_flat or ZERO))

    # Spread the bill discount over lines in proportion to their remaining value so each GST rate is taxed correctly
    remaining = bill_discount
    for i, line in enumerate(lines):
        line_value = line.taxable - line.discount
        if remaining_value == 0:
            share = ZERO
        elif i == len(lines) - 1:
            share = min(remaining, line_value)
        else:
            share = min(remaining, money(bill_discount * line_value / remaining_value))
        line.discount += share
        remaining -= share
        line.tax = money((line.taxable - line.discount) * line.tax_rate / Decimal(100))
    discount = targeted + bill_discount

    tax = sum((l.tax for l in lines), ZERO)
    raw_total = subtotal - discount + tax
    if prices_include_tax and discount == 0:
        # Customer pays exactly the menu prices; absorb paise drift from back-calculating tax
        raw_total = sum((l.gross for l in lines), ZERO)
        tax = raw_total - subtotal
        _rebalance_tax(lines, tax)
    total = raw_total.quantize(RUPEE, rounding=ROUND_HALF_UP) if round_to_rupee else money(raw_total)
    round_off = money(total - raw_total)

    breakup: dict[Decimal, dict] = {}
    for line in lines:
        b = breakup.setdefault(line.tax_rate, {"rate": line.tax_rate, "taxable": ZERO, "tax": ZERO})
        b["taxable"] += line.taxable - line.discount
        b["tax"] += line.tax
    tax_breakup = []
    for rate in sorted(breakup):
        b = breakup[rate]
        cgst = money(b["tax"] / 2)
        tax_breakup.append({"rate": float(rate), "taxable": float(money(b["taxable"])), "cgst": float(cgst), "sgst": float(money(b["tax"] - cgst))})

    return PricedOrder(lines=lines, subtotal=money(subtotal), discount=money(discount), tax=money(tax),
                       round_off=round_off, total=money(total), tax_breakup=tax_breakup)

def _rebalance_tax(lines: list[PricedLine], tax_total: Decimal) -> None:
    drift = tax_total - sum((l.tax for l in lines), ZERO)
    if drift and lines:
        lines[-1].tax = money(lines[-1].tax + drift)

def tax_breakup_from_items(items) -> list[dict]:
    """Rebuild the GST breakup from stored order items (for receipts/reprints)."""
    breakup: dict[Decimal, dict] = {}
    for item in items:
        rate = Decimal(item.tax_rate or 0)
        b = breakup.setdefault(rate, {"taxable": ZERO, "tax": ZERO})
        tax = Decimal(item.tax_amount or 0)
        b["tax"] += tax
        b["taxable"] += money(tax * 100 / rate) if rate else Decimal(item.subtotal or 0)
    result = []
    for rate in sorted(breakup):
        b = breakup[rate]
        cgst = money(b["tax"] / 2)
        result.append({"rate": float(rate), "taxable": float(money(b["taxable"])), "cgst": float(cgst), "sgst": float(money(b["tax"] - cgst))})
    return result
