# Menu from a Photo

## For the business owner

Setting up a menu by hand is slow. Instead, photograph any printed menu — your old one, a supplier list, or the menu of a dhaba whose dishes you also serve — and Tallyko reads the item names, categories and prices (including Half/Full or Small/Medium/Large prices). You review everything in an editable list, fix anything it misread, add more items, and import with one tap.

Tips for best results: flat, well-lit, whole page in frame, one page per photo (up to 5 photos at once). Printed or painted English menus work best; Hindi/other scripts and handwritten chalk boards are not read reliably yet.

It's free and private: the photo is processed on your own Tallyko server (no paid AI service) and isn't stored.

## For the developer

- Endpoint: `POST /api/v1/ai/menu/extract` (multipart `files`, 1–5 images, JPEG/PNG/WEBP/HEIC, ≤10 MB each, ≤64 MP; JWT required; 5 requests/min per IP). Legacy alias `POST /api/v1/ai/upload-menu` (single `file`).
- Response: `{items: [{name, price|null, category|null, variants: [{name, price}], confidence}], categories, lines, warnings}`.
- Engine: **RapidOCR** (`rapidocr-onnxruntime`, PaddleOCR models on ONNX Runtime, CPU, bundled models — no downloads at runtime), one lazily created engine behind a lock, run in a thread pool. Preprocessing: EXIF rotation, flatten transparency, cap at 2200 px, upscale small photos.
- Parser (`backend/app/services/menu_ocr.py#parse_menu`, pure function, unit-tested): tilt correction, row grouping, multi-column detection, prices in the same or separate boxes (`₹180`, `Rs. 180/-`, `180.00`, `160 / 280`), Half/Full style section headers, category headings, noise removal (phones, GSTIN/FSSAI, addresses, timings), quantity words kept in names (`250ml`, `2 pcs`), OCR digit fixes (`l20` → 120), ALL-CAPS title-casing and joined-word splitting.
- Import: `POST /api/v1/catalog/bulk-import` creates missing categories, products and variants; skips duplicates by name.
- Tests: `backend/tests/unit/test_menu_ocr_parser.py` (synthetic OCR boxes), `backend/tests/integration/test_ai_menu.py` (renders a menu image, runs real OCR, JPEG + HEIC, error cases).
- Known limits: Latin script only; joined ALL-CAPS words; prices on the line below the name; strong perspective/curved pages.
