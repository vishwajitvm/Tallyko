# Tallyko Documentation Suite

Welcome to the Tallyko technical and product documentation. This suite is the single source of truth for the entire Tallyko platform. It is designed to be read in the chronological order listed below. 

Engineers, Product Managers, and AI coding agents should read these documents comprehensively before making any architectural decisions or writing code.

## Part 1: Core Architecture & Strategy

These documents define the high-level vision, strict constraints, and the technical foundation of the platform.

1.  [00_Product_Overview.md](./00_Product_Overview.md) - Vision, differentiators (vs Shopto), and target market.
2.  [01_Tech_Stack_And_Justification.md](./01_Tech_Stack_And_Justification.md) - Chosen technologies and rationale.
3.  [02_System_Architecture.md](./02_System_Architecture.md) - High-level system components and edge routing.
4.  [03_Multi_Vendor_Architecture.md](./03_Multi_Vendor_Architecture.md) - True multi-tenant design, global vs. dedicated DBs.
5.  [04_Data_Model.md](./04_Data_Model.md) - Database schema strategy and immutable subscriptions.
6.  [05_API_Design.md](./05_API_Design.md) - RESTful contracts, response shapes, and versioning.
7.  [06_Mobile_App_Architecture.md](./06_Mobile_App_Architecture.md) - Cross-platform strategy and hardware integrations.
8.  [07_Offline_Sync_Strategy.md](./07_Offline_Sync_Strategy.md) - Bi-directional timestamp sync for offline-first reliability.
9.  [08_Docker_And_Deployment.md](./08_Docker_And_Deployment.md) - Containerization and compose structures.
10. [09_Logging_And_Observability.md](./09_Logging_And_Observability.md) - Structured logging mandate using tracenest.
11. [10_Security_And_Auth.md](./10_Security_And_Auth.md) - RLS, JWT, and Role-Based Access Control.
12. [11_CI_CD_Pipeline.md](./11_CI_CD_Pipeline.md) - Automated testing and staged rollouts.
13. [12_Environments_And_Config.md](./12_Environments_And_Config.md) - Environment separation and 12-factor configuration.
14. [13_Reliability_And_Rollback.md](./13_Reliability_And_Rollback.md) - Health checks, degradation, and recovery.
15. [14_Roadmap_And_Chronology.md](./14_Roadmap_And_Chronology.md) - The strict chronological build order.

## Part 2: Feature Specifications

These documents detail specific modules, containing plain-language explanations for the business owner and technical implementation details for the developer. They are numbered in build order.

*   [001_Auth_And_Tenant_Setup.md](./features/001_Auth_And_Tenant_Setup.md) - Foundational user and tenant provisioning.
*   [002_Product_Catalog.md](./features/002_Product_Catalog.md) - Core items, categories, and pricing.
*   [003_Core_POS_Billing.md](./features/003_Core_POS_Billing.md) - The offline-first cash register and receipts.
*   *(Pending generation)* `004_Table_Management.md` - Floor plans and open orders.
*   *(Pending generation)* `005_KOT_And_KDS.md` - Kitchen tickets and digital displays.
*   *(Pending generation)* `006_Barcode_And_Variants.md` - Retail SKU scanning and variants.
*   *(Pending generation)* `007_Inventory_Management.md` - Stock tracking and wastage.
*   *(Pending generation)* `008_QR_Digital_Menu.md` - Customer self-ordering.
*   *(Pending generation)* `009_CRM_And_Loyalty.md` - Customer profiles and campaigns.
*   *(Pending generation)* `010_Analytics_Dashboard.md` - Reporting across branches.
*   *(Pending generation)* `011_AI_Menu_Upload.md` - Automated PDF menu parsing.
*   *(Pending generation)* `012_Online_Ordering_Store.md` - Commission-free storefronts.

---
*Generated based on Tallyko Product Requirements.*
