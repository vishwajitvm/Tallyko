"""Menu photo -> structured menu items (feature 011 / docs/features/010_AI_Menu_Generator.md).

Pipeline:
    bytes --load_image()--> preprocessed RGB PIL image
          --run_ocr()-----> RapidOCR results: [[box(4 x [x, y]), text, score], ...]
          --parse_menu()--> {"items", "categories", "lines", "warnings"}

``parse_menu`` is a pure function (no I/O, no OCR) so it can be unit-tested with synthetic OCR
results. Everything here is CPU-bound and synchronous; the API layer runs it in a threadpool.

OCR engine: RapidOCR (PaddleOCR models on onnxruntime, Apache-2.0, models bundled, CPU only).
"""
from __future__ import annotations

import io
import logging
import math
import re
import statistics
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from PIL import Image, ImageOps

logger = logging.getLogger("tallyko")

try:  # iPhone photos are HEIC; pillow-heif plugs a HEIF decoder into Pillow.
    import pillow_heif

    pillow_heif.register_heif_opener()
    HEIF_SUPPORTED = True
except Exception:  # pragma: no cover - only when the optional wheel is missing
    HEIF_SUPPORTED = False
    logger.warning("[AI] pillow-heif not available; HEIC/HEIF menu photos will be rejected")


# --------------------------------------------------------------------------------------------
# Image loading / preprocessing
# --------------------------------------------------------------------------------------------

MAX_IMAGE_PIXELS = 64_000_000  # ~64 MP: covers 48/50 MP phone photos, rejects decompression bombs
MAX_LONG_SIDE = 2200
MIN_LONG_SIDE = 900
UPSCALE_TARGET = 1400
MAX_UPSCALE = 4.0
ALLOWED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP", "HEIF", "HEIC"}


class MenuImageError(ValueError):
    """Raised for bad user input (not an image, unsupported format, too large). Message is user-facing."""


def load_image(data: bytes) -> Image.Image:
    """Decode and validate an uploaded image, then preprocess it for OCR.

    Validation is done by actually decoding the bytes with Pillow; the declared content type is ignored.
    """
    if not data:
        raise MenuImageError("File is empty.")
    try:
        img = Image.open(io.BytesIO(data))
    except Image.DecompressionBombError:
        raise MenuImageError("Image resolution is too large.")
    except Exception:
        raise MenuImageError("File is not a supported image (JPEG, PNG, WEBP or HEIC).")

    fmt = (img.format or "").upper()
    if fmt not in ALLOWED_FORMATS:
        raise MenuImageError(
            f"Unsupported image format '{fmt or 'unknown'}'. Use JPEG, PNG, WEBP or HEIC."
        )
    width, height = img.size
    if width * height > MAX_IMAGE_PIXELS:
        raise MenuImageError(
            f"Image resolution is too large ({width}x{height}); max {MAX_IMAGE_PIXELS // 1_000_000} megapixels."
        )
    if width < 16 or height < 16:
        raise MenuImageError("Image is too small to contain a readable menu.")

    if fmt in ("JPEG", "MPO"):
        # Let libjpeg decode at a reduced scale when the photo is much bigger than we need.
        img.draft("RGB", (MAX_LONG_SIDE, MAX_LONG_SIDE))
    try:
        img.load()
    except Image.DecompressionBombError:
        raise MenuImageError("Image resolution is too large.")
    except Exception:
        raise MenuImageError("Image file is corrupt or truncated.")
    return preprocess_image(img)


def preprocess_image(img: Image.Image) -> Image.Image:
    """EXIF-rotate, flatten to RGB on white, and scale so the longest side is in a readable range."""
    img = ImageOps.exif_transpose(img)

    if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    width, height = img.size
    longest = max(width, height)
    if longest > MAX_LONG_SIDE:
        scale = MAX_LONG_SIDE / longest
    elif longest < MIN_LONG_SIDE:
        scale = min(UPSCALE_TARGET / longest, MAX_UPSCALE)
    else:
        return img
    new_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return img.resize(new_size, Image.LANCZOS)


