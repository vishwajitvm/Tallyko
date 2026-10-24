from decimal import Decimal as D
from app.services.pricing import PricedLine, price_order

def line(price, qty, rate):
    return PricedLine(key=None, unit_price=D(str(price)), quantity=qty, tax_rate=D(str(rate)))

def test_exclusive_gst_adds_tax_on_top():
    priced = price_order([line(100, 2, 5)], prices_include_tax=False)
    assert priced.subtotal == D("200.00")
    assert priced.tax == D("10.00")
    assert priced.total == D("210")
    assert priced.tax_breakup == [{"rate": 5.0, "taxable": 200.0, "cgst": 5.0, "sgst": 5.0}]

def test_inclusive_gst_customer_pays_menu_price():
    priced = price_order([line(105, 1, 5), line(118, 1, 18)], prices_include_tax=True)
    assert priced.total == D("223")
    assert priced.subtotal + priced.tax == D("223.00")
    assert priced.tax == D("23.00")

def test_round_off_to_nearest_rupee():
    priced = price_order([line(99.5, 1, 5)], prices_include_tax=False)  # 99.50 + 4.98 = 104.48
    assert priced.total == D("104")
    assert priced.round_off == D("-0.48")

def test_percent_discount_reduces_taxable_value_before_gst():
    priced = price_order([line(100, 1, 5)], prices_include_tax=False, discount_percent=D("10"))
    assert priced.discount == D("10.00")
    assert priced.tax == D("4.50")
    assert priced.total == D("95")  # 94.50 rounds half-up

def test_flat_discount_split_across_tax_rates_proportionally():
    priced = price_order([line(100, 1, 5), line(100, 1, 18)], prices_include_tax=False, discount_flat=D("20"))
    assert priced.discount == D("20.00")
    assert [l.discount for l in priced.lines] == [D("10.00"), D("10.00")]
    assert priced.tax == D("4.50") + D("16.20")

def test_discount_never_exceeds_subtotal():
    priced = price_order([line(50, 1, 0)], prices_include_tax=False, discount_flat=D("500"))
    assert priced.discount == D("50.00")
    assert priced.total == D("0")

def test_zero_rate_items_have_no_tax():
    priced = price_order([line(40, 3, 0)], prices_include_tax=True)
    assert priced.tax == D("0.00")
    assert priced.total == D("120")
