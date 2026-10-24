"""Single source of truth for permissions, built-in roles, features (modules) and default plans.

Three layers decide what someone can do:
  1. Features   — what the business's plan includes (set by the platform super admin) minus modules the owner hid.
  2. Permissions — what the person's role allows inside the business (built-in or custom roles).
  3. Data scope  — e.g. a waiter without `orders.view_all` only sees their own orders/tables.
"""

# --- Permissions (inside a business) ----------------------------------------------------------------------

PERMISSIONS: dict[str, tuple[str, str]] = {
    # code: (group, description)
    "orders.create": ("Billing", "Take orders and send them to the kitchen"),
    "orders.view_all": ("Billing", "See every order (otherwise only orders they took)"),
    "orders.pay": ("Billing", "Collect payments and close bills"),
    "orders.discount": ("Billing", "Give manual discounts and redeem loyalty points"),
    "orders.void_item": ("Billing", "Remove items already sent to the kitchen"),
    "orders.cancel": ("Billing", "Cancel or void whole bills"),
    "orders.reprint": ("Billing", "Reprint bills"),
    "orders.accept_online": ("Billing", "Accept or reject online / aggregator orders"),
    "tables.view": ("Tables", "See the floor plan and running tables"),
    "tables.manage": ("Tables", "Add, edit and remove tables; assign waiters"),
    "tables.transfer": ("Tables", "Move a running order to another table"),
    "kitchen.view": ("Kitchen", "See the kitchen display"),
    "kitchen.update": ("Kitchen", "Mark kitchen tickets preparing / ready / served"),
    "menu.view": ("Menu", "See the menu and prices"),
    "menu.manage": ("Menu", "Add and edit items, prices, categories and barcodes"),
    "inventory.view": ("Inventory", "See stock levels"),
    "inventory.manage": ("Inventory", "Add stock, record wastage and adjustments"),
    "customers.view": ("Customers", "See customers and their order history"),
    "customers.view_contact": ("Customers", "See customers' phone numbers and emails"),
    "customers.manage": ("Customers", "Add and edit customers, adjust loyalty points"),
    "offers.apply": ("Offers", "Apply offers to bills"),
    "offers.manage": ("Offers", "Create, schedule and switch off offers and rewards"),
    "reports.view": ("Reports", "See sales reports for the whole business"),
    "reports.view_own": ("Reports", "See their own sales summary"),
    "staff.view": ("Staff", "See staff and their performance"),
    "staff.manage": ("Staff", "Add staff, change roles, reset passwords"),
    "settings.manage": ("Settings", "Change business settings, receipt, GST and printers defaults"),
    "channels.manage": ("Settings", "Manage sales channels and aggregator integrations"),
    "email.manage": ("Settings", "Edit customer email templates and send campaigns"),
    "audit.view": ("Settings", "See the audit log"),
}
ALL_PERMISSIONS = frozenset(PERMISSIONS)

# Built-in roles every business gets. Owners always have every permission and can't be restricted.
SYSTEM_ROLES: dict[str, dict] = {
    "owner": {"name": "Owner", "description": "Full access to everything, including staff and settings.",
              "permissions": sorted(ALL_PERMISSIONS)},
    "manager": {"name": "Manager", "description": "Runs the floor and the menu; sees reports. Can't change owners.",
                "permissions": sorted(ALL_PERMISSIONS - {"settings.manage", "channels.manage", "audit.view"})},
    "cashier": {"name": "Cashier", "description": "Bills, payments, discounts and online orders.",
                "permissions": ["orders.create", "orders.view_all", "orders.pay", "orders.discount", "orders.reprint",
                                "orders.accept_online", "tables.view", "tables.transfer", "kitchen.view", "kitchen.update", "menu.view",
                                "inventory.view", "customers.view", "customers.view_contact", "customers.manage",
                                "offers.apply", "reports.view_own"]},
    "waiter": {"name": "Captain / Waiter", "description": "Takes orders for their tables; can't take payments.",
               "permissions": ["orders.create", "tables.view", "tables.transfer", "kitchen.view", "kitchen.update", "menu.view",
                               "customers.view", "offers.apply", "reports.view_own"]},
    "kitchen": {"name": "Kitchen", "description": "Kitchen display only.",
                "permissions": ["kitchen.view", "kitchen.update", "menu.view"]},
}

# --- Features / modules (per business, controlled by plan) ---------------------------------------------------

FEATURES: dict[str, str] = {
    "tables": "Tables & dine-in",
    "kitchen": "Kitchen display & KOTs",
    "online_orders": "Aggregator orders (Swiggy, Zomato, ONDC, magicpin)",
    "qr_ordering": "QR table ordering",
    "online_store": "Own online store",
    "inventory": "Stock & inventory",
    "customers": "Customers & CRM",
    "loyalty": "Loyalty points & rewards",
    "offers": "Offers & discounts",
    "email": "Customer emails",
    "brands": "Multiple brands (cloud kitchen)",
    "staff": "Staff accounts",
    "custom_roles": "Custom roles & permissions",
    "reports": "Sales reports",
    "advanced_reports": "Staff, item & wastage reports, exports",
    "menu_ocr": "Menu from a photo",
    "integrations": "Webhooks & integrations",
    "audit_log": "Audit log",
}
ALL_FEATURES = frozenset(FEATURES)

# Which module a permission belongs to: if the module is off, the permission is off too.
PERMISSION_FEATURE: dict[str, str] = {
    "tables.view": "tables", "tables.manage": "tables", "tables.transfer": "tables",
    "kitchen.view": "kitchen", "kitchen.update": "kitchen",
    "orders.accept_online": "online_orders",
    "inventory.view": "inventory", "inventory.manage": "inventory",
    "customers.view": "customers", "customers.view_contact": "customers", "customers.manage": "customers",
    "offers.apply": "offers", "offers.manage": "offers",
    "reports.view": "reports", "reports.view_own": "reports",
    "staff.view": "staff", "staff.manage": "staff",
    "email.manage": "email",
    "audit.view": "audit_log",
    "channels.manage": "online_orders",
}