# --------------------------------------------------------------------------------------------
# OCR
# --------------------------------------------------------------------------------------------

_engine = None
_engine_lock = threading.Lock()
# onnxruntime already uses all cores for one image; serialising calls keeps memory predictable and
# avoids relying on RapidOCR's Python wrappers being re-entrant.
_infer_lock = threading.Lock()


def _get_engine():
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                from rapidocr_onnxruntime import RapidOCR

                logger.info("[AI] Loading RapidOCR engine")
                _engine = RapidOCR()
    return _engine


def run_ocr(img: Image.Image) -> List[list]:
    """Run OCR on an RGB image. Returns RapidOCR's ``[[box, text, score], ...]`` (empty list if no text)."""
    import numpy as np

    engine = _get_engine()
    with _infer_lock:
        result, _elapse = engine(np.asarray(img))
    return list(result or [])


def extract_menu_from_image(img: Image.Image) -> Dict[str, Any]:
    """OCR + parse one preprocessed image (blocking; call from a threadpool)."""
    return parse_menu(run_ocr(img), img.width)


# --------------------------------------------------------------------------------------------
# Parsing (pure)
# --------------------------------------------------------------------------------------------

MIN_PRICE = 1
MAX_PRICE = 99999

VARIANT_LABELS = {
    "half": "Half", "full": "Full", "qtr": "Qtr", "quarter": "Quarter",
    "small": "Small", "medium": "Medium", "med": "Medium", "large": "Large", "lg": "Large",
    "regular": "Regular", "reg": "Regular", "single": "Single", "double": "Double", "triple": "Triple",
    "mini": "Mini", "jumbo": "Jumbo", "family": "Family", "personal": "Personal",
    "glass": "Glass", "jug": "Jug", "bottle": "Bottle", "cup": "Cup", "pitcher": "Pitcher",
}
DEFAULT_LABELS = {2: ["Half", "Full"], 3: ["Small", "Medium", "Large"]}

# Column-header words such as "ITEM  PRICE" / "Particulars  Rate".
HEADER_WORDS = {
    "item", "items", "price", "prices", "rate", "rates", "amount", "particulars", "description",
    "qty", "quantity", "rs", "inr", "sr", "no", "s.no", "sno", "sl", "name", "dish", "dishes",
}

_PHONE_RE = re.compile(r"(?:\+?91[\s-]*)?(?:\d[\s-]?){9,}\d")
_PHONE_WORD_RE = re.compile(r"\b(ph|phone|mob|mobile|tel|call|contact|whatsapp|cell)\b\.?", re.I)
_GSTIN_RE = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b", re.I)
_LICENSE_RE = re.compile(r"\b(gstin|gst\s*no|gst\s*#|fssai|lic(?:ense|ence)?\s*no|cin|pan\s*no)\b", re.I)
_TIME_RE = re.compile(
    r"\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])|\b\d{1,2}:\d{2}\b|\b(timings?|open|closed|hours)\b",
    re.I,
)
_WEB_RE = re.compile(r"(www\.|https?:|\.com\b|\.in\b|@|instagram|facebook|follow us|zomato|swiggy)", re.I)
_TAX_RE = re.compile(
    r"\b(tax|taxes|gst|vat|service charge|inclusive|exclusive|subject to|terms|conditions|"
    r"thank\s*you|visit again|welcome|home delivery|free delivery|order online|we accept|"
    r"prices? (?:are|may)|all prices|rates? (?:are|may))\b",
    re.I,
)
_TITLE_RE = re.compile(r"\b(menu|menu card|price list|rate list|rate card)\b", re.I)
_YEAR_RE = re.compile(r"\b(since|est|estd|established)\b\.?\s*(?:in\s*)?(19|20)\d{2}\b", re.I)
_ADDRESS_WORD_RE = re.compile(
    r"\b(road|rd|marg|nagar|chowk|highway|nh|sector|street|colony|bazaar|bazar|village|vill|dist|"
    r"district|tehsil|pin|pincode|bypass|lane|gali|mohalla|plot|shop\s*no|near|opp|opposite|address)\b",
    re.I,
)
_ADDRESS_STRONG_RE = re.compile(r"^\s*(near|opp|opposite|address|add)\b|\b\d{6}\b", re.I)

