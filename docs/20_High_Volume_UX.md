# 20 · High-Volume UI Standard

Tallyko runs counters that serve **thousands of customers a day**: a dhaba at lunch rush, a cloud kitchen with Swiggy, Zomato and QR orders arriving together, a supermarket queue. Every screen is judged by one question: **how fast can a busy person finish the job without thinking?** This document is the contract for every screen, on phone, tablet and desktop.

## 1. Speed rules

1. **Frequent actions are one tap, where the eye already is.**
   - Billing, KOT, pay, ready and served are buttons on the row or the panel, not inside a menu.
   - Selecting rows reveals their actions **in place**: a sticky bar directly above the selected rows' footer, never a separate strip far from the list.
2. **No centred modal for a frequent action.**
   - Secondary actions open an **anchored menu** next to the button that opened it: a popover on tablet and desktop, a bottom sheet within thumb reach on phones.
   - Full-screen or centred dialogs are for rare, consequential steps only: payment, cancel with a reason, permanent changes.
3. **Defaults do the work.** The most common choice is pre-selected, for example cash with the exact amount, or the last used printer. Forms remember the last values that make sense.
4. **Undo instead of confirm** for reversible actions, such as marking an item served or switching an offer off: act immediately and show "Undo" in the toast for 5 seconds. Keep confirmation for money and permanence: cancelling a bill, voiding sent items, deleting.
5. **Keyboard first on desktop.**
   - `/` or `F2`: search.
   - `Enter`: add the highlighted item.
   - `+`/`-`: change quantity.
   - `F8` or `Ctrl+Enter`: pay.
   - `F9`: send the KOT.
   - `Esc`: close.
   - Arrow keys move through grids and lists.
   - Barcode scanners type and submit, and the POS must accept that from anywhere on the page.
   - Shortcuts are shown as hints on the buttons on desktop.
6. **Never block on the network** for selling. Show the result immediately (optimistic UI, offline outbox) and reconcile in the background.

## 2. Volume rules

1. **Lists are virtualised** (FlatList or SectionList with fixed row heights, `getItemLayout`, `windowSize` tuned). This applies to menus with 500+ items, orders, customers, stock and activity logs. A screen must stay smooth with **10,000 rows**.
2. **Large datasets are paged and searched on the server.** Never load "everything": use date ranges, filters and debounced search (300 ms). Counts come from the server.
3. **Search is everywhere a list is longer than one screen.** It should match name, code, phone, invoice number and barcode.
4. **Filters are chips at the top**, in a single scrollable row, showing counts, for example "Running 12 · Ready 4 · Paid 230".
5. **Live screens update themselves:**
   - Kitchen, Online orders and Tables poll or refresh about every 5–10 seconds.
   - New items are highlighted.
   - A new online order plays a sound once.
   - Nothing jumps under the user's finger: new rows are inserted without moving the row being touched.
6. **Density:** desktop tables use compact rows (44 px). Touch devices use 52–56 px rows. Users can switch between comfortable and compact; the choice is remembered per device.

## 3. Layout by device

| | Phone (< 600 dp) | Tablet (600–1100) | Desktop (> 1100) |
|---|---|---|---|
| Navigation | Bottom bar (4) + More | Icon rail | Full sidebar (collapsible) |
| POS | Full-width item grid; cart as a bottom bar that expands to a sheet | Item grid + cart side panel (min 360 px) | Item grid + cart panel (400–440 px); keyboard |
| Lists | Cards, one per row | Two-column cards or compact table | Data table with sortable columns |
| Detail | Full screen | Side panel or split view | Split view (list stays visible) |
| Secondary actions | Bottom sheet | Anchored popover | Anchored popover + shortcuts |

Further rules:
- Panels never squeeze content into slivers. The cart's item list keeps a minimum height of 3 rows, and when space runs out the **panel scrolls as one**, not the inner list.
- Footer actions stay visible: total, KOT, pay.

## 4. Visual rules

