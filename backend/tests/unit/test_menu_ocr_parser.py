"""Unit tests for the pure menu parser (app.services.menu_ocr.parse_menu) using synthetic OCR output."""
import math

import pytest

from app.services.menu_ocr import parse_menu

CHAR_W = 15
LINE_H = 30


def box(text, x, y, w=None, h=LINE_H, score=0.9):
    """One RapidOCR result entry: [4 corner points, text, score]."""
    w = w if w is not None else len(text) * CHAR_W
    return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]], text, score]


def rotate(results, degrees):
    a = math.radians(degrees)
    out = []
    for pts, text, score in results:
        rot = [[x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)] for x, y in pts]
        out.append([rot, text, score])
    return out


def items_by_name(result):
    return {item["name"]: item for item in result["items"]}


def test_name_and_price_in_separate_boxes_on_same_row():
    result = parse_menu([
        box("STARTERS", 50, 40),
        box("Paneer Tikka", 50, 100),
        box("240", 500, 103),  # slightly lower: still the same visual row
        box("Hara Bhara Kabab", 50, 150),
        box("180", 500, 148),
    ], 800)
    items = items_by_name(result)
    assert items["Paneer Tikka"]["price"] == 240.0
    assert items["Hara Bhara Kabab"]["price"] == 180.0
    assert items["Paneer Tikka"]["variants"] == []
    assert items["Paneer Tikka"]["category"] == "Starters"


@pytest.mark.parametrize("text", [
    "Dal Makhani 180",
    "Dal Makhani ..... 180",
    "Dal Makhani - Rs. 180/-",
    "Dal Makhani ₹180",
    "Dal Makhani Rs180",
    "Dal Makhani 180/-",
    "Dal Makhani 180.00",
    "Dal Makhani INR 180",
    "Dal Makhani Rs 180",
    "Dal Makhani : 180",
])
def test_name_and_price_in_same_box(text):
    result = parse_menu([box(text, 50, 100)], 800)
    assert len(result["items"]) == 1
    item = result["items"][0]
    assert item["name"] == "Dal Makhani"
    assert item["price"] == 180.0
    assert item["variants"] == []


def test_price_only_box_with_currency_marker():
    result = parse_menu([box("Masala Dosa", 50, 100), box("₹ 90", 500, 100), box("Idli", 50, 150), box("Rs.60/-", 500, 150)], 800)
    items = items_by_name(result)
    assert items["Masala Dosa"]["price"] == 90.0
    assert items["Idli"]["price"] == 60.0


def test_two_prices_in_one_box_become_half_full_variants():
    result = parse_menu([box("Paneer Butter Masala 160 / 280", 50, 100)], 800)
    item = result["items"][0]
    assert item["name"] == "Paneer Butter Masala"
    assert item["price"] == 280.0
    assert item["variants"] == [{"name": "Half", "price": 160.0}, {"name": "Full", "price": 280.0}]


def test_two_prices_in_separate_boxes_become_variants():
    result = parse_menu([box("Dal Makhani", 50, 100), box("110", 400, 100), box("180", 520, 100)], 800)
    item = result["items"][0]
    assert item["name"] == "Dal Makhani"
    assert item["price"] == 180.0
    assert [v["name"] for v in item["variants"]] == ["Half", "Full"]
    assert [v["price"] for v in item["variants"]] == [110.0, 180.0]


def test_three_prices_default_to_small_medium_large():
    result = parse_menu([box("Margherita Pizza 199 / 299 / 399", 50, 100)], 800)
    item = result["items"][0]
    assert item["name"] == "Margherita Pizza"
    assert item["price"] == 399.0
    assert item["variants"] == [
        {"name": "Small", "price": 199.0},
        {"name": "Medium", "price": 299.0},
        {"name": "Large", "price": 399.0},
    ]


def test_header_row_labels_are_used_for_variants():
    result = parse_menu([
        box("CHICKEN", 50, 40),
        box("Qtr", 300, 40), box("Half", 420, 40), box("Full", 540, 40),
        box("Butter Chicken", 50, 100), box("150", 300, 100), box("280", 420, 100), box("520", 540, 100),
        box("Tandoori Chicken", 50, 150), box("140", 300, 150), box("260", 420, 150), box("480", 540, 150),
    ], 800)
    items = items_by_name(result)
    assert result["categories"] == ["Chicken"]
    butter = items["Butter Chicken"]
    assert butter["category"] == "Chicken"
    assert butter["price"] == 520.0
    assert butter["variants"] == [
        {"name": "Qtr", "price": 150.0}, {"name": "Half", "price": 280.0}, {"name": "Full", "price": 520.0},
    ]
    assert [v["name"] for v in items["Tandoori Chicken"]["variants"]] == ["Qtr", "Half", "Full"]


