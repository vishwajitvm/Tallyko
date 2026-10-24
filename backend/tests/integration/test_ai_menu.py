"""End-to-end tests for the menu photo extractor (POST /api/v1/ai/menu/extract and /ai/upload-menu).

The menu image is rendered with Pillow and run through the real RapidOCR engine.
"""
import io
import os
import random

import pytest
from PIL import Image, ImageDraw, ImageFont

from app.core.config import settings

EXTRACT_URL = "/api/v1/ai/menu/extract"
LEGACY_URL = "/api/v1/ai/upload-menu"

FONT_PATHS = {
    "regular": "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "bold": "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
}


def _font(kind: str, size: int):
    path = FONT_PATHS[kind]
    if os.path.exists(path):
        return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)  # Pillow >= 10.1 bundles a scalable default font


@pytest.fixture(autouse=True)
def _per_test_client_ip(monkeypatch):
    """The AI endpoints are rate-limited per client IP (5/min). Honour X-Forwarded-For in these tests so
    each call gets its own bucket instead of every test sharing the ASGI client's 127.0.0.1."""
    monkeypatch.setattr(settings, "TRUST_PROXY", True)


def _client_ip() -> dict:
    return {"X-Forwarded-For": f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"}


def _headers(tenant: dict) -> dict:
    return {**tenant["headers"], **_client_ip()}


def render_menu(fmt: str = "PNG") -> bytes:
    """A dhaba-style menu: two categories, a Half/Full section, prices in the same box and in separate boxes."""
    img = Image.new("RGB", (1100, 1000), "white")
    d = ImageDraw.Draw(img)
    regular, bold, title = _font("regular", 32), _font("bold", 36), _font("bold", 44)
    ink = (20, 20, 20)
    y = 40
    d.text((330, y), "HIGHWAY DHABA", font=title, fill=ink)
    y += 100
    d.text((60, y), "STARTERS", font=bold, fill=ink)
    y += 70
    d.text((60, y), "Paneer Tikka", font=regular, fill=ink)
    d.text((760, y), "240", font=regular, fill=ink)  # separate box
    y += 60
    d.text((60, y), "Veg Spring Roll Rs. 150/-", font=regular, fill=ink)  # same box
    y += 60
    d.text((60, y), "Hara Bhara Kabab ..... 180", font=regular, fill=ink)  # same box, dot leaders
    y += 100
    d.text((60, y), "MAIN COURSE", font=bold, fill=ink)
    d.text((620, y), "Half", font=bold, fill=ink)
    d.text((780, y), "Full", font=bold, fill=ink)
    y += 70
    d.text((60, y), "Dal Makhani", font=regular, fill=ink)
    d.text((620, y), "110", font=regular, fill=ink)
    d.text((780, y), "180", font=regular, fill=ink)
    y += 60
    d.text((60, y), "Kadai Paneer", font=regular, fill=ink)
    d.text((620, y), "160", font=regular, fill=ink)
    d.text((780, y), "280", font=regular, fill=ink)
    y += 60
    d.text((60, y), "Butter Naan", font=regular, fill=ink)
    d.text((780, y), "40", font=regular, fill=ink)
    d.text((250, 900), "Ph: +91 98765 43210", font=regular, fill=ink)

    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def _norm(text: str) -> str:
    return "".join(text.split()).lower()


def _by_name(items: list) -> dict:
    return {_norm(item["name"]): item for item in items}


def _png(size=(64, 64)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_extract_menu_from_rendered_photo(client, tenant_a):
    resp = await client.post(
        EXTRACT_URL,
        headers=_headers(tenant_a),
        files=[("files", ("menu.png", render_menu(), "image/png"))],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) >= {"items", "categories", "lines", "warnings"}
    items = _by_name(body["items"])

    expected = {
        "paneertikka": 240.0,
        "vegspringroll": 150.0,
        "harabharakabab": 180.0,
        "dalmakhani": 180.0,
        "kadaipaneer": 280.0,
        "butternaan": 40.0,
    }
    for name, price in expected.items():
        assert name in items, f"{name} missing from {list(items)}; lines={body['lines']}"
        assert items[name]["price"] == price, items[name]

    dal = items["dalmakhani"]
    assert [(_norm(v["name"]), v["price"]) for v in dal["variants"]] == [("half", 110.0), ("full", 180.0)]
    assert [v["price"] for v in items["kadaipaneer"]["variants"]] == [160.0, 280.0]
    assert items["paneertikka"]["variants"] == []

    assert _norm(items["paneertikka"]["category"]) == "starters"
    assert _norm(items["dalmakhani"]["category"]) == "maincourse"
    assert [_norm(c) for c in body["categories"]] == ["starters", "maincourse"]

    # Title and phone number are not items; raw lines still carry them.
    assert not any("dhaba" in n or "98765" in n for n in items)
    assert any("98765" in line for line in body["lines"])
    for item in body["items"]:
        assert 0.0 < item["confidence"] <= 1.0


@pytest.mark.asyncio
async def test_extract_accepts_multiple_images_including_heic(client, tenant_a):
    resp = await client.post(
        EXTRACT_URL,
        headers=_headers(tenant_a),
        files=[
            ("files", ("menu.jpg", render_menu("JPEG"), "image/jpeg")),
            # Phones often send HEIC with a generic content type; the bytes are what count.
            ("files", ("IMG_0001.HEIC", render_menu("HEIF"), "application/octet-stream")),
        ],
    )
    assert resp.status_code == 200, resp.text
    items = _by_name(resp.json()["items"])
    # The two photos show the same menu, so items are de-duplicated.
    assert items["paneertikka"]["price"] == 240.0
    assert sum(1 for item in resp.json()["items"] if _norm(item["name"]) == "paneertikka") == 1


@pytest.mark.asyncio
async def test_legacy_upload_menu_alias(client, tenant_a):
    resp = await client.post(
        LEGACY_URL,
        headers=_headers(tenant_a),
        files={"file": ("menu.png", render_menu(), "image/png")},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) >= {"items", "categories", "lines", "warnings", "extracted_items"}
    assert "paneertikka" in _by_name(body["items"])


@pytest.mark.asyncio
async def test_extract_requires_auth(client):
    resp = await client.post(
        EXTRACT_URL,
        headers=_client_ip(),
        files=[("files", ("menu.png", _png(), "image/png"))],
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_non_image_file_is_rejected(client, tenant_a):
    # Declared as PNG, but the bytes are text: validation must not trust content_type.
    resp = await client.post(
        EXTRACT_URL,
        headers=_headers(tenant_a),
        files=[("files", ("menu.png", b"Paneer Tikka 240\nDal Makhani 180\n", "image/png"))],
    )
    assert resp.status_code == 400, resp.text
    assert "not a supported image" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_unsupported_image_format_is_rejected(client, tenant_a):
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), "white").save(buf, format="GIF")
    resp = await client.post(
        EXTRACT_URL,
        headers=_headers(tenant_a),
        files=[("files", ("menu.gif", buf.getvalue(), "image/gif"))],
    )
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_too_many_files_is_rejected(client, tenant_a):
    files = [("files", (f"menu{i}.png", _png(), "image/png")) for i in range(6)]
    resp = await client.post(EXTRACT_URL, headers=_headers(tenant_a), files=files)
    assert resp.status_code == 400, resp.text
    assert "between 1 and 5" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_oversized_file_is_rejected(client, tenant_a):
    resp = await client.post(
        EXTRACT_URL,
        headers=_headers(tenant_a),
        files=[("files", ("huge.jpg", b"\xff" * (10 * 1024 * 1024 + 1), "image/jpeg"))],
    )
    assert resp.status_code == 400, resp.text
    assert "larger than 10 MB" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_decompression_bomb_is_rejected(client, tenant_a):
    buf = io.BytesIO()
    Image.new("1", (9000, 8000)).save(buf, format="PNG")  # ~9 KB file, 72 megapixels
    resp = await client.post(
        EXTRACT_URL,
        headers=_headers(tenant_a),
        files=[("files", ("bomb.png", buf.getvalue(), "image/png"))],
    )
    assert resp.status_code == 400, resp.text
    assert "too large" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_missing_files_field_is_a_validation_error(client, tenant_a):
    resp = await client.post(EXTRACT_URL, headers=_headers(tenant_a))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_extract_is_rate_limited_per_ip(client, tenant_a):
    same_ip = {**tenant_a["headers"], **_client_ip()}
    statuses = []
    for _ in range(6):
        resp = await client.post(
            EXTRACT_URL, headers=same_ip, files=[("files", ("menu.png", b"not an image", "image/png"))]
        )
        statuses.append(resp.status_code)
    assert statuses[:5] == [400] * 5
    assert statuses[5] == 429