- **Primary action:** solid brand colour (Pay = success green).
- **Kitchen / KOT:** solid warning or amber colour, so it can't be confused with Pay.
- **Destructive:** red outline, solid red only inside the confirmation.
- **Disabled** buttons must look disabled (reduced contrast plus a reason on hover or long-press); **enabled** buttons must never look disabled.
- **Status colours are consistent everywhere:**

  | Status | Colour |
  |---|---|
  | Pending / new | Amber |
  | Preparing | Blue |
  | Ready | Green |
  | Served / paid | Grey or neutral |
  | Cancelled / void | Red, struck through |
  | Waiting for confirmation (UPI claim, online order) | Purple / accent |

- **Numbers that matter are big and tabular**: totals, due amounts and counts. Prices align right.
- **Touch targets** are at least 44 px; 48 px for the primary POS buttons.
- **No layout shift**: skeleton rows while loading, fixed heights for rows and buttons.

## 5. Shared building blocks

These live in `frontend/src/components/ui`. Use them instead of building one-off versions.

- `ActionMenu`: an anchored popover on desktop and tablet, a bottom sheet on phones. Items have an icon, label, optional description, shortcut hint and danger flag.
- `SelectionBar`: a sticky bar that appears when rows are selected. It shows the count, "Clear", the top 2–4 actions as buttons, and the rest in an `ActionMenu`.
- `DataList`: a virtualised list or table. It handles responsive cards and table switching, the sticky header, loading skeletons, empty and error states, pull-to-refresh and "load more" paging.
- `FilterBar`: search plus scrollable filter chips with counts, and an optional date range.
- `useHotkeys`: keyboard shortcuts on web, ignored while typing in inputs except for the global ones.
- `StatusPill`: the status colours from §4, used for kitchen, orders, payments and subscriptions.
- `Button` variants: `primary`, `success`, `kitchen` (amber, solid), `tonal`, `outline`, `ghost` and `danger`, each with a `shortcut` hint.

## 6. Checklist before a screen is "done"

- [ ] Works at **390×844** (phone), **820×1180** and **1180×820** (tablet), and **1366×768** and **1920×1080** (desktop).
- [ ] The main task takes the fewest possible taps, with no centred modal for frequent actions.
- [ ] Smooth with 10,000 rows (virtualised, server-paged, searchable).
- [ ] Loading, empty, error and offline states.
- [ ] Keyboard works on desktop; touch targets are large enough on phone and tablet.
- [ ] Light and dark themes, readable contrast.

## 7. How to use the building blocks

Everything is exported from `@/components/ui` (`useHotkeys` also lives in `@/hooks/useHotkeys`). Colours come from theme tokens only: `kitchen`/`onKitchen` (amber KOT), `waiting*` (purple, waiting for confirmation), `neutralSoft`, `disabled*`, `selectedRow`, `skeleton` and `bubble`, in both light and dark.

**Buttons.** Pick the variant by meaning, not by looks. `shortcut` only shows the hint on desktop web; bind the key with `useHotkeys`. A disabled button turns grey; with `disabledReason`, hovering shows the reason (web) and tapping or long-pressing shows it in a toast.

```tsx
<Button title="Pay" variant="success" size="lg" shortcut="F8" onPress={pay} disabled={!lines.length} disabledReason="Add an item first" />
<Button title="Send" variant="kitchen" icon="flame-outline" badge={unsent} shortcut="F9" onPress={sendKot} />
<Button title="Cancel bill…" variant="dangerOutline" onPress={askCancel} />   {/* solid `danger` only inside the confirm */}
```

Variants: `primary`, `success` (Pay), `kitchen` (KOT, amber with dark text), `tonal` (= `soft`), `outline` (= `secondary`), `ghost`, `dangerOutline` (destructive trigger), `danger` (solid, confirmation step only) and `accent`.

**Keyboard shortcuts** (web only; no-op on native):