_THOUSANDS_RE = re.compile(r"(?<![\d,.])(\d),(\d{3})(?![\d,])")
_CURRENCY_PREFIX_RE = re.compile(r"(?:₹|\b(?:rs|inr)(?![a-z]))[\s.:\-]*(?=[\dOoIl])", re.I)
_CURRENCY_SUFFIX_RE = re.compile(r"(?<=\d)\s*(?:/\s*[-=]|(?:rs|inr)\b\.?)", re.I)
# "160/280", "160 | 280", "160, 280" and unspaced "160-280" separate variant prices. A spaced dash
# ("Chicken 65 - 220") is treated as a leader instead, so dish numbers stay in the name.
_PRICE_SEP_RE = re.compile(r"(?<=[\dOo])\s*[/|,]\s*(?=[₹\dOoIl])|(?<=\d)[–—-](?=\d)")
_LEADER_RE = re.compile(r"\.{2,}|…+|·{2,}|_{2,}|-{2,}|~{2,}|={2,}|[:*•·]")
_ORPHAN_SEP_RE = re.compile(r"(?<=\s)[|/](?=\s)")
_ORPHAN_DASH_RE = re.compile(r"(?<=\s)[-–—]+(?=\s)")
_SERIAL_RE = re.compile(r"^\s*\(?\d{1,3}\s*[.)]\s+")
_PRICE_TOKEN_RE = re.compile(r"[0-9OoIl]{1,5}(?:\.[0-9Oo]{1,2})?")
_CUR_MARK = "₹"


@dataclass
class _Box:
    text: str
    score: float
    x0: float
    y0: float
    x1: float
    y1: float
    idx: int

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def h(self) -> float:
        return max(self.y1 - self.y0, 1.0)


@dataclass
class _Tok:
    kind: str  # "word" | "price" | "sep" | "cur"
    text: str
    x: float
    box: int
    value: Optional[float] = None
    cur: bool = False


@dataclass
class _Row:
    boxes: List[_Box]
    raw: str
    name: str = ""
    prices: List[Tuple[float, float]] = field(default_factory=list)  # (value, x)
    labels: List[Tuple[str, float]] = field(default_factory=list)    # variant header labels
    used: List[_Box] = field(default_factory=list)
    ctx_labels: List[Tuple[str, float]] = field(default_factory=list)  # section labels for variants
    kind: str = "noise"  # "priced" | "text" | "labels" | "noise"

    @property
    def cy(self) -> float:
        return sum(b.cy for b in self.boxes) / len(self.boxes)

    @property
    def h(self) -> float:
        return statistics.median(b.h for b in (self.used or self.boxes))


