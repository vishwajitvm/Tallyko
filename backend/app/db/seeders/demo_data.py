"""Static demo content. Logins here must stay in sync with frontend/src/features/auth/demoAccounts.ts."""
import os

DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "Demo@1234")

# email, full name, phone
RESTAURANT_OWNER = ("owner.dhaba@example.com", "Rajesh Sharma", "9800000001")
RETAIL_OWNER = ("owner.store@example.com", "Sunita Gupta", "9800000002")
RESTAURANT_NAME = "Sharma Da Dhaba"
RETAIL_NAME = "Gupta General Store"

# email, full name, role, phone — two of every staff role
RESTAURANT_STAFF = [
    ("manager1@example.com", "Anil Kumar", "manager", "9800000011"),
    ("manager2@example.com", "Pooja Mehta", "manager", "9800000012"),
    ("cashier1@example.com", "Ravi Yadav", "cashier", "9800000021"),
    ("cashier2@example.com", "Neha Joshi", "cashier", "9800000022"),
    ("waiter1@example.com", "Suresh Pal", "waiter", "9800000031"),
    ("waiter2@example.com", "Mohan Lal", "waiter", "9800000032"),
    ("kitchen1@example.com", "Ramesh (Head chef)", "kitchen", "9800000041"),
    ("kitchen2@example.com", "Imran (Tandoor)", "kitchen", "9800000042"),
]

# category -> [(name, price, is_veg, [(variant, price)] | None)]
RESTAURANT_MENU = {
    "Starters": [("Paneer Tikka", 220, True, [("Half", 140), ("Full", 220)]), ("Hara Bhara Kebab", 180, True, None),
                 ("Chicken Tikka", 280, False, [("Half", 170), ("Full", 280)]), ("Veg Manchurian", 160, True, None)],
    "Main Course": [("Dal Makhani", 180, True, [("Half", 110), ("Full", 180)]), ("Shahi Paneer", 240, True, [("Half", 150), ("Full", 240)]),
                    ("Butter Chicken", 320, False, [("Half", 190), ("Full", 320)]), ("Mix Veg", 170, True, None), ("Kadhai Chicken", 300, False, None)],
    "Breads": [("Tandoori Roti", 15, True, None), ("Butter Naan", 45, True, None), ("Lachha Paratha", 50, True, None), ("Garlic Naan", 60, True, None)],
    "Rice": [("Jeera Rice", 120, True, None), ("Veg Biryani", 200, True, None), ("Chicken Biryani", 260, False, [("Half", 160), ("Full", 260)])],
    "Beverages": [("Masala Chai", 20, True, None), ("Sweet Lassi", 60, True, None), ("Cold Coffee", 90, True, None), ("Mineral Water 1L", 20, True, None)],
    "Desserts": [("Gulab Jamun (2 pcs)", 50, True, None), ("Rasmalai", 70, True, None), ("Kulfi", 60, True, None)],
}
RESTAURANT_SECTIONS = [("Garden", range(1, 7)), ("AC Hall", range(7, 13))]

# category -> [(name, MRP, tax class code, barcode, opening stock)] — GST 2.0 slabs (see app.core.catalog.DEFAULT_TAX_PRESETS)
RETAIL_ITEMS = {
    "Grocery": [("Aashirvaad Atta 5kg", 285, "GST_5", "8901725181222", 40), ("Tata Salt 1kg", 28, "GST_EXEMPT", "8901058000290", 120),
                ("Fortune Sunflower Oil 1L", 165, "GST_5", "8906007280017", 36), ("India Gate Basmati 1kg", 145, "GST_5", "8906003250014", 50)],
    "Snacks": [("Parle-G 250g", 25, "GST_5", "8901719101038", 200), ("Lay's Classic 52g", 20, "GST_5", "8901491101830", 150),
               ("Haldiram Bhujia 200g", 55, "GST_5", "8904004400076", 60)],
    "Beverages": [("Amul Taaza Milk 500ml", 27, "GST_EXEMPT", "8901262010016", 48), ("Coca-Cola 750ml", 40, "GST_40", "8901764012709", 72),
                  ("Red Label Tea 250g", 140, "GST_5", "8901030865275", 30)],
    "Personal Care": [("Colgate Strong Teeth 200g", 105, "GST_5", "8901314010612", 45), ("Dettol Soap 125g", 52, "GST_5", "8901396393559", 80),
                      ("Head & Shoulders 180ml", 210, "GST_5", "4902430401258", 8)],
}

DEMO_CUSTOMERS = [("Amit Verma", "9811111111"), ("Priya Singh", "9822222222"), ("Rohit Gupta", "9833333333")]

