# Tallyko diagrams

Two kinds of diagrams describe Tallyko v2.0.0. Both are drawn from the code, not from plans: anything that was planned but never built (Traefik, Celery workers, MinIO, a separate owner dashboard, SQLite on devices, a LAN-only kitchen protocol) is either left out or labelled "not built".

| Kind | Folder | Best for |
|---|---|---|
| **Mermaid** (`.mmd`, text) | [`mermaid/`](./mermaid/) — rendered copies in [`rendered/`](./rendered/) | Precise, reviewable diagrams that live next to the docs; GitHub renders them inline in the Markdown docs |
| **draw.io** (`.drawio`, XML) | this folder | Large overview pictures with free layout, for presentations and onboarding |

## Mermaid diagrams

Each `.mmd` file starts with a `%%` comment saying what it shows. The same content is embedded in the docs between `<!-- diagram: NAME -->` and `<!-- /diagram -->` markers.

| File | Type | What it shows | Used in |
|---|---|---|---|
| [01_system_context](./mermaid/01_system_context.mmd) ([svg](./rendered/01_system_context.svg)) | flowchart | People, the one Expo app (POS, kitchen display, console, public pages), printers, the server, SMTP, UPI apps, aggregator webhooks | [README](../README.md), [00](../00_Product_Overview.md), [01](../01_Tech_Stack_And_Justification.md), [02](../02_System_Architecture.md) |
| [02_containers](./mermaid/02_containers.mmd) ([svg](./rendered/02_containers.svg)) | flowchart | App, Caddy, FastAPI middleware → routers → services, in-process email worker and scheduler, Postgres, Redis, SMTP | [README](../README.md), [02](../02_System_Architecture.md) |
| [03_request_pipeline](./mermaid/03_request_pipeline.mmd) ([svg](./rendered/03_request_pipeline.svg)) | sequence | One request: token, session version / revoked sid (401), subscription lock (402), `require()` (403), service, RLS session | [README](../README.md), [10](../10_Security_And_Auth.md), [013](../features/013_Staff_Roles_And_Access.md), [018](../features/018_Subscriptions_Demo_And_Sessions.md) |
| [04_access_model](./mermaid/04_access_model.mmd) ([svg](./rendered/04_access_model.svg)) | flowchart | Plan modules + overrides − owner-hidden modules, role permissions, effective access, platform logins | [10](../10_Security_And_Auth.md), [013](../features/013_Staff_Roles_And_Access.md) |
| [05_pricing_pipeline](./mermaid/05_pricing_pipeline.mmd) ([svg](./rendered/05_pricing_pipeline.svg)) | flowchart | Channel price → GST class at that time → offer → discount → GST → round off → line snapshot; the GSTIN rule | [05](../05_API_Design.md), [003](../features/003_Core_POS_Billing.md), [014](../features/014_Offers_Loyalty_Rewards_And_Email.md), [015](../features/015_GST_And_Tax_Management.md) |
| [06_order_lifecycle](./mermaid/06_order_lifecycle.mmd) ([svg](./rendered/06_order_lifecycle.svg)) | state | Bill states: placed, open, completed, cancelled, merged, archived | [04](../04_Data_Model.md), [003](../features/003_Core_POS_Billing.md), [004](../features/004_Table_Management.md), [017](../features/017_Running_Bills_And_Floor.md) |
| [07_kitchen_item_status](./mermaid/07_kitchen_item_status.mmd) ([svg](./rendered/07_kitchen_item_status.svg)) | state | Line kitchen status pending → preparing → ready → served, void, removed; how the KOT follows | [04](../04_Data_Model.md), [005](../features/005_Kitchen_Display_System.md), [017](../features/017_Running_Bills_And_Floor.md) |
| [08_offline_sync](./mermaid/08_offline_sync.mmd) ([svg](./rendered/08_offline_sync.svg)) | sequence | Offline cache, outbox, `/sync/push` idempotency, retries, 402 pause | [06](../06_Mobile_App_Architecture.md), [07](../07_Offline_Sync_Strategy.md) |
| [09_qr_table_ordering](./mermaid/09_qr_table_ordering.mmd) ([svg](./rendered/09_qr_table_ordering.svg)) | sequence | Scan → menu → order on the customer's own bill → accept → kitchen → UPI deep link → claim → confirm | [011](../features/011_Online_Store.md) |
| [10_subscription_lifecycle](./mermaid/10_subscription_lifecycle.mmd) ([svg](./rendered/10_subscription_lifecycle.svg)) | state | Demo, paid, complimentary, development, grace, lapsed, renewal claim and approval | [04](../04_Data_Model.md), [016](../features/016_Super_Admin_Console.md), [018](../features/018_Subscriptions_Demo_And_Sessions.md) |
| [11_daily_subscription_check](./mermaid/11_daily_subscription_check.mmd) ([svg](./rendered/11_daily_subscription_check.svg)) | sequence | 01:00 IST scheduler, catch-up, Redis lock, signing lapsed businesses out | [016](../features/016_Super_Admin_Console.md), [018](../features/018_Subscriptions_Demo_And_Sessions.md) |
| [12_records_and_watch](./mermaid/12_records_and_watch.mmd) ([svg](./rendered/12_records_and_watch.svg)) | flowchart | Nothing deleted by a business, owner's watch, request to Tallyko, archive or hard delete with reversal and snapshot | [016](../features/016_Super_Admin_Console.md), [019](../features/019_Owner_Watch_No_Deletes_And_Menu_History.md) |
| [13_menu_versioning](./mermaid/13_menu_versioning.mmd) ([svg](./rendered/13_menu_versioning.svg)) | flowchart | Edit, bulk edit, import, hide and restore, each adding a product version | [002](../features/002_Product_Catalog.md), [019](../features/019_Owner_Watch_No_Deletes_And_Menu_History.md) |
| [14_email_pipeline](./mermaid/14_email_pipeline.mmd) ([svg](./rendered/14_email_pipeline.svg)) | flowchart | Triggers → templates → `email_logs` queue → in-process worker → SMTP / Mailpit | [014](../features/014_Offers_Loyalty_Rewards_And_Email.md) |
| [15_aggregator_orders](./mermaid/15_aggregator_orders.mmd) ([svg](./rendered/15_aggregator_orders.svg)) | flowchart | Manual entry or HMAC webhook, de-duplication, per-channel prices, placed/open | [012](../features/012_Aggregators_And_Cloud_Kitchens.md) |
| [16_erd_platform](./mermaid/16_erd_platform.mmd) ([svg](./rendered/16_erd_platform.svg)) | ER | Platform tables (businesses, logins, sessions, plans, subscriptions, console, GST library) | [04](../04_Data_Model.md), [001](../features/001_Auth_And_Tenant_Setup.md), [016](../features/016_Super_Admin_Console.md) |
| [17_erd_business](./mermaid/17_erd_business.mmd) ([svg](./rendered/17_erd_business.svg)) | ER | Business tables (menu, tax, floor, orders, stock, customers, offers, email) and relations | [04](../04_Data_Model.md), [001](../features/001_Auth_And_Tenant_Setup.md), [003](../features/003_Core_POS_Billing.md) |
| [18_deployment](./mermaid/18_deployment.mmd) ([svg](./rendered/18_deployment.svg)) | flowchart | Development compose with ports and profiles; production compose | [08](../08_Docker_And_Deployment.md), [15](../15_Developer_Onboarding.md), [17](../17_Free_Cloud_Deployment.md) |
| [19_migrations_cli](./mermaid/19_migrations_cli.mmd) ([svg](./rendered/19_migrations_cli.svg)) | flowchart | `manage.py` commands and when to use them | [19](../19_Database_Migrations.md) |
| [20_tenant_isolation](./mermaid/20_tenant_isolation.mmd) ([svg](./rendered/20_tenant_isolation.svg)) | flowchart | JWT → `get_tenant_db` → `SET LOCAL ROLE` + tenant id → RLS; system sessions for platform work | [03](../03_Multi_Vendor_Architecture.md) |

