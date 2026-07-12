# Roadmap & Chronology

## 1. Build Order Strategy

Tallyko's development follows a strict chronological build order. Foundational infrastructure must be completely stable before higher-level features are layered on top. 

This roadmap acts as the index for the detailed feature specifications found in `/docs/features/`.

## 2. Phase 1: The Foundation (Core Multi-Tenant POS)
This phase establishes the multi-vendor architecture and the absolute minimum functionality required to ring up a sale.

*   `001_Auth_And_Tenant_Setup.md`: Global user registration, tenant provisioning, JWT auth, and database routing logic.
*   `002_Product_Catalog.md`: Categories, items, and pricing (the shared data model for both retail and restaurant).
*   `003_Core_POS_Billing.md`: The offline-first cart, tax calculations (GST), generating an order, and Bluetooth thermal receipt printing.

## 3. Phase 2: Restaurant Specifics & KDS
Expanding into the food service vertical, matching Shopto's core restaurant flow.

*   `004_Table_Management.md`: Creating floor plans, assigning tables, and managing open orders/split bills.
*   `005_KOT_And_KDS.md`: Auto-generating Kitchen Order Tickets, printing to kitchen printers, and the digital Kitchen Display System UI.

## 4. Phase 3: Retail Specifics & Inventory
Expanding into the retail vertical and adding stock management.

*   `006_Barcode_And_Variants.md`: Hardware barcode scanner integration, SKU management, and complex item variants (size/color).
*   `007_Inventory_Management.md`: Real-time stock tracking, supplier ledgers, purchase entries, and wastage tracking.

## 5. Phase 4: Customer Facing & Growth
Adding features that generate more revenue for the vendors.

*   `008_QR_Digital_Menu.md`: Customer self-scanning, viewing the menu, and placing orders from their phone to the POS/KDS.
*   `009_CRM_And_Loyalty.md`: Customer profiles, order history, and promotional campaigns.

## 6. Phase 5: Advanced & AI Differentiation
The final phase implements the features that make Tallyko vastly superior to competitors.

*   `010_Analytics_Dashboard.md`: Comprehensive reporting across single or multiple branches.
*   `011_AI_Menu_Upload.md`: Utilizing background workers to parse PDFs/images into structured product catalogs.
*   `012_Online_Ordering_Store.md`: Generating a unique, commission-free web storefront for each vendor.

---
*Note: The documents linked above reside in the `/docs/features/` directory and contain exhaustive, implementation-ready details for both business owners and developers.*