# Default plans (inserted by the `platform_defaults` seeder; editable by the super admin afterwards)
DEFAULT_PLANS: list[dict] = [
    {"key": "basic", "name": "Basic", "description": "Single counter shops: billing, menu, customers and daily reports.",
     "price_monthly": 0, "sort_order": 1,
     "features": ["customers", "reports", "inventory", "menu_ocr", "offers", "loyalty"],
     "limits": {"max_staff": 2, "max_products": 500, "max_locations": 1}},
    {"key": "standard", "name": "Standard", "description": "Restaurants & cafés: tables, kitchen display, QR ordering, staff.",
     "price_monthly": 0, "sort_order": 2,
     "features": ["tables", "kitchen", "qr_ordering", "online_store", "inventory", "customers", "loyalty", "offers",
                  "email", "staff", "reports", "menu_ocr"],
     "limits": {"max_staff": 15, "max_products": 3000, "max_locations": 1}},
    {"key": "pro", "name": "Pro", "description": "Large restaurants, chains and cloud kitchens: everything.",
     "price_monthly": 0, "sort_order": 3,
     "features": sorted(ALL_FEATURES),
     "limits": {"max_staff": None, "max_products": None, "max_locations": None}},
]
DEFAULT_PLAN_KEY = "pro"  # free for now: new businesses get everything; the super admin can restrict

PLATFORM_ROLES = {"super_admin": "Full platform control", "support": "Read-only access to businesses for support"}

# --- GST rate library ----------------------------------------------------------------------------------------
# Platform presets the super admin maintains (super admin → Tax library). Rates are versioned by effective date;
# publishing a new version schedules it for every business class that follows the preset.
# Starting point: GST 2.0 slabs (56th GST Council, effective 22 Sep 2025) — verify against the latest CBIC
# notifications before relying on them, and publish new versions when rates change.

def split_gst(total: float) -> list[dict]:
    """Intra-state GST: CGST + SGST, half each."""
    half = round(total / 2, 3)
    return [{"name": "CGST", "rate": half}, {"name": "SGST", "rate": half}] if total else []

GST_2_EFFECTIVE = "2025-09-22T00:00:00"  # dates here are India local time (IST); stored as UTC
DEFAULT_TAX_PRESETS: list[dict] = [
    # key, name, hsn/sac, description, [(effective_from ISO, total rate, note)]
    {"key": "GST_EXEMPT", "name": "Nil rated / exempt (0%)", "hsn_sac": None, "sort_order": 1,
     "description": "Fresh produce, milk, unbranded staples and other nil-rated or exempt supplies.",
     "rates": [("2017-07-01T00:00:00", 0, "Nil / exempt")]},
    {"key": "GST_5_RESTAURANT", "name": "Restaurant service 5% (no ITC)", "hsn_sac": "996331", "sort_order": 2,
     "description": "Restaurants, cafés, cloud kitchens and takeaway (not in hotels with room tariff above ₹7,500).",
     "rates": [("2017-11-15T00:00:00", 5, "Restaurant service at 5% without input tax credit")]},
    {"key": "GST_5", "name": "GST 5%", "hsn_sac": None, "sort_order": 3,
     "description": "Merit rate goods (GST 2.0): most packaged food, daily-use items.",
     "rates": [(GST_2_EFFECTIVE, 5, "GST 2.0 merit rate")]},
    {"key": "GST_18", "name": "GST 18%", "hsn_sac": None, "sort_order": 4,
     "description": "Standard rate goods and services (GST 2.0).",
     "rates": [(GST_2_EFFECTIVE, 18, "GST 2.0 standard rate")]},
    {"key": "GST_18_RESTAURANT_HOTEL", "name": "Hotel restaurant 18% (with ITC)", "hsn_sac": "996332", "sort_order": 5,
     "description": "Restaurants in hotels where any room tariff exceeds ₹7,500 per night.",
     "rates": [("2018-07-27T00:00:00", 18, "Specified premises")]},
    {"key": "GST_40", "name": "GST 40% (demerit goods)", "hsn_sac": None, "sort_order": 6,
     "description": "Aerated / caffeinated beverages, tobacco and other sin/luxury goods (GST 2.0).",
     "rates": [(GST_2_EFFECTIVE, 40, "GST 2.0 demerit rate")]},
    {"key": "GST_3", "name": "GST 3% (gold, silver, jewellery)", "hsn_sac": "7113", "sort_order": 7,
     "description": "Precious metals and jewellery.", "rates": [("2017-07-01T00:00:00", 3, "Precious metals")]},
]

# Tax classes created for every new business (codes → preset), by business type
DEFAULT_TAX_CLASSES = {
    "restaurant": ["GST_5_RESTAURANT", "GST_EXEMPT", "GST_5", "GST_18", "GST_40"],
    "cafe": ["GST_5_RESTAURANT", "GST_EXEMPT", "GST_5", "GST_18", "GST_40"],
    "cloud_kitchen": ["GST_5_RESTAURANT", "GST_EXEMPT", "GST_5", "GST_18", "GST_40"],
    "retail": ["GST_18", "GST_EXEMPT", "GST_5", "GST_40", "GST_3"],
}
GST_REGISTRATION_TYPES = {
    "regular": "Regular GST — Tax invoice with CGST/SGST",
    "composition": "Composition scheme — Bill of supply, no GST on bills",
    "unregistered": "Not registered — Bill without GST",
}