Small diagrams that only make sense in one place (CI jobs in [11](../11_CI_CD_Pipeline.md), logging in [09](../09_Logging_And_Observability.md), reliability in [13](../13_Reliability_And_Rollback.md), some feature sequences) are written inline in that doc.

## draw.io diagrams

| File | What it shows | Referenced from |
|---|---|---|
| [`Tallyko_System_Architecture.drawio`](./Tallyko_System_Architecture.drawio) | System overview: clients, edge, API, data, outside services | [01](../01_Tech_Stack_And_Justification.md), [02](../02_System_Architecture.md) |
| [`Tallyko_Master_Architecture.drawio`](./Tallyko_Master_Architecture.drawio) | Detailed architecture: routers, services, background tasks, stores | [02](../02_System_Architecture.md) |
| [`Tallyko_Docker_Deployment.drawio`](./Tallyko_Docker_Deployment.drawio) | Development and production compose services, ports, volumes | [08](../08_Docker_And_Deployment.md), [17](../17_Free_Cloud_Deployment.md) |
| [`Tallyko_Database_ERD.drawio`](./Tallyko_Database_ERD.drawio) | **Every table and column** (38 tables, all foreign keys), generated from the models: an "All tables" page plus one page per area; [PNG preview](./rendered/Tallyko_Database_ERD.png). Regenerate with `docker compose exec -T backend python -m app.db.erd_drawio > docs/diagrams/Tallyko_Database_ERD.drawio` | [04](../04_Data_Model.md) |
| [`Tallyko_Order_Flow.drawio`](./Tallyko_Order_Flow.drawio) | Billing, pricing, kitchen and bill lifecycle | [003](../features/003_Core_POS_Billing.md), [004](../features/004_Table_Management.md), [005](../features/005_Kitchen_Display_System.md), [015](../features/015_GST_And_Tax_Management.md), [017](../features/017_Running_Bills_And_Floor.md) |
| [`Tallyko_Access_And_Sessions.drawio`](./Tallyko_Access_And_Sessions.drawio) | Tokens, sessions, subscription lock, roles × modules, RLS | [03](../03_Multi_Vendor_Architecture.md), [10](../10_Security_And_Auth.md), [013](../features/013_Staff_Roles_And_Access.md), [018](../features/018_Subscriptions_Demo_And_Sessions.md) |
| [`Tallyko_Subscriptions_Lifecycle.drawio`](./Tallyko_Subscriptions_Lifecycle.drawio) | Demo, paid, complimentary, development, grace, lock, renewal, daily check | [016](../features/016_Super_Admin_Console.md), [018](../features/018_Subscriptions_Demo_And_Sessions.md) |
| [`Tallyko_QR_Table_Ordering.drawio`](./Tallyko_QR_Table_Ordering.drawio) | Customer QR ordering and UPI claim flow | [011](../features/011_Online_Store.md) |
| [`Tallyko_Records_And_Audit.drawio`](./Tallyko_Records_And_Audit.drawio) | No deletes, owner's watch, Tallyko archive/delete, menu history | [016](../features/016_Super_Admin_Console.md), [019](../features/019_Owner_Watch_No_Deletes_And_Menu_History.md) |