def test_header_labels_on_own_row_and_reset_at_next_heading():
    result = parse_menu([
        box("PIZZA", 50, 40),
        box("Regular", 380, 90), box("Large", 520, 90),
        box("Farmhouse", 50, 140), box("249", 380, 140), box("449", 520, 140),
        box("Paneer Pizza 199 / 399", 50, 190, w=400),  # same-box prices still get the section labels
        box("Garlic Bread", 50, 240), box("129", 520, 240),  # only the Large column filled
        box("CURRIES", 50, 300),
        box("Kadai Paneer", 50, 350), box("160", 380, 350), box("280", 520, 350),
    ], 800)
    items = items_by_name(result)
    assert [(v["name"], v["price"]) for v in items["Farmhouse"]["variants"]] == [("Regular", 249.0), ("Large", 449.0)]
    assert [v["name"] for v in items["Paneer Pizza"]["variants"]] == ["Regular", "Large"]
    assert items["Garlic Bread"]["price"] == 129.0
    assert items["Garlic Bread"]["variants"] == []
    # New heading without labels -> default Half/Full naming again.
    assert items["Kadai Paneer"]["category"] == "Curries"
    assert [v["name"] for v in items["Kadai Paneer"]["variants"]] == ["Half", "Full"]


def test_category_headings_assign_following_items():
    result = parse_menu([
        box("SOUTH INDIAN", 50, 40),
        box("Masala Dosa", 50, 100), box("90", 500, 100),
        box("Plain Uttapam", 50, 150), box("80", 500, 150),
        box("Beverages", 50, 230, h=36),  # mixed case: recognised by the larger font / extra space
        box("Filter Coffee", 50, 290), box("30", 500, 290),
        box("Sweet Lassi", 50, 340), box("60", 500, 340),
    ], 800)
    items = items_by_name(result)
    assert result["categories"] == ["South Indian", "Beverages"]
    assert items["Masala Dosa"]["category"] == "South Indian"
    assert items["Plain Uttapam"]["category"] == "South Indian"
    assert items["Filter Coffee"]["category"] == "Beverages"
    assert items["Sweet Lassi"]["category"] == "Beverages"
    assert "South Indian" not in items and "Beverages" not in items


def test_restaurant_name_above_heading_is_not_an_item_or_category():
    result = parse_menu([
        box("SHER-E-PUNJAB DHABA", 200, 0),
        box("STARTERS", 50, 60),
        box("Paneer Tikka", 50, 110), box("240", 500, 110),
    ], 800)
    assert [i["name"] for i in result["items"]] == ["Paneer Tikka"]
    assert result["categories"] == ["Starters"]


def test_two_column_menu_is_split_into_independent_columns():
    left = [
        box("STARTERS", 40, 50),
        box("Paneer Tikka", 40, 100), box("240", 470, 100),
        box("Hara Bhara Kabab", 40, 150), box("180", 470, 150),
        box("Veg Manchurian", 40, 200), box("160", 470, 200),
    ]
    right = [
        box("BEVERAGES", 640, 52),
        box("Masala Chai", 640, 102), box("20", 1050, 102),
        box("Cold Coffee", 640, 148), box("90", 1050, 148),
        box("Lime Soda", 640, 201), box("60", 1050, 201),
    ]
    result = parse_menu(left + right + [box("Ph: +91 98765 43210", 300, 300)], 1200)
    items = items_by_name(result)
    assert set(items) == {
        "Paneer Tikka", "Hara Bhara Kabab", "Veg Manchurian", "Masala Chai", "Cold Coffee", "Lime Soda",
    }
    assert items["Paneer Tikka"]["price"] == 240.0
    assert items["Masala Chai"]["price"] == 20.0
    assert items["Veg Manchurian"]["category"] == "Starters"
    assert items["Lime Soda"]["category"] == "Beverages"
    # Left column is read before the right one.
    names = [i["name"] for i in result["items"]]
    assert names.index("Veg Manchurian") < names.index("Masala Chai")