```tsx
useHotkeys({
  F8: pay, 'Ctrl+Enter': pay, F9: sendKot,
  'F2|/': () => searchRef.current?.focus(),
  '+': () => bump(1), '-': () => bump(-1),
  Escape: closePanel,
}, [pay, sendKot], { enabled: isFocused });
```

- While the user is typing in an input, only F-keys, `Escape` and `Ctrl`/`Alt`/`Meta` combos fire. Pass `{ handler, global: true }` to let another key fire too.
- `Ctrl` also matches `Cmd` on a Mac.
- A handler that returns `false` lets the browser handle the key.
- `Enter` and `Space` on a focused button are left to the button.
- `<ShortcutHint keys="F8" />` renders a key cap on desktop web only.

**StatusPill**: one call for every status family, with the colour, icon and label from §4. Unknown values render as a neutral pill.

```tsx
<StatusPill status={ticket.status} />                 {/* pending | preparing | ready | served | void */}
<StatusPill status={order.status} size="md" />        {/* placed | open | completed | cancelled | merged */}
<StatusPill status="claim" />                         {/* unpaid | partial | paid | claim */}
<StatusPill status={sub.status} label="Trial · 5 days left" />
```

**ActionMenu**: secondary actions next to the button that opened them. It is a popover on tablet, desktop and web (it flips up or left to stay on screen; arrows, Enter and Esc work, and clicking outside closes it) and a bottom sheet on phones.

```tsx
<ActionMenu
  items={[
    { key: 'move', label: 'Move table', icon: 'swap-horizontal', shortcut: 'M', onPress: move },
    { key: 'disc', label: 'Discount', icon: 'pricetag-outline', disabled: !canDiscount, disabledReason: 'Manager only', onPress: discount },
    { key: 'cancel', label: 'Cancel bill…', icon: 'close-circle-outline', danger: true, group: 'danger', onPress: askCancel },
  ]}
  trigger={(open) => <Button title="More" icon="ellipsis-horizontal" variant="outline" onPress={open} />}
/>
```

Leave out `trigger` to get a "⋯" icon button, which is the usual case inside a row. Other options: `align="end"`, `placement="top"`, `mode="sheet" | "popover"` and `title` (the sheet heading).

**FilterBar**: debounced search (300 ms; `/` focuses it on desktop) plus a scrollable row of filter chips with counts. Counts come from the server.

```tsx
<FilterBar
  onSearch={setQuery} searchPlaceholder="Name, phone, invoice no."
  filters={[{ key: 'running', label: 'Running', count: c.running }, { key: 'ready', label: 'Ready', count: c.ready }, { key: 'paid', label: 'Paid', count: c.paid }]}
  value={status} onChange={setStatus}
  right={<Button title="Today" icon="calendar-outline" variant="outline" onPress={pickRange} />}
/>
```

**DataList + SelectionBar**: a virtualised list that shows cards on narrow containers and a table with a sticky header on wide ones. Rows have a fixed height, so 10,000 rows stay smooth.

- Memoise `columns`, `rowActions` and `renderCard`.
- Page on the server with `onEndReached`/`hasMore`.
- Put the `SelectionBar` in the `selectionBar` slot so it sits directly under the rows.

```tsx
const columns = useMemo<DataColumn<Order>[]>(() => [
  { key: 'invoice', title: 'Bill', flex: 1, sortable: true },
  { key: 'customer', title: 'Customer', flex: 2, hideBelow: 800 },
  { key: 'status', title: 'Status', width: 130, render: (o) => <StatusPill status={o.status} /> },
  { key: 'total', title: 'Total', width: 110, numeric: true, value: (o) => formatMoney(o.total) },
], []);

<DataList
  data={orders} keyExtractor={(o) => o.id} columns={columns}
  loading={loading} error={error} onRetry={reload} empty={{ title: 'No bills yet', icon: 'receipt-outline' }}
  refreshing={refreshing} onRefresh={refresh}
  onEndReached={loadMore} loadingMore={loadingMore} hasMore={hasMore}
  onPressRow={openOrder} keyboard
  rowActions={(o) => <ActionMenu items={menuFor(o)} align="end" />} rowActionsWidth={56}
  selectable selectedKeys={selected} onSelectionChange={setSelected}
  selectionBar={
    <SelectionBar
      count={selected.length} onClear={() => setSelected([])} total={totalCount} onSelectAll={selectAllOnServer}
      actions={[
        { key: 'print', label: 'Print', icon: 'print-outline', onPress: printSelected },
        { key: 'export', label: 'Export', icon: 'download-outline', onPress: exportSelected },
        { key: 'void', label: 'Void', icon: 'trash-outline', danger: true, onPress: askVoid },
      ]}
    />
  }
/>
```

