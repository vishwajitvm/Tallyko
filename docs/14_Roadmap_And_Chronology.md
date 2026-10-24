# Roadmap & Chronology

The feature specs in [`features/`](./features/) are numbered in the order they were built. As of **v2.0.0 (October 2026)** all of them exist in the code; this page records the build order and what is still open.

## 1. Built (v2.0.0)

| Phase | Specs |
|---|---|
| Foundation | [001 Auth & tenant setup](./features/001_Auth_And_Tenant_Setup.md), [002 Product catalog](./features/002_Product_Catalog.md), [003 Core POS billing](./features/003_Core_POS_Billing.md), [Printing](./features/Printing.md) |
| Restaurant | [004 Tables](./features/004_Table_Management.md), [005 Kitchen display](./features/005_Kitchen_Display_System.md), [017 Running bills on the floor](./features/017_Running_Bills_And_Floor.md) |
| Retail and stock | [006 Barcodes](./features/006_Barcode_Scanner.md), [007 Inventory](./features/007_Inventory_Management.md) |
| Customers and growth | [008 CRM & loyalty](./features/008_CRM_And_Loyalty.md), [011 Online store & QR ordering](./features/011_Online_Store.md), [012 Aggregators & cloud kitchens](./features/012_Aggregators_And_Cloud_Kitchens.md), [014 Offers, rewards & email](./features/014_Offers_Loyalty_Rewards_And_Email.md) |
| Insight and setup | [009 Reports](./features/009_Analytics_Dashboard.md), [010 Menu from a photo](./features/010_AI_Menu_Generator.md), [015 GST & taxes](./features/015_GST_And_Tax_Management.md) |
| Control and platform | [013 Staff, roles & access](./features/013_Staff_Roles_And_Access.md), [016 Super admin console](./features/016_Super_Admin_Console.md), [018 Subscriptions & sessions](./features/018_Subscriptions_Demo_And_Sessions.md), [019 Owner's watch, no deletes, menu history](./features/019_Owner_Watch_No_Deletes_And_Menu_History.md) |

## 2. Open (from the known gaps in `CLAUDE.md`)

1. Aggregator auto-ingest needs Swiggy/Zomato partner approval; manual entry and the signed webhook are what exist.
2. OCR reads Latin script only; handwritten boards are poor.
3. Native Bluetooth printing is untested on physical printers in CI.
4. Single-device revocation is checked in Redis (fails open).
5. Dedicated-database tenants: no provisioning or per-tenant migration loop.
6. Paid plans inside the iOS app would need an In-App Purchase decision.
7. Subscription payments are claimed and approved by hand (no gateway, by design).
8. Offers are evaluated online only; public store ordering doesn't take coupon codes yet.
9. Production email needs an SMTP account in `.env` (`SMTP_*`); without one, emails are logged as `skipped`.

## 3. Ideas not started

Predictive low-stock alerts and pricing suggestions, a multi-branch combined view, table reservations, bulk SMS/WhatsApp campaigns, log dashboards, staging/canary deployments. Each must stay within the free-and-open-source rule.