# Tallyko platform staff (super admin console) — demo only
PLATFORM_ADMINS = [
    ("superadmin@example.com", "Tallyko Super Admin", "super_admin"),
    ("superadmin2@example.com", "Priya Nair (Operations)", "super_admin"),
    ("support@example.com", "Tallyko Support (read-only)", "support"),
    ("support2@example.com", "Arjun Rao (Support, read-only)", "support"),
]

# A café whose subscription ended: shows the renewal screen (offline bills stay safe, owner can claim a payment)
EXPIRED_NAME = "Chai Point Café"
EXPIRED_OWNER = ("owner.expired@example.com", "Vikram Singh", "9800000003")
EXPIRED_STAFF = ("cashier.expired@example.com", "Anita Rao", "cashier", "9800000051")

# Demo prices and promotions for Tallyko's own plans (the super admin edits real ones)
DEMO_PLAN_PRICES = {
    "basic": (299, [{"months": 1, "price": 299}, {"months": 12, "price": 2990, "label": "Yearly · 2 months free"}]),
    "standard": (799, [{"months": 1, "price": 799}, {"months": 3, "price": 2249}, {"months": 12, "price": 7990, "label": "Yearly · 2 months free"}]),
    "pro": (1499, [{"months": 1, "price": 1499}, {"months": 6, "price": 7999}, {"months": 12, "price": 14990, "label": "Yearly · 2 months free"}]),
}
DEMO_SUB_OFFERS = [
    {"code": "DIWALI25", "name": "Diwali offer", "description": "25% off any yearly plan", "discount_type": "percent",
     "discount_value": 25, "min_months": 12, "extra_days": 0},
    {"code": "WELCOME", "name": "Welcome month", "description": "First paid month free: pay for 3, get 4", "discount_type": "none",
     "discount_value": 0, "min_months": 3, "extra_days": 30, "new_businesses_only": True},
]

# A delivery-only cloud kitchen on Swiggy, Zomato and ONDC with two virtual brands. Each aggregator has its own prices
# (item price overrides on Swiggy, a % mark-up on Zomato) and its own items (Swiggy-only combo, Zomato-only family pack).
CLOUD_NAME = "Biryani Box Cloud Kitchen"
CLOUD_OWNER = ("owner.cloud@example.com", "Farhan Qureshi", "9800000004")
CLOUD_STAFF = [
    ("cloud.manager@example.com", "Sana Khan", "manager", "9800000061"),
    ("cloud.kitchen@example.com", "Ramu (Biryani master)", "kitchen", "9800000062"),
]
# code: (enabled, commission %, menu mark-up %, store id on the aggregator, auto-accept)
CLOUD_CHANNELS = {
    "SWIGGY": (True, 22, 0, "SW-48213", False),
    "ZOMATO": (True, 20, 8, "ZO-77120", False),
    "ONDC": (True, 5, 0, "ONDC-BBX-01", True),
    "ONLINE": (True, 0, 0, None, False),
    "MAGICPIN": (False, 15, 5, None, False),
}
# brand -> category -> [(name, counter price, veg, {channel: {"price": x} | {"available": False}})]
CLOUD_MENU = {
    "Biryani Box": {
        "Biryani": [
            ("Chicken Dum Biryani", 249, False, {"SWIGGY": {"price": 289}}),
            ("Veg Dum Biryani", 199, True, {"SWIGGY": {"price": 229}}),
            ("Mutton Biryani", 349, False, {"SWIGGY": {"price": 399}, "ZOMATO": {"price": 389}}),
            ("Biryani Family Pack (serves 4)", 899, False, {"SWIGGY": {"available": False}, "ZOMATO": {"price": 949}}),
            ("Swiggy Saver Combo (Biryani + Coke)", 279, False, {"ZOMATO": {"available": False}, "ONDC": {"available": False},
                                                                 "ONLINE": {"available": False}}),
        ],
        "Sides": [("Mirchi ka Salan", 59, True, {}), ("Raita", 39, True, {"SWIGGY": {"price": 49}}), ("Double Ka Meetha", 89, True, {})],
    },
    "Wrap Republic": {
        "Wraps": [
            ("Paneer Tikka Wrap", 149, True, {"SWIGGY": {"price": 169}}),
            ("Chicken Shawarma Wrap", 169, False, {"SWIGGY": {"price": 189}}),
            ("Peri Peri Fries", 99, True, {"ZOMATO": {"available": False}}),
        ],
    },
    None: {"Beverages": [("Coke 300ml", 45, True, {"SWIGGY": {"price": 60}, "ZOMATO": {"price": 60}}), ("Masala Chaas", 49, True, {})]},
}