DataList options:

- `layout`: `auto`, `table` or `cards`.
- `tableMinWidth`: below this container width, `auto` shows cards. Default 600.
- `density`: `comfortable` (56 px) or `compact` (44 px). Desktop web defaults to compact.
- `renderCard`: a custom card. It is drawn inside a fixed `cardHeight`.
- `highlightKeys`: rows tinted amber as new.
- `ListHeaderComponent`: content that scrolls with the rows.

SelectionBar options:

- It shows 1–4 buttons depending on its width (`maxVisible` caps that) and puts the rest under "More".
- Below 560 px it switches to a compact single row.
- `sticky` pins it to the bottom of a scrolling parent on web.

Smaller pieces: `Checkbox` (supports `indeterminate`), `Skeleton` (a pulsing placeholder block), `useDebounced(value, ms)` and `computePopoverPosition` (the pure geometry behind `ActionMenu`).

### 7.x Additions after the first redesign pass

- **Undo instead of confirm (§1.4):** `toast.undo('Offer paused', () => resume())` shows the message with an **Undo** button for 5 s. `toast.show(message, tone, ms, { label, onPress })` takes any action.
- **`ActionMenu` `menuRef`:** `const ref = useRef<ActionMenuHandle>(null)` → `<ActionMenu menuRef={ref} …/>` → `ref.current?.open()` from a long-press, right-click or shortcut, so the menu doesn't need a visible "⋯" button.
- **`SelectionBar` `minVisible`:** keeps at least N actions as one-tap buttons in narrow panels. The POS cart uses 3.
- **`DataList` `openKey`:** tints the row whose detail is open beside the list, without touching the checkbox selection. `ListHeaderComponent` stays visible above empty and error states.
- **`FilterBar`** lays itself out by the width it actually has, so lists beside a side panel get the compact layout.
- **`Chip` `count`** accepts text ("3/12").
- **`StatusPill`** shrinks with an ellipsis in narrow rows.
- **`ShortcutHint`** formats key sequences such as `g b` as "G B".
- **`DataList` `onRowMenu`:** right-click on a row (web), and long-press when the list isn't `selectable`, calls it with the row — open the row's `ActionMenu` through its `menuRef` (Menu & items does this).
- **`SelectionBar` stacking:** when `minVisible` keeps more buttons than one narrow row holds, the buttons move to a full-width second row with full labels (POS running bill).
- **`FilterBar`:** the search box keeps its width; a long chip row scrolls in the space left. `count` may be text ("500+").
- **Server counts and paging:** `api.getWithMeta(path)` returns `{ data, headers }` (`headerNumber(h, 'X-Total-Count')`, `headerJson(h, 'X-Counts')`); `usePagedList(fetchPage, key)` in `@/hooks/usePagedList` does first page / load more / silent refresh for any server-paged list.
- **Live screens:** `useLivePoll`, `useNow`, `useDevicePref`, `usePageVisible`, `useScreenFocused` and `playAlert` live in `@/hooks/live`.
- **Floor alert times** (Tables / Kitchen / Online colours) come from the business setting `ops_thresholds` (Settings → Floor alerts) through `useFloorAges()`; the constants in `floorLogic.ts` are only the defaults.