def test_single_column_with_far_right_prices_is_not_split():
    result = parse_menu([
        box("ROTI", 40, 50),
        box("Tandoori Roti", 40, 100), box("15", 900, 100),
        box("Butter Naan", 40, 150), box("40", 900, 150),
        box("Lachha Paratha", 40, 200), box("50", 900, 200),
        box("Garlic Naan", 40, 250), box("60", 900, 250),
    ], 1000)
    items = items_by_name(result)
    assert {n: i["price"] for n, i in items.items()} == {
        "Tandoori Roti": 15.0, "Butter Naan": 40.0, "Lachha Paratha": 50.0, "Garlic Naan": 60.0,
    }
    assert all(i["category"] == "Roti" for i in items.values())


@pytest.mark.parametrize("noise", [
    "+91 98765 43210",
    "Mob: 9876543210",
    "Call 98765-43210",
    "GSTIN: 07AAACB1234C1Z5",
    "FSSAI Lic No. 12345678901234",
    "Near Bus Stand, NH 48, Karnal 132001",
    "MENU",
    "Price List",
    "* Taxes extra",
    "GST 5% extra",
    "Open 11 AM - 11 PM",
    "Timings: 10:00 to 22:00",
    "Since 1985",
    "x",
    "150",
    "www.sharmadhaba.in",
])
def test_noise_lines_are_dropped(noise):
    result = parse_menu([
        box("STARTERS", 50, 40),
        box("Paneer Tikka", 50, 100), box("240", 500, 100),
        box(noise, 50, 150),
        box("Veg Seekh Kabab", 50, 200), box("220", 500, 200),
    ], 800)
    names = [i["name"] for i in result["items"]]
    assert names == ["Paneer Tikka", "Veg Seekh Kabab"], result
    assert result["items"][0]["price"] == 240.0
    assert noise in result["lines"]  # raw lines still include everything


@pytest.mark.parametrize("text,name,price", [
    ("Sweet Lassi 250ml 60", "Sweet Lassi 250ml", 60.0),
    ("Mineral Water 1 L 20", "Mineral Water 1 L", 20.0),
    ("Chicken Tikka 1 kg 899", "Chicken Tikka 1 kg", 899.0),
    ("Samosa 2 pcs 30", "Samosa 2 pcs", 30.0),
    ("Chicken 65 220", "Chicken 65", 220.0),
    ("New Year 2024 Thali 350", "New Year 2024 Thali", 350.0),
])
def test_quantities_stay_in_name(text, name, price):
    result = parse_menu([box(text, 50, 100)], 800)
    item = result["items"][0]
    assert item["name"] == name
    assert item["price"] == price
    assert item["variants"] == []


def test_quantity_in_separate_name_box_is_not_a_price():
    result = parse_menu([box("Lassi 250 ml", 50, 100), box("60", 500, 100)], 800)
    item = result["items"][0]
    assert item["name"] == "Lassi 250 ml"
    assert item["price"] == 60.0


@pytest.mark.parametrize("text,price", [
    ("Veg Biryani l20", 120.0),
    ("Masala Dosa 1O0", 100.0),
    ("Gulab Jamun 2OO", 200.0),
    ("Mutton Rogan Josh I80", 180.0),
])
def test_ocr_digit_confusions_in_prices(text, price):
    result = parse_menu([box(text, 50, 100)], 800)
    assert result["items"][0]["price"] == price


def test_letters_alone_are_not_turned_into_prices():
    result = parse_menu([box("Mustard Oil Fish", 50, 100), box("320", 500, 100)], 800)
    assert result["items"][0]["name"] == "Mustard Oil Fish"
    assert result["items"][0]["price"] == 320.0


def test_prices_outside_plausible_range_are_ignored():
    result = parse_menu([
        box("THALI", 50, 40),
        box("Special Thali 123456", 50, 100),
        box("Mini Thali 0", 50, 150),
        box("Deluxe Thali 250", 50, 200),
    ], 800)
    items = items_by_name(result)
    assert items["Deluxe Thali"]["price"] == 250.0
    assert all(i["price"] is None or 1 <= i["price"] <= 99999 for i in result["items"])


def test_name_cleanup():
    result = parse_menu([
        box("PANEER TIKKA (VEG) ......", 50, 100), box("240", 600, 100),
        box("1. Non-Veg Thali .... 150", 50, 150),
        box("CHICKEN 65 - 220", 50, 200),
        box("- Jeera Rice -", 50, 250), box("110", 600, 250),
    ], 800)
    names = [i["name"] for i in result["items"]]
    assert names == ["Paneer Tikka (Veg)", "Non-Veg Thali", "Chicken 65", "Jeera Rice"]


