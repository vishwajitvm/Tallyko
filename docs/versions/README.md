# Versions: what each release contains

This folder tracks **features by version**. Each release has one file that says which features it contains, what each one does for a shop, how far it got (shipped, partial, planned) and where its spec lives. [`next.md`](./next.md) holds what is being planned and the known gaps.

| File | Status | Date | Theme |
|---|---|---|---|
| [v0.1.0](./v0.1.0.md) | Released (superseded) | 2026-07-12 | Project skeleton |
| [v1.0.0](./v1.0.0.md) | Released (superseded) | 2026-07-12 | First working POS (prototype) |
| [v2.0.0](./v2.0.0.md) | **Current** | 2026-10-24 | Production-grade multi-tenant POS |
| [next](./next.md) | Planning | — | Roadmap and known gaps |

How the other places relate:
- **`docs/features/NNN_*.md`**: the spec for one feature, explaining how it works for the business and for developers. It stays current as the feature changes.
- **`docs/versions/vX.Y.Z.md`** (here): which features, and which parts of them, a release contains.
- **`changelog/vX.Y.Z.md`** and **`CHANGELOG.md`**: release notes, i.e. what changed compared with the previous release.
- **`VERSION`** and **`frontend/app.json` → `expo.version`**: the number that ships.

## Feature matrix

✅ shipped · 🟡 partial · 🧪 prototype or simulated · — not present

| # | Feature | Spec | v0.1.0 | v1.0.0 | v2.0.0 |
|---|---|---|:-:|:-:|:-:|
| 1 | Sign-up, login, business (tenant) setup | [001](../features/001_Auth_And_Tenant_Setup.md) | — | 🧪 | ✅ |
| 2 | Menu: categories, variants, barcodes, bulk edits | [002](../features/002_Product_Catalog.md) | — | 🟡 | ✅ |
| 3 | POS billing with server-side GST engine | [003](../features/003_Core_POS_Billing.md) | — | 🟡 | ✅ |
| 4 | Tables | [004](../features/004_Table_Management.md) | — | 🟡 | ✅ |
| 5 | Kitchen display | [005](../features/005_Kitchen_Display_System.md) | — | 🟡 | ✅ |
| 6 | Barcode scanning and printing | [006](../features/006_Barcode_Scanner.md) | — | 🟡 | ✅ |
| 7 | Inventory | [007](../features/007_Inventory_Management.md) | — | 🟡 | ✅ |
| 8 | Customers and loyalty points | [008](../features/008_CRM_And_Loyalty.md) | — | 🟡 | ✅ |
| 9 | Reports | [009](../features/009_Analytics_Dashboard.md) | — | 🟡 | ✅ |
| 10 | Menu from a photo (OCR) | [010](../features/010_AI_Menu_Generator.md) | — | 🧪 | ✅ |
| 11 | Online store and QR menu | [011](../features/011_Online_Store.md) | — | 🧪 | ✅ |
| 12 | Swiggy / Zomato / ONDC, cloud kitchens, per-channel prices | [012](../features/012_Aggregators_And_Cloud_Kitchens.md) | — | — | 🟡 |
| 13 | Staff, roles and access control | [013](../features/013_Staff_Roles_And_Access.md) | — | — | ✅ |
| 14 | Offers, loyalty rewards and email | [014](../features/014_Offers_Loyalty_Rewards_And_Email.md) | — | — | ✅ |
| 15 | GST and tax management | [015](../features/015_GST_And_Tax_Management.md) | — | — | ✅ |
| 16 | Tallyko super admin console | [016](../features/016_Super_Admin_Console.md) | — | — | ✅ |
| 17 | Running bills and the restaurant floor | [017](../features/017_Running_Bills_And_Floor.md) | — | — | ✅ |
| 18 | Subscriptions, demo and signed-in devices | [018](../features/018_Subscriptions_Demo_And_Sessions.md) | — | — | ✅ |
| 19 | Owner's watch, no deletes and menu history | [019](../features/019_Owner_Watch_No_Deletes_And_Menu_History.md) | — | — | ✅ |
| — | Receipt and kitchen printing (ESC/POS) | [Printing](../features/Printing.md) | — | 🧪 | 🟡 |
| — | Offline billing (outbox + sync) | [07](../07_Offline_Sync_Strategy.md) | — | — | ✅ |
| — | High-volume UI on every screen | [20](../20_High_Volume_UX.md) | — | — | ✅ |

Some v2.0.0 rows are 🟡 because of entries in [next.md → known gaps](./next.md#known-gaps-in-v200): aggregator auto-ingest needs partner approval, and Bluetooth printing hasn't been tested on physical printers.

## How we manage it

1. **Planning a feature.** Add it to [`next.md`](./next.md) with a one-line "why" (the shop problem it solves). Give it a spec in `docs/features/` once it is more than a line.
2. **Starting a release.** Copy the latest version file to `vX.Y.Z.md` and set its status to *In progress*. Move the features you are taking from `next.md` into it as 🟡.
3. **While building.**
   - Update the feature's spec in the same change as the code, as [CLAUDE.md](../../CLAUDE.md) requires.
   - Mark the version row ✅ only when the backend, the app, the tests and the docs are all done.
4. **Releasing.**
   - Set the date and status *Released*.
   - Add the column to the feature matrix above.
   - Write `changelog/vX.Y.Z.md` and add a line to `CHANGELOG.md`.
   - Bump `VERSION` and `expo.version`.
5. **Versioning rules** ([SemVer](https://semver.org/)):
   - **Major:** a breaking change for shops or data (a schema rebuild, an API break).
   - **Minor:** new features, backward compatible.
   - **Patch:** fixes only.
   - Database changes inside a release are always forward-only and non-destructive ([docs/19](../19_Database_Migrations.md)).

Template for a new version file:

```markdown
# vX.Y.Z: <theme>

Status: In progress | Released (YYYY-MM-DD) · Previous: vA.B.C · Release notes: changelog/vX.Y.Z.md

## Features
| Feature | Status | What a shop gets | Spec |
|---|---|---|---|

## Data & migrations
## Upgrade notes
## Known gaps
```
