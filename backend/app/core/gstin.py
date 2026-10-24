"""GSTIN (GST identification number) validation.

Format (15 characters): 2-digit state code · 10-character PAN · entity number (1-9, A-Z) · "Z" · check character.
The check character is the GSTN's mod-36 checksum, so typos are caught before anything is billed with GST.
Only a business with GST registration "regular" **and** a valid GSTIN charges GST; everyone else issues a Bill of Supply.
"""
import re

CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
PATTERN = re.compile(r"^([0-9]{2})([A-Z]{5}[0-9]{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$")
STATES = {
    "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
    "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
    "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
    "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
    "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep",
    "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana",
    "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction",
}

def check_char(first14: str) -> str:
    total = 0
    for i, ch in enumerate(first14):
        product = CHARSET.index(ch) * (2 if i % 2 else 1)
        total += product // 36 + product % 36
    return CHARSET[(36 - total % 36) % 36]

def normalize(value: str | None) -> str | None:
    cleaned = re.sub(r"[\s-]", "", value or "").upper()
    return cleaned or None

def validate(value: str | None) -> tuple[bool, str | None]:
    """(ok, error message for a shopkeeper)."""
    gstin = normalize(value)
    if not gstin:
        return False, "Enter your GSTIN"
    if len(gstin) != 15:
        return False, "A GSTIN has 15 characters"
    match = PATTERN.match(gstin)
    if not match:
        return False, "This doesn't look like a GSTIN (e.g. 27ABCDE1234F1Z5)"
    if match.group(1) not in STATES:
        return False, f"{match.group(1)} isn't a valid state code"
    if check_char(gstin[:14]) != gstin[14]:
        return False, "This GSTIN has a typo (its last character doesn't match). Check it on your GST certificate"
    return True, None

def is_valid(value: str | None) -> bool:
    return validate(value)[0]

def state_of(value: str | None) -> str | None:
    gstin = normalize(value)
    return STATES.get(gstin[:2]) if gstin and is_valid(gstin) else None

def charges_gst(registration: str | None, gstin: str | None) -> bool:
    return (registration or "regular") == "regular" and is_valid(gstin)
