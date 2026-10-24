/**
 * Menu & items for big menus (docs/20_High_Volume_UX.md): a virtualised DataList (table on desktop, cards on
 * phones), FilterBar search + category chips with counts, bulk changes from the SelectionBar, quick inline price
 * edits on desktop and the item editor as a side panel next to the list (full screen on phones).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { catalogApi, inventoryApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { Category, Product, StockRow } from '@/api/types';
import { cachedTaxOverview, loadTaxOverview, type TaxOverview } from '@/api/taxes';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import {
  ActionMenu, Badge, Button, Card, DataList, FilterBar, IconButton, Screen, SelectionBar, StatusPill, Text, VegMark, toast, useHotkeys,
  type ActionMenuHandle, type ActionMenuItem, type DataColumn, type DataListSort, type FilterOption, type SelectionAction,
} from '@/components/ui';
import { TopDialogHost, promptTop } from './dialogs';
import { can, useRole } from '@/store/auth';
import { useData } from '@/store/data';
import { money } from '@/lib/format';
import { useCatalog } from './useCatalog';
import { CategoryManagerSheet } from './CategoryManagerSheet';
import { ProductEditor } from './ProductEditor';
import { LabelPrintSheet } from './LabelPrintSheet';
import { ProductHistorySheet } from './ProductHistorySheet';
import { NoAccess } from './components';
import { isFoodBusiness, itemGst, normName, parseMoney, plural, priceLabel, sanitizeMoney, sortCategories, MAX_PRICE } from './utils';
import { useSalesChannels } from './useChannels';
import { channelBadges, channelQuote, channelShortName, formatPct, isOnChannel, quoteLabel } from './channelPricing';
import { ChannelPricesBulkSheet } from './ChannelPricesBulkSheet';
import { BulkEditSheet, type BulkKind } from './BulkEditSheet';
import { filterMenu, menuCounts, sortMenu, withChannelAvailability, type MenuFilter } from './bulk';
import { channelsApi } from '@/api/channels';

/** The counter menu (no channel filter). */
const COUNTER = 'POS';

export function MenuScreen() {
  const role = useRole();
  if (!can(role, 'manage')) {
    return (
      <Screen title="Menu & items">
        <NoAccess title="Only owners and managers can edit the menu" message="Ask your owner or manager to add or change items, prices and categories." />
      </Screen>
    );
  }
  return <MenuManager />;
}

type EditorState = { product: Product | null; categoryId: string | null; key: number };

