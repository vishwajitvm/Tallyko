# Kitchen Display System (KDS) & KOTs

## 1. Overview
The kitchen display replaces paper tickets. It is the same Tallyko app signed in with a **kitchen** role, on a wall TV, a tablet or a phone. Every time items are sent to the kitchen, a **KOT** (kitchen order ticket) appears; cooks move each item through Preparing → Ready → Served. A KOT can also be printed on a kitchen printer.

## 2. Key capabilities
* **Tickets appear within seconds:** the display polls the server every 5 s. There are no WebSockets and no LAN-only device-to-device protocol.
* **Per-item status:** every line has its own status, so "2 ready, 2 cooking" is visible. The ticket shows the slowest live line.
* **Timers and colours:** tickets turn amber/red after the thresholds set in Settings (`kitchen_amber_min`, `kitchen_red_min`).
* **Cancelled items struck out:** items cancelled after the kitchen had them show as **CANCELLED**, so nobody cooks them.
* **Brands:** in cloud kitchens each ticket shows its brand.
* **No kitchen screen?** Staff with `kitchen.update` mark items ready/served from the bill ([017](./017_Running_Bills_And_Floor.md)).
* **Offline:** the kitchen display needs the server. A shop that must keep the kitchen running during internet outages runs the server on a shop PC ([17](../17_Free_Cloud_Deployment.md)); printed KOTs from the POS also work.

## 3. How to use
1. Sign in on the kitchen device with a kitchen account and open **Kitchen**.
2. Each ticket shows table or token, channel/brand, time elapsed and its items with notes.
3. Tap an item (or the whole ticket) to move it to **Preparing**, then **Ready**. Waiters see the progress on the table and the bill; customers who ordered by QR see it on their phone.
4. **Served** removes the item from the active queue.

## 4. Under the hood

```mermaid
flowchart LR
    subgraph FOH["Front of house (POS / waiter / QR / online)"]
        send["Send to kitchen<br/>POST /orders or /orders/{id}/items<br/>accept online order"]
    end
    subgraph API["FastAPI"]
        kot["New KOT + lines<br/>kitchen_status pending"]
        sync["sync_kot_status:<br/>ticket = least advanced live line,<br/>cancelled if all void"]
    end
    db[("kots, order_items")]
    subgraph BOH["Kitchen display (polls every 5 s)"]
        list["GET /kitchen/tickets"]
        upd["PUT /kitchen/tickets/{id}/status<br/>or POST /orders/{id}/items/status"]
    end
    printer[("Kitchen printer<br/>(optional, ESC/POS)")]
    send --> kot --> db
    send -. "auto-print KOT" .-> printer
    db --> list
    upd --> sync --> db
```

Item and ticket states:

<!-- diagram: 07_kitchen_item_status drawio=Tallyko_Order_Flow -->
```mermaid
stateDiagram-v2
    state "not sent (kot_id null)" as unsent
    state "removed" as removed
    state "pending" as pending
    state "preparing" as preparing
    state "ready" as ready
    state "served" as served
    state "void" as void

    [*] --> unsent : item added, not sent yet
    [*] --> pending : item added and sent (new KOT)
    unsent --> pending : send to kitchen / accept online order
    unsent --> removed : cancel before the kitchen has it<br/>(no reason or approval needed)

    pending --> preparing : kitchen display or<br/>staff with kitchen.update
    preparing --> ready
    ready --> served

    pending --> void : cancel after sending<br/>(orders.void_item + reason,<br/>optional wastage in stock)
    preparing --> void
    ready --> void

    note right of removed
        Hidden from staff, kept for the
        owner's watch. Never charged,
        never counted as sold.
    end note

    note right of void
        Shown struck out as CANCELLED to the
        kitchen and staff. Subtotal and tax 0.
        Comp ("on the house") is separate:
        price 0, comp_reason and comp_value kept.
    end note

    state "KOT status follows its lines" as kotrule {
        direction LR
        state "all lines void" as allvoid
        state "KOT cancelled" as kotc
        state "otherwise" as other
        state "KOT = least advanced live line<br/>pending < preparing < ready < served" as kotmin
        allvoid --> kotc
        other --> kotmin
    }
```

*Diagram source: [`07_kitchen_item_status.mmd`](../diagrams/mermaid/07_kitchen_item_status.mmd) · [SVG](../diagrams/rendered/07_kitchen_item_status.svg) · draw.io: [`Tallyko_Order_Flow.drawio`](../diagrams/Tallyko_Order_Flow.drawio)*
<!-- /diagram -->

**API:** `GET /kitchen/tickets?status=active|ready|recent|all` (per-line status, bill label), `PUT /kitchen/tickets/{id}/status` (whole ticket), `POST /orders/{id}/items/status` (single items). `GET /kitchen/kds/orders` and `PUT /kitchen/kds/orders/{kot_id}/status` remain for older app versions.

**Tests:** `backend/tests/integration/test_kitchen.py`, `test_floor.py`.