## Viewing and editing

### draw.io
- **Online:** open [app.diagrams.net](https://app.diagrams.net) → *Open existing diagram* → pick the `.drawio` file (or *File → Open from → GitHub*). Free, no account needed for local files.
- **VS Code:** install the **Draw.io Integration** extension (`hediet.vscode-drawio`) and open the file; it edits in place and saves the same XML.
- **Desktop:** the free draw.io desktop app opens the files directly.
- Keep one diagram per file and labels short; export a PNG/SVG next to it only if someone needs a picture without draw.io.

### Mermaid
- **On GitHub:** the Markdown docs render the embedded blocks automatically; `.mmd` files show as text.
- **VS Code:** a Mermaid preview extension (e.g. *Markdown Preview Mermaid Support*) renders the blocks in the Markdown preview; [mermaid.live](https://mermaid.live) renders a pasted `.mmd`.
- **Render to SVG with Docker** (official Mermaid CLI; nothing to install locally):

  ```bash
  # from the repo root (Git Bash on Windows: prefix with MSYS_NO_PATHCONV=1)
  docker run --rm -v "$PWD/docs/diagrams:/data" ghcr.io/mermaid-js/mermaid-cli/mermaid-cli \
    -i /data/mermaid/05_pricing_pipeline.mmd -o /data/rendered/05_pricing_pipeline.svg
  ```

  PowerShell: `docker run --rm -v "${PWD}\docs\diagrams:/data" ghcr.io/mermaid-js/mermaid-cli/mermaid-cli -i /data/mermaid/05_pricing_pipeline.mmd -o /data/rendered/05_pricing_pipeline.svg`

  A syntax error makes the command fail with the line number; fix it before committing.

### Changing a Mermaid diagram
1. Edit `mermaid/NN_name.mmd` (keep the `%%` header comment true).
2. Re-render its SVG with the command above.
3. Copy the new content into every doc block marked `<!-- diagram: NN_name -->` (the "Used in" column lists them), keeping the markers. The block is the `.mmd` file without its `%%` header lines.
4. When the code changes behaviour, change the diagram in the same commit as the spec ([CLAUDE.md](../../CLAUDE.md) process rule).