function MenuManager() {
  const { colors } = useTheme();
  const { isPhone, isDesktop } = useLayout();
  const catalog = useCatalog();
  const settings = useData((s) => s.settings);
  const brands = useData((s) => s.brands);
  const taxSnapshot = useData((s) => s.tax);
  const symbol = settings?.currency_symbol || '₹';
  const food = isFoodBusiness(settings?.business_type);
  const { menu: appChannels } = useSalesChannels();
  const [view, setView] = useState<string>(COUNTER);
  const viewChannel = view === COUNTER ? null : appChannels.find((c) => c.code === view) ?? null;

  // GST per row from the item's tax class (GET /taxes, shared cache; the offline snapshot until it loads)
  const [taxOverview, setTaxOverview] = useState<TaxOverview | null>(() => cachedTaxOverview(Infinity));
  useEffect(() => {
    let alive = true;
    loadTaxOverview().then((t) => { if (alive) setTaxOverview(t); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const taxSource = taxOverview ?? taxSnapshot;
  const gstFor = useCallback((p: Product) => itemGst(p, taxSource, settings), [taxSource, settings]);

  const products = catalog.products ?? [];
  const tracksStock = products.some((p) => p.track_stock);
  // Stock on hand for tracked items (one GET /inventory; plans without inventory just don't show the column)
  const [stock, setStock] = useState<Map<string, StockRow>>(new Map());
  useEffect(() => {
    if (!tracksStock) return;
    let alive = true;
    inventoryApi.list().then((rows) => { if (alive) setStock(new Map(rows.map((r) => [r.id, r]))); }).catch(() => {});
    return () => { alive = false; };
  }, [tracksStock, catalog.products]);

  const [filter, setFilter] = useState<MenuFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DataListSort | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [labels, setLabels] = useState<{ preselect: string[]; key: number } | null>(null);
  const [appBulk, setAppBulk] = useState<{ code: string | null; ids: string[] | null; key: number } | null>(null);
  const [bulk, setBulk] = useState<{ kind: BulkKind; ids: string[]; key: number } | null>(null);
  const [history, setHistory] = useState<Product | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [listWidth, setListWidth] = useState(0);
  // Table when the list has room for it (desktop, or a tablet without the side panel open); cards otherwise
  const tableMode = (listWidth || 9999) >= 560 && !isPhone;

  const categories = useMemo(() => sortCategories(catalog.categories), [catalog.categories]);
  const categoryIds = useMemo(() => new Set(categories.map((c) => c.id)), [categories]);
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const categoryRank = useMemo(() => new Map(categories.map((c, i) => [c.id, i])), [categories]);
  const effectiveFilter: MenuFilter = filter !== 'all' && filter !== 'none' && filter !== 'removed' && !categoryIds.has(filter) ? 'all' : filter;
  const removedView = effectiveFilter === 'removed';
  const channelCode = viewChannel?.code ?? null;

  const counts = useMemo(() => menuCounts(products, { query, channel: channelCode, categoryIds }), [products, query, channelCode, categoryIds]);
  const stockQty = useMemo(() => new Map([...stock.values()].map((r) => [r.id, r.stock])), [stock]);
  const rows = useMemo(() => {
    const list = filterMenu(products, { filter: effectiveFilter, query, channel: channelCode, categoryIds });
    const s = sort ? { key: sort.key, dir: sort.dir } : null;
    return sortMenu(list, s, categoryRank, stockQty, (p) => Number(gstFor(p).label.replace(/[^\d.]/g, '')) || 0);
  }, [products, effectiveFilter, query, channelCode, categoryIds, sort, categoryRank, stockQty, gstFor]);
  const activeProducts = useMemo(() => products.filter((p) => p.is_active), [products]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const selectedProducts = useMemo(() => selected.map((id) => byId.get(id)).filter((p): p is Product => !!p), [selected, byId]);

  // A new filter or menu starts a fresh selection (bulk actions differ for removed items)
  useEffect(() => { setSelected([]); }, [effectiveFilter, view]);

  const openProduct = useCallback((p: Product) => { setEditingPrice(null); setEditor({ product: p, categoryId: p.category_id, key: Date.now() }); }, []);
  const addItem = useCallback(() => setEditor({
    product: null,
    categoryId: effectiveFilter !== 'all' && effectiveFilter !== 'none' && effectiveFilter !== 'removed' ? effectiveFilter : null,
    key: Date.now(),
  }), [effectiveFilter]);
  const openScan = () => router.push('/menu/scan' as Href);
  const printLabels = (ids: string[] = []) => setLabels({ preselect: ids, key: Date.now() });

  const markBusy = (id: string, on: boolean) => setBusyIds((b) => ({ ...b, [id]: on }));

  /** Removed items come back with a normal update; the server records it as a new version ("Back on the menu"). */
  const bringBack = useCallback(async (p: Product) => {
    markBusy(p.id, true);
    try {
      const saved = await catalogApi.updateProduct(p.id, { is_active: true });
      catalog.upsertProduct(saved);
      toast.success(`“${saved.name}” is back on the menu`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      markBusy(p.id, false);
    }
  }, [catalog.upsertProduct]);

  const toggleChannel = useCallback(async (p: Product, code: string, label: string, available: boolean) => {
    const next = withChannelAvailability(p.channel_prices, code, available);
    if (!next) return;
    markBusy(p.id, true);
    try {
      const saved = await channelsApi.setProductPrices(p.id, next);
      catalog.upsertProduct(saved);
      toast.success(available ? `“${p.name}” is back on ${label}` : `“${p.name}” hidden on ${label}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      markBusy(p.id, false);
    }
  }, [catalog.upsertProduct]);

  const savePrice = useCallback(async (p: Product, text: string) => {
    setEditingPrice(null);
    const price = parseMoney(text);
    if (price === null || price === p.base_price) return;
    if (price > MAX_PRICE) { toast.error('Price is too high.'); return; }
    markBusy(p.id, true);
    try {
      const saved = await catalogApi.updateProduct(p.id, { base_price: price });
      catalog.upsertProduct(saved);
      toast.success(`${p.name}: ${money(p.base_price, symbol)} → ${money(saved.base_price, symbol)}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      markBusy(p.id, false);
    }
  }, [catalog.upsertProduct, symbol]);

  const addCategory = async () => {
    if (addingCategory) return;
    const name = await promptTop({ title: 'New category', label: 'Category name', placeholder: food ? 'e.g. Starters' : 'e.g. Dairy', confirmLabel: 'Add category', maxLength: 60 });
    if (!name) return;
    if (name.length > 60) return toast.error('Keep the category name under 60 characters.');
    const existing = categories.find((c) => normName(c.name) === normName(name));
    if (existing) {
      setFilter(existing.id);
      return toast.info(`“${existing.name}” already exists`);
    }
    setAddingCategory(true);
    try {
      const last = categories[categories.length - 1];
      let cat: Category = await catalogApi.createCategory(name);
      if (last && cat.sort_order <= last.sort_order) cat = await catalogApi.updateCategory(cat.id, { sort_order: last.sort_order + 1 }).catch(() => cat);
      catalog.upsertCategories([cat]);
      setFilter(cat.id);
      toast.success(`Added “${cat.name}”`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setAddingCategory(false);
    }
  };

  // --- keyboard (desktop web): N = new item, Esc cancels an inline price edit ---
  useHotkeys({ n: addItem }, [addItem], { enabled: !!catalog.products && !editor });

  // --- table columns / cards ---
  const inlinePrice = isDesktop && Platform.OS === 'web' && !removedView && !viewChannel;
  const columns = useMemo<DataColumn<Product>[]>(() => {
    const cols: DataColumn<Product>[] = [
      {
        key: 'name', title: 'Item', flex: 2.4, minWidth: 180, sortable: true,
        render: (p) => (
          <View style={styles.nameCell}>
            {p.is_veg === null ? <View style={[styles.dot, { backgroundColor: colors.border }]} /> : <VegMark veg={p.is_veg} size={12} />}
            <Text variant="bodyStrong" numberOfLines={1} style={[{ flexShrink: 1 }, !p.is_active && styles.struck]}>{p.name}</Text>
            {p.variants.length ? <Badge label={`${p.variants.length} options`} tone="neutral" /> : null}
          </View>
        ),
      },
      {
        key: 'category', title: 'Category', flex: 1, minWidth: 100, hideBelow: 760, sortable: true,
        value: (p) => (p.category_id ? categoryName.get(p.category_id) ?? 'Uncategorised' : 'Uncategorised'),
      },
      {
        key: 'price', title: viewChannel ? `${channelShortName(viewChannel)} price` : 'Price', width: 132, numeric: true, sortable: !viewChannel,
        render: (p) => (
          <PriceCell
            product={p}
            label={viewChannel ? quoteLabel(channelQuote(p, viewChannel), symbol) : priceLabel(p, symbol)}
            own={!!viewChannel && channelQuote(p, viewChannel).source === 'item'}
            editable={inlinePrice && !p.variants.length && p.is_active}
            editing={editingPrice === p.id}
            busy={!!busyIds[p.id]}
            symbol={symbol}
            onStart={() => setEditingPrice(p.id)}
            onCancel={() => setEditingPrice(null)}
            onCommit={(t) => void savePrice(p, t)}
          />
        ),
      },
      {
        key: 'gst', title: 'GST', width: 64, numeric: true, sortable: true, hideBelow: 560,
        render: (p) => {
          const g = gstFor(p);
          return <Text variant="small" tone={g.inherited ? 'subtle' : 'muted'} style={styles.num}>{g.label}</Text>;
        },
      },
    ];
    if (appChannels.length && !viewChannel && !removedView) {
      cols.push({
        key: 'apps', title: 'Apps', flex: 1.5, minWidth: 140, hideBelow: 860,
        render: (p) => {
          const b = channelBadges(p, appChannels, symbol);
          if (!b.length) return <Text variant="small" tone="subtle">Same as counter</Text>;
          return (
            <View style={styles.badges}>
              {b.slice(0, 2).map((x) => <Badge key={x.key} label={x.label} tone={x.tone} />)}
              {b.length > 2 ? <Text variant="caption" tone="subtle">+{b.length - 2}</Text> : null}
            </View>
          );
        },
      });
    }
    if (tracksStock) {
      cols.push({
        key: 'stock', title: 'Stock', width: 92, numeric: true, sortable: true, hideBelow: 480,
        render: (p) => {
          const s = stock.get(p.id);
          if (!p.track_stock || !s) return <Text variant="small" tone="subtle">—</Text>;
          return <Text variant="smallStrong" tone={s.stock <= 0 ? 'danger' : s.is_low ? 'warning' : 'default'} style={styles.num}>{s.stock} {s.unit || 'pcs'}</Text>;
        },
      });
    }
    cols.push({
      key: 'status', title: 'Status', width: 116,
      render: (p) => <ProductStatus product={p} stockRow={p.track_stock ? stock.get(p.id) : undefined} />,
    });
    return cols;
  }, [colors, categoryName, viewChannel, symbol, inlinePrice, editingPrice, busyIds, savePrice, gstFor, appChannels, removedView, tracksStock, stock]);

  const menuFor = useCallback((p: Product): ActionMenuItem[] => {
    const items: ActionMenuItem[] = [
      { key: 'edit', label: 'Edit item', icon: 'create-outline', onPress: () => openProduct(p) },
      { key: 'history', label: 'History & restore', icon: 'time-outline', description: 'Every change, with who made it', onPress: () => setHistory(p) },
    ];
    if (p.is_active) {
      if (p.barcode) items.push({ key: 'label', label: 'Print label', icon: 'print-outline', onPress: () => printLabels([p.id]) });
      const posOn = isOnChannel(p, 'POS');
      items.push({
        key: 'pos', label: posOn ? 'Hide at the counter' : 'Show at the counter', icon: posOn ? 'eye-off-outline' : 'eye-outline', group: 'menus',
        onPress: () => void toggleChannel(p, 'POS', 'the counter', !posOn),
      });
      for (const c of appChannels) {
        const on = isOnChannel(p, c.code);
        const name = channelShortName(c);
        items.push({
          key: `ch-${c.code}`, label: on ? `Hide on ${name}` : `Show on ${name}`, icon: on ? 'eye-off-outline' : 'eye-outline', group: 'menus',
          onPress: () => void toggleChannel(p, c.code, name, !on),
        });
      }
      items.push({ key: 'remove', label: 'Remove from menu…', icon: 'trash-outline', danger: true, group: 'danger', onPress: () => setBulk({ kind: 'remove', ids: [p.id], key: Date.now() }) });
    } else {
      items.push({ key: 'back', label: 'Bring back', icon: 'refresh', onPress: () => void bringBack(p) });
    }
    return items;
  }, [appChannels, bringBack, openProduct, toggleChannel]);

  // Each row's "⋯" menu registers its handle, so right-clicking anywhere on the row opens the same anchored menu
  const rowMenus = useRef(new Map<string, ActionMenuHandle>());
  const openRowMenu = useCallback((p: Product) => rowMenus.current.get(p.id)?.open(), []);
  const rowActions = useCallback((p: Product) => (
    <>
      {!p.is_active ? (
        <Button title={isPhone ? undefined : 'Bring back'} icon="refresh" size="sm" variant="tonal" onPress={() => void bringBack(p)}
          loading={!!busyIds[p.id]} disabled={!!busyIds[p.id]} accessibilityLabel={`Put ${p.name} back on the menu`} />
      ) : null}
      <ActionMenu items={menuFor(p)} align="end" title={p.name}
        menuRef={(h) => { if (h) rowMenus.current.set(p.id, h); else rowMenus.current.delete(p.id); }}
        trigger={(open) => <IconButton icon="ellipsis-horizontal" accessibilityLabel={`Actions for ${p.name}`} onPress={open} />} />
    </>
  ), [menuFor, bringBack, busyIds, isPhone]);

  const renderCard = useCallback((p: Product) => {
    const s = stock.get(p.id);
    const g = gstFor(p);
    const price = viewChannel ? quoteLabel(channelQuote(p, viewChannel), symbol) : priceLabel(p, symbol);
    const sub = [
      p.category_id ? categoryName.get(p.category_id) ?? 'Uncategorised' : 'Uncategorised',
      `GST ${g.label}`,
      p.track_stock && s ? `${s.stock} ${s.unit || 'pcs'} in stock` : null,
      p.variants.length ? `${p.variants.length} options` : null,
    ].filter(Boolean).join(' · ');
    return (
      <View style={{ gap: 4 }}>
        <View style={styles.nameCell}>
          {p.is_veg === null ? null : <VegMark veg={p.is_veg} size={12} />}
          <Text variant="bodyStrong" numberOfLines={1} style={[{ flex: 1 }, !p.is_active && styles.struck]}>{p.name}</Text>
          <Text variant="money" numberOfLines={1}>{price}</Text>
        </View>
        <View style={styles.nameCell}>
          <Text variant="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{sub}</Text>
          {!p.is_active || (s && (s.is_low || s.stock <= 0)) || !isOnChannel(p, 'POS') ? <ProductStatus product={p} stockRow={s} /> : null}
        </View>
      </View>
    );
  }, [stock, gstFor, viewChannel, symbol, categoryName]);

  // --- filters ---
  const filters = useMemo<FilterOption[]>(() => {
    const f: FilterOption[] = [{ key: 'all', label: 'All', count: counts.all }];
    for (const c of categories) {
      const n = counts.byCategory[c.id] ?? 0;
      if (n || effectiveFilter === c.id || !query) f.push({ key: c.id, label: c.name, count: n });
    }
    if (counts.none || effectiveFilter === 'none') f.push({ key: 'none', label: 'Uncategorised', count: counts.none });
    if (counts.removed || removedView) f.push({ key: 'removed', label: 'Removed', icon: 'archive-outline', count: counts.removed });
    return f;
  }, [counts, categories, effectiveFilter, query, removedView]);

  const channelMenu: ActionMenuItem[] = [
    { key: 'pos', label: 'Counter menu', icon: 'storefront-outline', selected: !viewChannel, description: 'Everything you sell at the counter', onPress: () => setView(COUNTER) },
    ...appChannels.map((c) => ({
      key: c.code, label: `${channelShortName(c)} menu`, icon: 'bicycle-outline' as const, selected: view === c.code,
      description: Number(c.price_adjust_pct) ? `Counter price ${formatPct(c.price_adjust_pct)} unless set` : 'Counter price unless set',
      onPress: () => { setView(c.code); if (removedView) setFilter('all'); },
    })),
  ];
  const channelPicker = appChannels.length ? (
    <ActionMenu items={channelMenu} title="Menu on" align="end"
      trigger={(open) => (
        <Button title={isPhone ? (viewChannel ? channelShortName(viewChannel) : 'Counter') : `Menu on: ${viewChannel ? channelShortName(viewChannel) : 'Counter'}`}
          icon={viewChannel ? 'bicycle-outline' : 'storefront-outline'} iconRight="chevron-down" variant="outline" onPress={open}
          accessibilityLabel="Choose which menu to show" />
      )} />
  ) : null;

  // --- selection bar ---
  const selectionActions = useMemo<SelectionAction[]>(() => {
    const ids = selected;
    if (removedView) {
      return [{ key: 'back', label: 'Bring back', icon: 'refresh', onPress: () => setBulk({ kind: 'restore', ids, key: Date.now() }) }];
    }
    const a: SelectionAction[] = [
      { key: 'price', label: 'Price', icon: 'pricetag-outline', description: 'Set a price or change by % / ₹', onPress: () => setBulk({ kind: 'price', ids, key: Date.now() }) },
    ];
    if (appChannels.length) a.push({ key: 'apps', label: 'App prices', icon: 'bicycle-outline', onPress: () => setAppBulk({ code: viewChannel?.code ?? null, ids, key: Date.now() }) });
    a.push(
      { key: 'tax', label: 'Tax class', icon: 'document-text-outline', onPress: () => setBulk({ kind: 'tax', ids, key: Date.now() }) },
      { key: 'category', label: 'Move', icon: 'folder-open-outline', description: 'Move to another category', onPress: () => setBulk({ kind: 'category', ids, key: Date.now() }) },
      { key: 'channel', label: 'Show / hide', icon: 'eye-off-outline', description: 'On the counter or a delivery app', onPress: () => setBulk({ kind: 'channel', ids, key: Date.now() }) },
      { key: 'labels', label: 'Print labels', icon: 'print-outline', onPress: () => printLabels(ids) },
      { key: 'remove', label: 'Remove', icon: 'trash-outline', danger: true, onPress: () => setBulk({ kind: 'remove', ids, key: Date.now() }) },
    );
    return a;
  }, [selected, removedView, appChannels.length, viewChannel]);

  const selectionBar = selected.length ? (
    <SelectionBar count={selected.length} onClear={() => setSelected([])} actions={selectionActions}
      total={rows.length} onSelectAll={() => setSelected(rows.map((p) => p.id))}
      label={(n) => (isPhone ? `${n}` : `${plural(n, 'item')} selected`)} />
  ) : null;

  // --- header actions ---
  const moreItems: ActionMenuItem[] = [
    { key: 'scan', label: 'Scan menu photo', icon: 'camera-outline', description: 'Add many items from a picture', hidden: !isPhone, onPress: openScan },
    { key: 'labels', label: 'Print barcode labels', icon: 'print-outline', disabled: !activeProducts.length, onPress: () => printLabels() },
    { key: 'apps', label: 'Set app prices', icon: 'pricetags-outline', hidden: !appChannels.length, onPress: () => setAppBulk({ code: viewChannel?.code ?? null, ids: null, key: Date.now() }) },
    { key: 'cats', label: 'Edit categories', icon: 'albums-outline', description: 'Rename, reorder, delete', onPress: () => setManageOpen(true) },
    { key: 'newcat', label: 'New category', icon: 'add-circle-outline', disabled: addingCategory, onPress: () => void addCategory() },
  ];
  const actions = (
    <>
      <ActionMenu items={moreItems} align="end" title="Menu tools"
        trigger={(open) => (isPhone
          ? <IconButton icon="ellipsis-horizontal" variant="secondary" accessibilityLabel="More menu tools" onPress={open} />
          : <Button title="More" icon="ellipsis-horizontal" variant="outline" onPress={open} />)} />
      {isPhone ? null : <Button title="Scan menu photo" icon="camera-outline" variant="tonal" onPress={openScan} />}
      <Button title={isPhone ? 'Add' : 'Add item'} icon="add" onPress={addItem} shortcut="N" />
    </>
  );

  const subtitle = catalog.products
    ? `${plural(activeProducts.length, 'item')} · ${plural(categories.length, 'category', 'categories')}${viewChannel ? ` · showing the ${channelShortName(viewChannel)} menu` : ''}`
    : undefined;

  const emptyTitle = removedView ? 'No removed items' : query ? 'No items match your search' : viewChannel ? `Nothing here is on ${channelShortName(viewChannel)}` : 'No items in this category';

  let body: React.ReactNode;
  if (catalog.products && products.length === 0 && !catalog.loading) {
    body = <FirstRun food={food} onScan={openScan} onAdd={addItem} onCategory={() => void addCategory()} />;
  } else {
    body = (
      <View style={styles.split}>
        <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
          {viewChannel && !removedView ? (
            <View style={[styles.banner, { backgroundColor: colors.infoSoft, borderColor: colors.info }]}>
              <Ionicons name="bicycle-outline" size={16} color={colors.infoText} />
              <Text variant="small" tone="info" style={{ flex: 1 }} numberOfLines={2}>
                {`${channelShortName(viewChannel)}: ${plural(counts.all, 'item')} on the menu. `}
                {Number(viewChannel.price_adjust_pct)
                  ? `No own price → counter price ${formatPct(viewChannel.price_adjust_pct)}.`
                  : 'No own price → counter price.'}
              </Text>
              <Button title={isPhone ? 'Prices' : `Set ${channelShortName(viewChannel)} prices`} size="sm" variant="outline" icon="pricetags-outline"
                onPress={() => setAppBulk({ code: viewChannel.code, ids: null, key: Date.now() })} />
            </View>
          ) : null}
          <View style={[styles.listCard, tableMode && { borderWidth: 1, borderRadius: 14, borderColor: colors.border, backgroundColor: colors.surface }]}
            onLayout={(e) => setListWidth(Math.round(e.nativeEvent.layout.width))}>
            <DataList<Product>
              layout={tableMode ? 'table' : 'cards'}
              data={catalog.products ? rows : null}
              keyExtractor={(p) => p.id}
              columns={columns}
              renderCard={renderCard}
              cardHeight={isPhone ? 72 : 68}
              tableMinWidth={560}
              loading={catalog.loading}
              error={catalog.error}
              onRetry={catalog.reload}
              empty={{
                icon: query ? 'search-outline' : removedView ? 'archive-outline' : 'file-tray-outline',
                title: emptyTitle,
                action: removedView ? undefined : { label: 'Add item', icon: 'add', onPress: addItem },
              }}
              refreshing={catalog.refreshing}
              onRefresh={catalog.reload}
              onPressRow={openProduct}
              onRowMenu={openRowMenu}
              openKey={editor?.product?.id ?? null}
              keyboard={!editor && !bulk}
              rowActions={rowActions}
              rowActionsWidth={removedView && !isPhone ? 168 : 56}
              selectable={!(editor && !tableMode) || selected.length > 0}
              selectedKeys={selected}
              onSelectionChange={setSelected}
              sort={sort}
              onSortChange={setSort}
              extraData={busyIds}
              selectionBar={selectionBar}
              testID="menu-list"
            />
          </View>
        </View>
        {editor ? (
          <ProductEditor
            key={editor.key}
            product={editor.product}
            initialCategoryId={editor.categoryId}
            categories={categories}
            products={products}
            brands={brands}
            settings={settings}
            onClose={() => setEditor(null)}
            onSaved={catalog.upsertProduct}
            onDeleted={catalog.removeProduct}
            onCategoryCreated={(c) => catalog.upsertCategories([c])}
            onPrintLabel={(p) => printLabels([p.id])}
            channels={appChannels}
            narrow={!isPhone}
          />
        ) : null}
      </View>
    );
  }

  // One bar: FilterBar keeps the search box its width and scrolls the category chips (or stacks them when narrow)
  const toolbar = catalog.products && products.length ? (
    <FilterBar onSearch={setQuery} search={query} searchPlaceholder="Name, SKU or barcode" right={channelPicker}
      filters={filters} value={effectiveFilter} onChange={(k) => setFilter(k)} />
  ) : undefined;

  return (
    <Screen title="Menu & items" subtitle={subtitle} actions={actions} toolbar={toolbar} scroll={false} contentStyle={{ flex: 1, paddingBottom: 16 }}
      maxWidth={isDesktop ? 1680 : 1280}>
      {body}
      <CategoryManagerSheet
        visible={manageOpen}
        onClose={() => setManageOpen(false)}
        categories={categories}
        products={products}
        onCategories={catalog.upsertCategories}
        onDropCategory={(id) => { catalog.dropCategory(id); if (filter === id) setFilter('all'); }}
        onProducts={catalog.upsertProducts}
        onReload={catalog.silentReload}
      />
      {labels ? (
        <LabelPrintSheet key={labels.key} visible onClose={() => setLabels(null)} products={activeProducts} preselect={labels.preselect}
          settings={settings} onProducts={catalog.upsertProducts} />
      ) : null}
      {appBulk && appChannels.length ? (
        <ChannelPricesBulkSheet
          key={appBulk.key}
          visible
          onClose={() => setAppBulk(null)}
          channels={appChannels}
          initialCode={appBulk.code}
          products={appBulk.ids ? appBulk.ids.map((id) => byId.get(id)).filter((p): p is Product => !!p && p.is_active) : activeProducts}
          categories={categories}
          symbol={symbol}
          onProducts={catalog.upsertProducts}
        />
      ) : null}
      {bulk ? (
        <BulkEditSheet
          key={bulk.key}
          kind={bulk.kind}
          products={bulk.ids.map((id) => byId.get(id)).filter((p): p is Product => !!p)}
          categories={categories}
          channels={appChannels}
          symbol={symbol}
          onClose={() => setBulk(null)}
          onSaved={catalog.upsertProducts}
          onDone={(okIds) => {
            const done = new Set(okIds);
            setSelected((s) => s.filter((id) => !done.has(id)));
            if (editor?.product && done.has(editor.product.id) && (bulk.kind === 'remove' || bulk.kind === 'restore')) setEditor(null);
          }}
        />
      ) : null}
      {history ? (
        <ProductHistorySheet product={history} onClose={() => setHistory(null)} categories={categories} channels={appChannels} symbol={symbol} unsaved={false}
          onRestored={(saved) => { catalog.upsertProduct(saved); setHistory(null); }} />
      ) : null}
      <TopDialogHost />
    </Screen>
  );
}

/** Status pill: removed (red, struck), not sold at the counter, low / out of stock, or on the menu. */
function ProductStatus({ product: p, stockRow }: { product: Product; stockRow?: StockRow }) {
  if (!p.is_active) return <StatusPill status="void" label="Removed" />;
  if (!isOnChannel(p, 'POS')) return <StatusPill status="served" label="Apps only" showIcon={false} />;
  if (stockRow && stockRow.stock <= 0) return <StatusPill status="lapsed" label="Out of stock" />;
  if (stockRow?.is_low) return <StatusPill status="pending" label="Low stock" />;
  return <StatusPill status="active" label="On menu" />;
}

/** Price cell; on desktop web a click turns it into an input (Enter saves, Esc cancels). */
function PriceCell({ product, label, own, editable, editing, busy, symbol, onStart, onCancel, onCommit }: {
  product: Product; label: string; own: boolean; editable: boolean; editing: boolean; busy: boolean; symbol: string;
  onStart: () => void; onCancel: () => void; onCommit: (text: string) => void;
}) {
  const { colors, radius } = useTheme();
  // Starts empty with the current price as placeholder: type the new price, Enter saves, Esc or an empty box cancels
  const [text, setText] = useState('');
  const done = useRef(false);
  useEffect(() => { if (editing) { setText(''); done.current = false; } }, [editing]);

  if (busy) return <ActivityIndicator size="small" color={colors.primary} />;
  if (editing) {
    const finish = (save: boolean) => {
      if (done.current) return;
      done.current = true;
      if (save) onCommit(text); else onCancel();
    };
    return (
      <View style={[styles.priceEdit, { borderColor: colors.primary, borderRadius: radius.sm, backgroundColor: colors.surface }]}>
        <Text variant="small" tone="muted">{symbol}</Text>
        <TextInput
          autoFocus
          value={text}
          onChangeText={(t) => setText(sanitizeMoney(t))}
          onSubmitEditing={() => finish(!!text.trim())}
          placeholder={String(product.base_price)}
          placeholderTextColor={colors.textSubtle}
          onBlur={() => finish(!!text.trim())}
          onKeyPress={(e: any) => { if (e.nativeEvent?.key === 'Escape') { e.preventDefault?.(); e.stopPropagation?.(); finish(false); } }}
          keyboardType="decimal-pad"
          accessibilityLabel={`New price for ${product.name}`}
          style={[styles.priceInput, { color: colors.text }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
        />
      </View>
    );
  }
  const textEl = <Text variant="money" numberOfLines={1} tone={own ? 'primary' : 'default'}>{label}</Text>;
  if (!editable) return textEl;
  return (
    <Pressable onPress={onStart} accessibilityRole="button" accessibilityLabel={`Change price of ${product.name}, now ${label}`}
      style={({ hovered }: any) => [styles.pricePress, { borderRadius: radius.sm, borderColor: hovered ? colors.borderStrong : 'transparent' }, Platform.OS === 'web' && ({ cursor: 'text' } as any)]}>
      {textEl}
    </Pressable>
  );
}

function FirstRun({ food, onScan, onAdd, onCategory }: { food: boolean; onScan: () => void; onAdd: () => void; onCategory: () => void }) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const steps = [
    { icon: 'camera-outline' as const, title: 'Snap your menu', text: 'A clear photo of each page — printed menus and boards work.' },
    { icon: 'create-outline' as const, title: 'Check the list', text: 'Fix any name or price we misread, set categories and GST.' },
    { icon: 'checkmark-done-outline' as const, title: 'Start billing', text: 'Items appear on the billing screen right away.' },
  ];
  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 12 }}>
      <Card style={[styles.hero, { borderColor: colors.primary }]}>
        <View style={[styles.heroIcon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="sparkles" size={30} color={colors.primary} />
        </View>
        <Text variant={isPhone ? 'h1' : 'display'} align="center">{food ? 'Add your whole menu from a photo' : 'Add your products'}</Text>
        <Text tone="muted" align="center" style={{ maxWidth: 520 }}>
          {food
            ? 'Take a picture of your printed menu. Tallyko reads the item names and prices, you check them, and your menu is ready in a couple of minutes.'
            : 'Scan a printed price list, add items one by one, or scan product barcodes as you go.'}
        </Text>
        <View style={[styles.heroActions, isPhone && { flexDirection: 'column', alignSelf: 'stretch' }]}>
          <Button title="Scan menu photo" icon="camera" size="lg" onPress={onScan} full={isPhone} />
          <Button title="Add items manually" icon="add" size="lg" variant="outline" onPress={onAdd} full={isPhone} />
        </View>
        <Button title="or start by creating categories" variant="ghost" size="sm" onPress={onCategory} />
        <View style={[styles.steps, isPhone && { flexDirection: 'column' }]}>
          {steps.map((s, i) => (
            <View key={s.title} style={[styles.step, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={[styles.stepNum, { backgroundColor: colors.primary }]}>
                  <Text variant="caption" color={colors.primaryText}>{i + 1}</Text>
                </View>
                <Ionicons name={s.icon} size={18} color={colors.textMuted} />
                <Text variant="bodyStrong">{s.title}</Text>
              </View>
              <Text variant="small" tone="muted">{s.text}</Text>
            </View>
          ))}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  split: { flex: 1, flexDirection: 'row', gap: 16, minHeight: 0 },
  listCard: { flex: 1, overflow: 'hidden', minHeight: 240 },
  nameCell: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: 4, overflow: 'hidden' },
  dot: { width: 6, height: 6, borderRadius: 3, marginHorizontal: 3 },
  struck: { textDecorationLine: 'line-through', opacity: 0.7 },
  num: { fontVariant: ['tabular-nums'] },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  priceEdit: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, height: 32, paddingHorizontal: 8, width: 112 },
  priceInput: { flex: 1, minWidth: 0, fontSize: 15, fontVariant: ['tabular-nums'], textAlign: 'right', paddingVertical: 0 },
  pricePress: { borderWidth: 1, borderStyle: 'dashed', paddingHorizontal: 6, paddingVertical: 2 },
  hero: { alignItems: 'center', gap: 14, paddingVertical: 32, paddingHorizontal: 24, borderWidth: 1.5, maxWidth: 860, alignSelf: 'center', width: '100%' },
  heroIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  heroActions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 },
  steps: { flexDirection: 'row', gap: 12, marginTop: 8, alignSelf: 'stretch' },
  step: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
  stepNum: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
