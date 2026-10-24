# Receipt & Kitchen Printing

## What works where

| Device | Bluetooth Classic (most cheap 58/80 mm printers: PT-210, MTP-II, Rugtek…) | Bluetooth LE printers | USB / network printers |
|---|---|---|---|
| **Android app** (APK / Play) | ✅ pair in Android Bluetooth settings, then pick it in Tallyko | ✅ | via Android print dialog |
| **iPhone / iPad app** | ❌ iOS blocks non-MFi Classic devices | ✅ | ✅ AirPrint |
| **Chrome / Edge** (Windows, macOS, Android) | ❌ | ✅ Web Bluetooth (HTTPS) | ✅ print dialog — install the printer's driver, choose 58/80 mm paper |
| **Safari (iPhone)** | ❌ | ❌ | ✅ AirPrint via print dialog |
| **Expo Go** (dev only) | ❌ native modules not included | ❌ | print dialog |

Recommendation for a shop: an Android tablet/phone with the Tallyko APK + any Bluetooth thermal printer is the cheapest reliable setup. On a laptop, a USB thermal printer with its driver + the browser print dialog works with every printer.

## Using it

Settings → Printers & receipts: *Find printers*, choose the bill printer (and optionally a separate kitchen printer), paper width 58/80 mm, auto-print bill after payment, auto-print KOT, barcode on bill, UPI QR on bill, open cash drawer, test print.

## How it's built

- `frontend/src/lib/print/escpos.ts` — ESC/POS command builder (text, alignment, bold/size, Code128 barcode `GS k`, native QR `GS ( k`, cut, drawer kick). `₹` and Hindi are transliterated for printers without those glyphs.
- `frontend/src/lib/print/receipt.ts` — GST receipt and KOT layouts (32/48 columns), plain text, ESC/POS bytes and HTML (for the print dialog, with SVG barcode + UPI QR).
- `frontend/src/lib/print/printers.ts` — one API for every transport: Bluetooth Classic (`react-native-bluetooth-classic`, Android), BLE (`react-native-ble-plx`, chunked writes ≤180 bytes, reconnect-and-resume), Web Bluetooth, and HTML printing (`expo-print` natively, hidden iframe on web — SDK 57's `printAsync` on web ignores the `html` option). Native modules load lazily, so Expo Go and browsers report "unavailable" instead of crashing. A single job queue prevents interleaved prints.
- Permissions: Android `BLUETOOTH_SCAN` (`neverForLocation`) + `BLUETOOTH_CONNECT` requested at runtime; iOS `NSBluetoothAlwaysUsageDescription`.
- Tests: `frontend/src/lib/print/__tests__/*` and `frontend/src/lib/barcode/__tests__/*` (byte sequences, column layout, barcodes) — `cd frontend && npx jest`.