def test_names_with_dropped_spaces_are_repaired():
    result = parse_menu([
        box("PaneerTikka", 50, 100), box("240", 500, 100),
        box("Lassi250ml", 50, 150), box("60", 500, 150),
        box("IdliSambhar(2pcs)", 50, 200), box("60", 500, 200),
    ], 800)
    assert [i["name"] for i in result["items"]] == ["Paneer Tikka", "Lassi 250ml", "Idli Sambhar (2pcs)"]


def test_duplicates_ignore_spacing_differences():
    from app.services.menu_ocr import merge_results

    first = parse_menu([box("Paneer Tikka", 50, 100), box("240", 500, 100)], 800)
    second = parse_menu([box("PANEER TIKKA", 50, 100), box("240", 500, 100), box("Kulfi 70", 50, 150)], 800)
    merged = merge_results([first, second])
    assert [(i["name"], i["price"]) for i in merged["items"]] == [("Paneer Tikka", 240.0), ("Kulfi", 70.0)]


def test_duplicates_are_removed():
    result = parse_menu([
        box("Masala Chai", 50, 100), box("20", 500, 100),
        box("Masala Chai", 50, 150), box("20", 500, 150),
        box("Masala Chai", 50, 200), box("25", 500, 200),  # different price -> kept
    ], 800)
    assert [(i["name"], i["price"]) for i in result["items"]] == [("Masala Chai", 20.0), ("Masala Chai", 25.0)]


def test_item_without_price_is_kept_with_null_price_and_warning():
    result = parse_menu([
        box("DESSERTS", 50, 40),
        box("Gulab Jamun", 50, 100), box("60", 500, 100),
        box("Rasmalai", 50, 150),  # price not readable
        box("Kulfi", 50, 200), box("70", 500, 200),
    ], 800)
    items = items_by_name(result)
    assert items["Rasmalai"]["price"] is None
    assert items["Rasmalai"]["category"] == "Desserts"
    assert any("no price" in w for w in result["warnings"])


def test_description_lines_are_not_items():
    result = parse_menu([
        box("MAINS", 50, 40),
        box("Veg Thali", 50, 100), box("180", 500, 100),
        box("served with raita, salad and papad", 50, 135, h=20),
        box("Rajma Chawal", 50, 180), box("140", 500, 180),
    ], 800)
    assert [i["name"] for i in result["items"]] == ["Veg Thali", "Rajma Chawal"]


def test_confidence_is_mean_of_used_box_scores():
    result = parse_menu([box("Paneer Tikka", 50, 100, score=0.8), box("240", 500, 100, score=0.6)], 800)
    assert result["items"][0]["confidence"] == pytest.approx(0.7, abs=0.01)


def test_tilted_photo_rows_are_grouped_correctly():
    rows = [
        box("STARTERS", 50, 40),
        box("Paneer Tikka", 50, 100), box("240", 1050, 100),
        box("Hara Bhara Kabab", 50, 150), box("180", 1050, 150),
        box("Veg Manchurian", 50, 200), box("160", 1050, 200),
    ]
    result = parse_menu(rotate(rows, 3.5), 1200)
    assert {i["name"]: i["price"] for i in result["items"]} == {
        "Paneer Tikka": 240.0, "Hara Bhara Kabab": 180.0, "Veg Manchurian": 160.0,
    }


def test_output_shape_and_lines():
    result = parse_menu([box("STARTERS", 50, 40), box("Paneer Tikka", 50, 100), box("240", 500, 100)], 800)
    assert set(result) == {"items", "categories", "lines", "warnings"}
    assert result["lines"] == ["STARTERS", "Paneer Tikka 240"]
    assert set(result["items"][0]) == {"name", "price", "category", "variants", "confidence"}


@pytest.mark.parametrize("ocr", [None, []])
def test_empty_ocr_result(ocr):
    result = parse_menu(ocr, 800)
    assert result["items"] == []
    assert result["warnings"]


def test_priceless_item_inside_labelled_section_keeps_the_labels():
    result = parse_menu([
        box("TANDOOR", 50, 40), box("Half", 400, 40), box("Full", 520, 40),
        box("Tandoori Chicken", 50, 100), box("220", 400, 100), box("400", 520, 100),
        box("Chicken Tikka", 50, 150),  # prices not read
        box("Malai Tikka", 50, 200), box("240", 400, 200), box("440", 520, 200),
    ], 800)
    items = items_by_name(result)
    assert items["Chicken Tikka"]["price"] is None
    assert items["Chicken Tikka"]["category"] == "Tandoor"
    assert items["Malai Tikka"]["category"] == "Tandoor"
    assert [v["name"] for v in items["Malai Tikka"]["variants"]] == ["Half", "Full"]