def _parse_price_value(token: str) -> Optional[float]:
    """'180' -> 180.0, '180.00' -> 180.0, 'l20' -> 120.0, '2OO' -> 200.0; None when not a price."""
    t = token.strip(".,;:()[]{}'\"!")
    if not t or not _PRICE_TOKEN_RE.fullmatch(t) or not re.search(r"\d", t):
        return None
    t = t.translate(str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1"}))
    try:
        value = float(t)
    except ValueError:
        return None
    if not (MIN_PRICE <= value <= MAX_PRICE):
        return None
    return round(value, 2)


def _normalize_text(text: str) -> str:
    t = text.replace(" ", " ")
    t = _THOUSANDS_RE.sub(r"\1\2", t)
    t = _CURRENCY_SUFFIX_RE.sub(" ", t)
    t = _CURRENCY_PREFIX_RE.sub(f" {_CUR_MARK} ", t)
    t = t.replace(_CUR_MARK, f" {_CUR_MARK} ")
    t = _PRICE_SEP_RE.sub(" / ", t)
    t = _LEADER_RE.sub(" ", t)
    t = _ORPHAN_SEP_RE.sub(" / ", f" {t} ")
    t = _ORPHAN_DASH_RE.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


def _tokenize_box(box: _Box) -> List[_Tok]:
    norm = _normalize_text(box.text)
    if not norm:
        return []
    width = box.x1 - box.x0
    toks: List[_Tok] = []
    for m in re.finditer(r"\S+", norm):
        piece = m.group(0)
        x = box.x0 + width * ((m.start() + m.end()) / 2) / max(len(norm), 1)
        if piece == _CUR_MARK:
            toks.append(_Tok("cur", piece, x, box.idx))
        elif piece == "/":
            toks.append(_Tok("sep", piece, x, box.idx))
        else:
            value = _parse_price_value(piece)
            if value is not None:
                toks.append(_Tok("price", piece, x, box.idx, value=value))
            else:
                toks.append(_Tok("word", piece, x, box.idx))
    # A currency mark applies to the price right after it.
    for i, tok in enumerate(toks[:-1]):
        if tok.kind == "cur" and toks[i + 1].kind == "price":
            toks[i + 1].cur = True
    return toks


def _letters(text: str) -> int:
    return sum(1 for c in text if c.isalpha())


def _is_noise_text(text: str) -> bool:
    """Box-level noise: contact details, licences, timings, footers, titles, garbage."""
    t = text.strip()
    if sum(1 for c in t if c.isalnum()) <= 1:
        return True
    if _PHONE_RE.search(t) or _GSTIN_RE.search(t) or _LICENSE_RE.search(t) or _WEB_RE.search(t):
        return True
    if _PHONE_WORD_RE.search(t) and re.search(r"\d{4,}", t.replace(" ", "")):
        return True
    if _TIME_RE.search(t) or _YEAR_RE.search(t) or _TAX_RE.search(t):
        return True
    if _ADDRESS_WORD_RE.search(t) and ("," in t or _ADDRESS_STRONG_RE.search(t)):
        return True
    if _TITLE_RE.search(t) and not any(tok.kind == "price" for tok in _tokenize_box(_Box(t, 0, 0, 0, 1, 1, -1))):
        return True
    return False


def _smart_case(text: str) -> str:
    """Title-case ALL-CAPS text ('PANEER TIKKA (VEG) 250ML' -> 'Paneer Tikka (Veg) 250ml')."""
    letters = [c for c in text if c.isalpha()]
    if len(letters) < 2 or any(c.islower() for c in letters):
        return text

    def fix(m: "re.Match[str]") -> str:
        word = m.group(0)
        if m.start() > 0 and text[m.start() - 1].isdigit():
            return word.lower()
        return word.capitalize()

    return re.sub(r"[A-Za-z]+", fix, text)


def _clean_name(text: str) -> str:
    t = text.replace(_CUR_MARK, " ")
    t = re.sub(r"\s*/\s*$", "", t)
    t = _SERIAL_RE.sub("", t)
    # OCR sometimes drops the space between words: "PaneerTikka" -> "Paneer Tikka".
    t = re.sub(r"(?<=[a-z]{2})(?=[A-Z][a-z])", " ", t)
    t = re.sub(r"(?<=[A-Za-z]{3})(?=\d)", " ", t)  # "Lassi250ml" -> "Lassi 250ml"
    t = re.sub(r"(?<=[A-Za-z])\(", " (", t)  # "Sambhar(2 pcs)" -> "Sambhar (2 pcs)"
    t = re.sub(r"\s+", " ", t).strip()
    t = t.strip(" .,:;-_*|•·~=>/\\'\"")
    if t.endswith("(") or (t.count("(") > t.count(")") and t.rstrip().endswith("(")):
        t = t.rstrip("( ")
    if t.count("(") > t.count(")"):
        t = t + ")"
    if t.startswith(")"):
        t = t.lstrip(") ")
    return _smart_case(re.sub(r"\s+", " ", t).strip())


def _deskew(boxes: List[_Box], raw_points: List[List[Tuple[float, float]]]) -> List[_Box]:
    """Rotate box coordinates so text lines are horizontal (handles slightly tilted phone photos)."""
    angles = []
    for b, pts in zip(boxes, raw_points):
        (x0, y0), (x1, y1) = pts[0], pts[1]
        width = math.hypot(x1 - x0, y1 - y0)
        if width > 3 * b.h:
            angles.append(math.atan2(y1 - y0, x1 - x0))
    if len(angles) < 3:
        return boxes
    angle = statistics.median(angles)
    if abs(math.degrees(angle)) < 0.3 or abs(math.degrees(angle)) > 15:
        return boxes
    cos_a, sin_a = math.cos(-angle), math.sin(-angle)
    out = []
    for b, pts in zip(boxes, raw_points):
        rot = [(x * cos_a - y * sin_a, x * sin_a + y * cos_a) for x, y in pts]
        xs, ys = [p[0] for p in rot], [p[1] for p in rot]
        out.append(_Box(b.text, b.score, min(xs), min(ys), max(xs), max(ys), b.idx))
    return out


def _box_has_price(box: _Box) -> bool:
    return any(t.kind == "price" for t in _tokenize_box(box))


def _is_name_like(box: _Box) -> bool:
    words = [w for w in re.findall(r"[A-Za-z]+", box.text)]
    if _letters(box.text) < 3 or not words:
        return False
    return not all(w.lower() in VARIANT_LABELS or w.lower() in HEADER_WORDS for w in words)


def _split_columns(boxes: List[_Box], image_width: Optional[float]) -> List[List[_Box]]:
    """Split side-by-side menu columns at vertical gutters.

    A gutter is a wide vertical strip covered by (almost) no boxes. To avoid splitting a single menu
    between its name column and its price column, a split is accepted only when the left part
    (up to the next gutter) contains prices and the strip right of it starts with item names.
    """
    if len(boxes) < 6:
        return [boxes]
    med_h = statistics.median(b.h for b in boxes)
    x_min = int(math.floor(min(b.x0 for b in boxes)))
    x_max = int(math.ceil(max(b.x1 for b in boxes)))
    span = x_max - x_min + 1
    diff = [0] * (span + 1)
    for b in boxes:
        if _is_noise_text(b.text):
            continue  # footers (phone, address) often span the whole width
        s, e = int(b.x0) - x_min, int(math.ceil(b.x1)) - x_min
        diff[max(s, 0)] += 1
        diff[min(e, span)] -= 1
    coverage, running = [], 0
    for i in range(span):
        running += diff[i]
        coverage.append(running)

    allowed = max(2, int(0.08 * len(boxes)))  # titles/full-width headings may straddle the gutter
    min_gap = max(1.5 * med_h, 0.03 * (image_width or span))
    gutters: List[float] = []
    i = 0
    while i < span:
        if coverage[i] <= allowed:
            j = i
            while j < span and coverage[j] <= allowed:
                j += 1
            if i > 0 and j < span and (j - i) >= min_gap:
                gutters.append(x_min + (i + j) / 2)
            i = j
        else:
            i += 1

    splits: List[float] = []
    left_edge = -math.inf
    for k, g in enumerate(gutters):
        next_g = gutters[k + 1] if k + 1 < len(gutters) else math.inf
        left = [b for b in boxes if left_edge <= b.cx < g]
        # Only look up to the next candidate gutter: the strip right of a name|price gap holds just
        # prices, while the strip right of a real column gap starts with item names.
        right = [b for b in boxes if g <= b.cx < next_g]
        if (
            len(left) >= 3
            and len(right) >= 2
            and any(_box_has_price(b) for b in left)
            and sum(1 for b in right if _is_name_like(b)) >= 2
        ):
            splits.append(g)
            left_edge = g
    if not splits:
        return [boxes]
    edges = [-math.inf] + splits + [math.inf]
    columns = [[b for b in boxes if edges[k] <= b.cx < edges[k + 1]] for k in range(len(edges) - 1)]
    return [c for c in columns if c]


def _group_rows(boxes: List[_Box]) -> List[List[_Box]]:
    """Group boxes into visual text rows by vertical overlap, then sort each row left to right."""
    rows: List[Dict[str, Any]] = []
    for b in sorted(boxes, key=lambda b: b.cy):
        best, best_overlap = None, 0.0
        for row in rows[-4:]:
            half = row["h"] / 2
            overlap = min(row["cy"] + half, b.y1) - max(row["cy"] - half, b.y0)
            if overlap < 0.5 * min(row["h"], b.h) or abs(row["cy"] - b.cy) > 0.7 * max(row["h"], b.h):
                continue
            # Two boxes stacked in the same x-range are different lines, not one row.
            if any(min(o.x1, b.x1) - max(o.x0, b.x0) > 0.3 * min(o.x1 - o.x0, b.x1 - b.x0) for o in row["boxes"]):
                continue
            if overlap > best_overlap:
                best, best_overlap = row, overlap
        if best is None:
            rows.append({"boxes": [b], "cy": b.cy, "h": b.h})
        else:
            best["boxes"].append(b)
            n = len(best["boxes"])
            best["cy"] = (best["cy"] * (n - 1) + b.cy) / n
            best["h"] = statistics.median(o.h for o in best["boxes"])
    rows.sort(key=lambda r: r["cy"])
    return [sorted(r["boxes"], key=lambda b: b.x0) for r in rows]


def _label_tolerance(labels: List[Tuple[str, float]], row_h: float) -> float:
    xs = sorted(x for _, x in labels)
    gaps = [b - a for a, b in zip(xs, xs[1:]) if b - a > 0]
    return max(0.5 * min(gaps), row_h) if gaps else 3 * row_h


def _parse_row(boxes: List[_Box], labels: List[Tuple[str, float]]) -> _Row:
    """Turn one visual row into a name + trailing prices (or a variant-label header / plain text)."""
    raw = " ".join(b.text.strip() for b in boxes)
    row = _Row(boxes=boxes, raw=raw)
    kept = [b for b in boxes if not _is_noise_text(b.text)]
    if not kept:
        return row
    row_h = statistics.median(b.h for b in kept)
    box_toks = {b.idx: _tokenize_box(b) for b in kept}
    pure_price_box = {
        idx: bool(toks) and all(t.kind != "word" for t in toks) and any(t.kind == "price" for t in toks)
        for idx, toks in box_toks.items()
    }
    toks = [t for b in kept for t in box_toks[b.idx]]
    if not toks:
        return row

    # Variant header ("Half Full", "MAIN COURSE  Half  Full", "Qtr Half Full").
    if not any(t.kind == "price" for t in toks):
        k = len(toks)
        while k > 0 and toks[k - 1].kind == "word" and toks[k - 1].text.strip(".,:;()").lower() in VARIANT_LABELS:
            k -= 1
        if len(toks) - k >= 2:
            row.labels = [(VARIANT_LABELS[t.text.strip(".,:;()").lower()], t.x) for t in toks[k:]]
            row.name = _clean_name(" ".join(t.text for t in toks[:k]))
            row.used = kept
            row.kind = "labels"
            return row

    # Walk from the right collecting price tokens.
    tolerance = _label_tolerance(labels, row_h) if labels else 0.0
    accepted: List[_Tok] = []
    saw_sep = False
    i = len(toks) - 1
    while i >= 0:
        t = toks[i]
        if t.kind in ("sep", "cur"):
            saw_sep = saw_sep or t.kind == "sep"
            i -= 1
            continue
        if t.kind != "price":
            break
        if accepted:
            prev = accepted[-1]
            explicit = (
                saw_sep
                or (t.box != prev.box and pure_price_box.get(t.box, False))
                or (t.cur and prev.cur)
            )
            aligned = (
                bool(labels)
                and len(accepted) < len(labels)
                and any(abs(t.x - lx) <= tolerance for _, lx in labels)
            )
            if not (explicit or aligned):
                break
        accepted.append(t)
        saw_sep = False
        i -= 1

    name_toks = toks[: i + 1]
    while name_toks and name_toks[-1].kind in ("sep", "cur"):
        name_toks.pop()
    name = _clean_name(" ".join(t.text for t in name_toks if t.kind != "cur"))
    used_idx = {t.box for t in name_toks} | {t.box for t in accepted}
    row.used = [b for b in kept if b.idx in used_idx] or kept
    row.prices = [(t.value, t.x) for t in reversed(accepted)]

    words = re.findall(r"[A-Za-z]+", name)
    if words and all(w.lower() in HEADER_WORDS for w in words):  # "ITEM  PRICE" column headers
        return row
    if _letters(name) < 2:
        return row  # price-only row ("lines that are only numbers"), or garbage
    row.name = name
    row.kind = "priced" if row.prices else "text"
    return row


def _variant_labels(prices: List[Tuple[float, float]], labels: List[Tuple[str, float]]) -> List[str]:
    n = len(prices)
    if labels:
        if n == len(labels):
            return [lab for lab, _ in labels]
        chosen = [min(labels, key=lambda lab: abs(lab[1] - x))[0] for _, x in prices]
        if len(set(chosen)) == n:
            return chosen
    if n in DEFAULT_LABELS:
        return list(DEFAULT_LABELS[n])
    return [f"Option {k + 1}" for k in range(n)]


def _looks_like_heading(name: str) -> bool:
    words = name.split()
    return 1 <= len(words) <= 5 and len(name) <= 40 and not name[0].islower() and not name.endswith(".")


def _looks_like_item_name(name: str) -> bool:
    words = name.split()
    return 1 <= len(words) <= 8 and len(name) <= 60 and not name[0].islower() and name[0] not in "(["


def _is_all_caps(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return len(letters) >= 2 and all(c.isupper() for c in letters)


def parse_menu(ocr_results: Optional[Sequence[Sequence[Any]]], image_width: Optional[float] = None) -> Dict[str, Any]:
    """Parse RapidOCR output (``[[box, text, score], ...]``) into menu items.

    Returns ``{"items": [...], "categories": [...], "lines": [...], "warnings": [...]}`` where each item is
    ``{"name", "price", "category", "variants": [{"name", "price"}], "confidence"}``.
    """
    boxes: List[_Box] = []
    raw_points: List[List[Tuple[float, float]]] = []
    for idx, entry in enumerate(ocr_results or []):
        try:
            pts, text, score = entry[0], str(entry[1] or ""), float(entry[2])
            pts = [(float(p[0]), float(p[1])) for p in pts]
        except (TypeError, ValueError, IndexError):
            continue
        if not text.strip() or len(pts) < 4:
            continue
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        boxes.append(_Box(text.strip(), score, min(xs), min(ys), max(xs), max(ys), idx))
        raw_points.append(pts)

    if not boxes:
        return {"items": [], "categories": [], "lines": [], "warnings": ["No text was detected in the image."]}

    boxes = _deskew(boxes, raw_points)
    columns = _split_columns(boxes, image_width)

    lines: List[str] = []
    items: List[Dict[str, Any]] = []
    category: Optional[str] = None
    labels: List[Tuple[str, float]] = []
    section_active = False

    for column in columns:  # left to right; category/labels carry over (newspaper-style flow)
        rows = [_parse_row(row_boxes, []) for row_boxes in _group_rows(column)]
        lines.extend(r.raw for r in rows)

        significant = [r for r in rows if r.kind != "noise"]
        stats = _column_stats(significant)
        for pos, row in enumerate(significant):
            prev = significant[pos - 1] if pos > 0 else None
            nxt = significant[pos + 1] if pos + 1 < len(significant) else None
            if row.kind == "labels":
                # "Half Full" header (optionally after a heading on the same row): applies to the rows
                # below until the next heading or header.
                labels = row.labels
                if row.name and _looks_like_heading(row.name):
                    category = row.name
                section_active = True
            elif row.kind == "priced":
                if labels:
                    # Re-parse knowing the label columns, so prices aligned under them become variants.
                    row = _parse_row(row.boxes, labels)
                    row.ctx_labels = labels
                items.append(_make_item(row, category))
                section_active = True
            elif (
                nxt is not None
                and nxt.kind in ("priced", "labels")
                and _looks_like_heading(row.name)
                and _has_heading_signal(row, prev, stats)
            ):
                category = row.name  # heading: a text row followed by priced rows
                labels = []
                section_active = True
            elif nxt is not None and nxt.kind == "text" and _is_all_caps(row.raw) and _is_all_caps(nxt.raw):
                continue  # restaurant name / super-heading stacked above a heading
            elif section_active and _looks_like_item_name(row.name):
                items.append(_make_item(row, category))  # item whose price was not read
            # else: title/preamble or a description line -> skipped (still present in "lines")

    items = _dedupe(items)
    categories: List[str] = []
    for item in items:
        if item["category"] and item["category"] not in categories:
            categories.append(item["category"])

    warnings: List[str] = []
    if not items:
        warnings.append("No menu items with prices were recognised. Try a sharper, well-lit photo taken straight on.")
    missing = sum(1 for it in items if it["price"] is None)
    if missing:
        warnings.append(f"{missing} item(s) have no price; please fill them in.")
    low = sum(1 for it in items if it["confidence"] < 0.6)
    if low:
        warnings.append(f"{low} item(s) were read with low confidence; please double-check them.")
    return {"items": items, "categories": categories, "lines": lines, "warnings": warnings}


def _column_stats(rows: List[_Row]) -> Dict[str, float]:
    priced = [r for r in rows if r.kind == "priced"]
    sample = priced or rows
    item_h = statistics.median(r.h for r in sample) if sample else 1.0
    gaps = [b.cy - a.cy for a, b in zip(rows, rows[1:]) if b.cy > a.cy]
    pitch = statistics.median(gaps) if gaps else 1.6 * item_h
    caps = (sum(1 for r in priced if _is_all_caps(r.name)) / len(priced)) if priced else 0.0
    return {"item_h": item_h, "pitch": pitch, "caps_items": caps}


def _has_heading_signal(row: _Row, prev: Optional[_Row], stats: Dict[str, float]) -> bool:
    """Tell a section heading from an item whose price was not read (both are text rows before a priced row)."""
    if prev is None or prev.kind not in ("priced", "text"):
        return True  # first row of the column, or right after a label header / heading
    if _is_all_caps(row.raw) and stats["caps_items"] < 0.5:
        return True  # "BEVERAGES" among mixed-case items
    if row.h >= 1.15 * stats["item_h"]:
        return True  # bigger font
    return (row.cy - prev.cy) >= 1.25 * stats["pitch"]  # extra space above


def _make_item(row: _Row, category: Optional[str]) -> Dict[str, Any]:
    prices = row.prices
    variants: List[Dict[str, Any]] = []
    if len(prices) >= 2:
        names = _variant_labels(prices, row.ctx_labels)
        variants = [{"name": n, "price": p} for n, (p, _) in zip(names, prices)]
    price = max(p for p, _ in prices) if prices else None
    used = row.used or row.boxes
    confidence = round(sum(b.score for b in used) / len(used), 2) if used else 0.0
    return {"name": row.name, "price": price, "category": category, "variants": variants, "confidence": confidence}


def _dedupe(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out = []
    for item in items:
        # Ignore spacing/punctuation so "PaneerTikka" and "Paneer Tikka" from two photos collapse.
        key = (re.sub(r"[^0-9a-z]", "", item["name"].lower()), item["price"])
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def merge_results(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Combine per-image parse results (multi-photo upload) into one response."""
    items: List[Dict[str, Any]] = []
    lines: List[str] = []
    warnings: List[str] = []
    multi = len(results) > 1
    for n, res in enumerate(results, start=1):
        items.extend(res["items"])
        lines.extend(res["lines"])
        warnings.extend(f"Image {n}: {w}" if multi else w for w in res["warnings"])
    items = _dedupe(items)
    categories: List[str] = []
    for item in items:
        if item["category"] and item["category"] not in categories:
            categories.append(item["category"])
    return {"items": items, "categories": categories, "lines": lines, "warnings": warnings}
