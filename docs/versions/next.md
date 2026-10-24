# Next: roadmap and known gaps

Status: Planning · Builds on [v2.0.0](./v2.0.0.md)

This is the list we pick the next release from. When a release starts, its items move into a new `vX.Y.Z.md` file (see [README](./README.md#how-we-manage-it)). Every item says which shop problem it solves.

## Known gaps in v2.0.0

| # | Gap | Impact on a shop | Direction |
|---|---|---|---|
| 1 | Swiggy/Zomato auto-ingest | Orders are typed in or arrive by the signed webhook | Needs partner API approval. Manual entry and webhook stay as the fallback |
| 2 | OCR reads Latin script only | Hindi or Devanagari menus, and handwritten boards, need manual entry | Add a free Devanagari OCR model |
| 3 | Bluetooth printing untested on real printers | Possible printer-specific issues | Test on common 58/80 mm printers. `react-native-bluetooth-classic` is an RC |
| 4 | Signing out a single device is checked in Redis | If Redis is down, that one device stays signed in until its token expires | Whole-business sign-outs already always apply |
| 5 | Dedicated-database tenants | Routing exists, but there is no provisioning or per-tenant migration loop | Build provisioning and migrate per tenant |
| 6 | iOS paid plans | App Store rule 3.1 may require In-App Purchase | Decide: web-only payment or IAP |
| 7 | Subscription payments approved by hand | The super admin approves every claim | No paid gateway by design; consider free UPI reconciliation |
| 8 | Offers online only | Offline bills sync without an offer. QR and online ordering can't take coupon codes | Ship offers to devices, add a coupon field to the public store |
| 9 | Email needs SMTP in production | Without `SMTP_*` in `.env`, emails are logged as `skipped` | Free options are listed in [docs/17](../17_Free_Cloud_Deployment.md) |
| 10 | Plan limits only partly enforced | Only `max_staff` is checked; `max_products` and `max_locations` are stored but not checked | Enforce them on create, like staff |

## Candidates for the next release

| Feature | Why a shop wants it | Notes |
|---|---|---|
| Inventory page served by the server | Stores with tens of thousands of items | The API already pages and filters (`q`, `filter`, `X-Counts`); the app still loads all rows |
| "Inactive items" view | Find and bring back hidden menu items quickly | `GET /catalog/products?only_inactive=true` exists; no UI yet |
| "Waiting payment" table filter | Spot tables that need to pay | Definition to decide: UPI claim pending, partly paid, or all items served |
| Coupon codes in QR / online ordering | Promotions for walk-in and online customers | See gap 8 |
| Offline offers | Same discount online or offline | See gap 8 |
| Hindi menus from a photo | Many Indian menus are in Devanagari | See gap 2 |
| Multi-outlet dashboards | Chains with several locations | Locations exist in the data model |
| Free UPI payment reconciliation | Fewer manual approvals | Must stay free (no paid gateway) |

The long-term roadmap and history are in [docs/14_Roadmap_And_Chronology.md](../14_Roadmap_And_Chronology.md).
