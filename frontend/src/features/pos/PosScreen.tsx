/**
 * Billing (POS) screen: product browser + cart, payments, KOT, receipts, running bills, offline bills.
 * Tablet/desktop: items + an adaptive cart panel (~38%, 320–440 px). Phone: full-width items with a sticky
 * cart bar (KOT / Pay one tap away) that opens the cart in a sheet.
 * Keyboard (desktop web, docs/20 §1.5): / or F2 search · arrows + Enter add · + / − last item · F9 KOT ·
 * F8 or Ctrl+Enter pay · Esc close. A barcode scanner can type anywhere on the page.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { ChannelCode, Order, OrderItem, OrderType, PaymentInput, Product, TableInfo } from '@/api/types';
import { catalogApi, ordersApi, tablesApi } from '@/api/endpoints';
import { floorApi } from '@/api/floor';
import { offersApi } from '@/api/offers';
import { errorMessage, ApiError } from '@/api/client';
import { Button, EmptyState, IconButton, Loading, Sheet, Text, confirm, toast, useHotkeys, type ActionMenuItem } from '@/components/ui';
import { isTypingTarget } from '@/hooks/useHotkeys';
import { OfflineBanner } from '@/components/OfflineBanner';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { useAuth, can } from '@/store/auth';
import { useCan } from '@/store/access';
import { activeCategories, activeProducts, useData } from '@/store/data';
import { useOutbox } from '@/store/outbox';
import { useBadges } from '@/store/badges';
import { usePrefs } from '@/store/prefs';
import { useNet } from '@/lib/sync';
import { availableOn, kotFromOrder, printBill, printErrorMessage, printKitchenTicket } from '@/lib/billing';
import { CHANNEL_LABEL, money, ORDER_TYPE_LABEL, round2, uuid } from '@/lib/format';
import { getDraft, useCart, useDraft, type AttachedCustomer } from './cart';
import { CartPanel, type CartOfferInfo } from './CartPanel';
import { OfferSheet } from './OfferSheet';
import { offerCovers, useCartOffers, useOfferCatalog, type AppliedOffer } from './offers';
import { ProductBrowser } from './ProductBrowser';
import { PaymentSheet, type LoyaltyOption } from './PaymentSheet';
import { LastBillCard, ReceiptSheet, type ReceiptState } from './ReceiptSheet';
import { ScannerSheet } from './ScannerSheet';
import { ChannelSheet, CustomerSheet, DiscountSheet, RunningOrdersSheet, TableSheet, VariantSheet, posChannels } from './sheets';
import { BillDetailsSheet, MergeBillsSheet, TableBillsSheet, type BillSummary } from './BillSheets';
import { billName, itemsLocked } from './runningBill';
import { usePosPrefs } from './posPrefs';
import { cartWidthFor, isLikelyCode } from './posLayout';
import { saveOnDevice, buildCreatePayload, buildLocalOrder, channelAdjust, findByCode, isAggregator, matchesQuery, priceDraft, validateDraft, type PricedDraft, type PreviewOffer } from './totals';

type SheetName = 'pay' | 'table' | 'channel' | 'customer' | 'discount' | 'scan' | 'running' | 'offer' | 'billDetails' | 'merge';

/** A busy table was picked: ask which bill the order goes on (or start a separate one). */
interface BillChoice { tableId: string; tableLabel: string; bills: BillSummary[] }

/** POST /orders refused because the table already has a bill (another device got there first). */
const tableBusy = (e: unknown) => e instanceof ApiError && e.status === 409 && /running bill|separate bill/i.test(e.message);

function useCartHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useCart.persist.hasHydrated());
  useEffect(() => {
    const unsub = useCart.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useCart.persist.hasHydrated());
    return unsub;
  }, []);
  return hydrated;
}

const tap = () => {
  if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
};

export function PosScreen() {
  const role = useAuth((s) => s.session?.role ?? null);
  if (role === 'kitchen') {
    return (
      <Shell>
        <EmptyState icon="flame-outline" title="Billing isn't available for kitchen accounts"
          message="Kitchen accounts see orders on the Kitchen screen. Ask a manager or cashier to take bills."
          action={{ label: 'Open kitchen screen', icon: 'arrow-forward', onPress: () => router.navigate('/kitchen') }} />
      </Shell>
    );
  }
  return <Pos />;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { isPhone } = useLayout();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: isPhone ? insets.top : 0 }}>
      <OfflineBanner />
      {children}
    </View>
  );
}

function Pos() {
  const { colors, radius, shadow } = useTheme();
  const { isPhone, isDesktop, width, height } = useLayout();
  const insets = useSafeAreaInsets();

  const session = useAuth((s) => s.session);
  const tenantId = session?.tenantId ?? null;
  const role = session?.role ?? null;
  const canBill = can(role, 'bill');
  const canManage = can(role, 'manage');
  const canApplyOffers = useCan('offers.apply', 'offers');

  const settings = useData((s) => s.settings);
  const allProducts = useData((s) => s.products);
  const allCategories = useData((s) => s.categories);
  const channels = useData((s) => s.channels);
  const customers = useData((s) => s.customers);
  const lastSyncedAt = useData((s) => s.lastSyncedAt);
  const tax = useData((s) => s.tax);
  const upsertProduct = useData((s) => s.upsertProduct);
  const online = useNet((s) => s.online && s.serverReachable);
  const defaultTypePref = usePrefs((s) => s.defaultOrderType);

  const setTenant = useCart((s) => s.setTenant);
  const patch = useCart((s) => s.patch);
  const addToCart = useCart((s) => s.add);
  const resetCart = useCart((s) => s.reset);
  const loadOrder = useCart((s) => s.loadOrder);
  const hydrated = useCartHydrated();
  const draft = useDraft();

  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [variantProduct, setVariantProduct] = useState<Product | null>(null);
  const [submitting, setSubmitting] = useState<'kot' | 'pay' | null>(null);
  /** The bill just paid: a card in the empty new bill (never a blocking dialog); `receiptOpen` shows it in full. */
  const [lastBill, setLastBill] = useState<ReceiptState | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [bodyWidth, setBodyWidth] = useState(0);
  const view = usePosPrefs((s) => s.view);
  const setPosPrefs = usePosPrefs((s) => s.set);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const lock = useRef(false);
  const searchRef = useRef<TextInput>(null);

  const currency = settings?.currency_symbol ?? '₹';
  const isRetail = settings?.business_type === 'retail';
  const defaultType: OrderType = isRetail ? 'RETAIL_WALKIN' : defaultTypePref === 'RETAIL_WALKIN' ? 'TAKEAWAY' : defaultTypePref;

  useEffect(() => { setTenant(tenantId); useOfferCatalog.getState().clear(); }, [tenantId, setTenant]);

  // Order type defaults; retail shops only ever bill walk-in / takeaway
  useEffect(() => {
    if (!hydrated || !tenantId) return;
    // Read the store, not this render's draft: right after sign-in / reload the render can still hold the empty draft
    // while the store already has this business's running bill (whose order type must not be overwritten)
    const d = getDraft();
    if (d.resume) return;
    if (!d.orderType || (isRetail && (d.orderType === 'DINE_IN' || d.orderType === 'DELIVERY'))) patch({ orderType: defaultType });
  }, [hydrated, tenantId, draft.orderType, draft.resume, isRetail, defaultType, patch]);

  // Menu, sorted by category then item order
  const categories = useMemo(() => activeCategories(allCategories), [allCategories]);
  const products = useMemo(() => {
    const catOrder = new Map(categories.map((c, i) => [c.id, i]));
    // Items switched off for this channel (e.g. not on Zomato) don't show while billing for it
    return activeProducts(allProducts).filter((p) => availableOn(p, draft.channel)).sort((a, b) =>
      (catOrder.get(a.category_id ?? '') ?? 999) - (catOrder.get(b.category_id ?? '') ?? 999) || a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }, [allProducts, categories, draft.channel]);
  const productsById = useMemo(() => new Map(allProducts.map((p) => [p.id, p])), [allProducts]);

  const adjustPct = channelAdjust(channels, draft.channel);

  // Offers: suggestions for this cart (online only); the bill never waits on them
  const offers = useCartOffers({ draft, enabled: canApplyOffers, online });
  const applied: AppliedOffer | null = useMemo(() => {
    if (canApplyOffers) return offers.applied;
    // Staff who can't apply offers still see (and pay) the offer a running bill already has
    const r = draft.resume;
    return r?.offer_id ? {
      id: r.offer_id, name: r.offer_name ?? 'Offer', description: '', discount: r.offer_discount ?? 0, freeProductId: null, freeQuantity: 0,
      kind: null, productIds: [], categoryIds: [], fromOrder: true,
    } : null;
  }, [canApplyOffers, offers.applied, draft.resume]);
  const previewOffer: PreviewOffer | null = useMemo(() => (applied && applied.discount > 0
    ? { discount: applied.discount, covers: (productId: string) => offerCovers(applied, productId, productsById) } : null), [applied, productsById]);
  const priced = useMemo(() => priceDraft(draft, productsById, settings, adjustPct, { tax, offer: previewOffer }),
    [draft, productsById, settings, adjustPct, tax, previewOffer]);
  /** The bill without any offer (what gets saved when the internet drops). */
  const pricedPlain = (): PricedDraft => priceDraft(getDraft(), productsById, settings, adjustPct, { tax });
  const inCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of draft.lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.quantity);
    return m;
  }, [draft.lines]);
  const enabledChannels = posChannels(channels);
  const showChannel = enabledChannels.length > 1 || draft.channel !== 'POS';

  const customerPoints = draft.customer?.id ? customers.find((c) => c.id === draft.customer!.id)?.points ?? draft.customer.points : 0;

  // ------------------------------------------------------------------ adding items

  const pick = useCallback((p: Product) => {
    const channel = getDraft().channel;
    if (!availableOn(p, channel)) { toast.warning(`${p.name} isn't on the ${CHANNEL_LABEL[channel] ?? channel} menu`); return; }
    tap();
    if (p.variants.length > 0) setVariantProduct(p);
    else addToCart(p, null, 1);
  }, [addToCart]);

  const lookupCode = useCallback(async (code: string): Promise<Product | null> => {
    const local = findByCode(useData.getState().products, code);
    if (local) return local;
    if (!online || !/^[0-9A-Za-z\-. ]{3,48}$/.test(code)) return null;
    try {
      const p = await catalogApi.byBarcode(code);
      if (p?.is_active) { upsertProduct(p); return p; }
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) toast.error(errorMessage(e));
    }
    return null;
  }, [online, upsertProduct]);

  /** Enter in search: an exact barcode / SKU wins, then a code the server knows, then the highlighted match. */
  const submitSearch = useCallback(async (raw: string, highlighted: Product | null = null) => {
    const text = raw.trim();
    if (!text) return;
    const exact = findByCode(products, text);
    if (exact) { pick(exact); setQuery(''); return; }
    const matches = products.filter((p) => matchesQuery(p, text));
    if (matches.length === 1) { pick(matches[0]!); setQuery(''); return; }
    if (!matches.length || isLikelyCode(text)) {
      const remote = await lookupCode(text);
      if (remote) { pick(remote); setQuery(''); return; }
    }
    if (matches.length > 1) {
      pick(highlighted && matches.includes(highlighted) ? highlighted : matches[0]!);
      setQuery('');
      return;
    }
    toast.warning(`No item with code “${text}”`);
  }, [products, pick, lookupCode]);

  /** One less of a product (list stepper): the most recently added line of it. */
  const decrement = useCallback((p: Product) => {
    const lines = getDraft().lines;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]!.productId === p.id) { tap(); useCart.getState().bump(lines[i]!.id, -1); return; }
    }
  }, []);

  /** + / − on the keyboard: the quantity of the last item touched. */
  const bumpLast = useCallback((delta: number) => {
    const s = useCart.getState();
    const lines = getDraft().lines;
    const id = s.lastLineId && lines.some((l) => l.id === s.lastLineId) ? s.lastLineId : lines[lines.length - 1]?.id;
    if (id) s.bump(id, delta);
  }, []);

  const onCameraCode = useCallback(async (code: string) => {
    const p = await lookupCode(code);
    if (!p) { toast.warning(`No item with barcode ${code}`); return; }
    if (!availableOn(p, getDraft().channel)) { toast.warning(`${p.name} isn't on this channel's menu`); return; }
    if (p.variants.length) { setVariantProduct(p); return; }
    addToCart(p, null, 1);
    tap();
    setLastScanned(`${p.name} · ${money(p.base_price, currency)}`);
  }, [lookupCode, addToCart, currency]);

  const onVariant = useCallback((variantId: string) => {
    if (!variantProduct) return;
    addToCart(variantProduct, variantId, 1);
    const v = variantProduct.variants.find((x) => x.id === variantId);
    if (sheet === 'scan') setLastScanned(`${variantProduct.name} (${v?.name ?? ''})`);
    setVariantProduct(null);
  }, [variantProduct, addToCart, sheet]);

  // ------------------------------------------------------------------ running orders

  const hasUnsaved = () => getDraft().lines.length > 0;

  const openOrder = useCallback(async (orderId: string, opts: { keepLines?: boolean } = {}) => {
    if (!online) { toast.error('Running bills need an internet connection. Try again when you are back online.'); return; }
    const current = getDraft();
    if (current.resume?.id === orderId) { setSheet(null); return; }
    if (current.lines.length && !opts.keepLines && !(await confirm({ title: 'Discard the current bill?', message: `${current.lines.length} unsaved item(s) will be removed.`, confirmLabel: 'Discard', danger: true }))) return;
    try {
      const order = await ordersApi.get(orderId);
      if (order.status === 'completed') { toast.info(`Bill ${order.invoice_no ?? order.code} is already paid`); return; }
      if (order.status === 'cancelled') { toast.info('That order was cancelled'); return; }
      if (order.status === 'merged') { toast.info(order.cancel_reason ?? 'That bill was merged into another one'); return; }
      loadOrder(order, { keepLines: opts.keepLines });
      setSheet(null);
      if (opts.keepLines && current.lines.length) toast.info(`New items will go on ${order.bill_label ?? (order.table_label ? `Table ${order.table_label}` : 'this bill')} — send them to the kitchen`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [online, loadOrder]);

  // ------------------------------------------------------------------ several bills on one table

  const [tableBills, setTableBills] = useState<Order[]>([]);
  const [billChoice, setBillChoice] = useState<BillChoice | null>(null);
  const billTableId = draft.resume ? draft.resume.table_id ?? null : draft.orderType === 'DINE_IN' && draft.newBill ? draft.tableId : null;
  const billsKey = `${billTableId ?? ''}|${draft.resume?.id ?? ''}|${draft.resume?.total_amount ?? ''}|${draft.resume?.items?.length ?? ''}`;
  const billsSeq = useRef(0);
  const loadTableBills = useCallback(async (tableId: string | null) => {
    const seq = ++billsSeq.current; // only the latest request may set the tabs
    if (!tableId) { setTableBills([]); return; }
    if (!online) return; // keep the tabs we had
    try {
      const bills = (await floorApi.tableBills(tableId)).filter((b) => b.status === 'open' || b.status === 'placed')
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      if (seq === billsSeq.current) setTableBills(bills);
    } catch {
      /* keep the tabs we had */
    }
  }, [online]);
  useEffect(() => { void loadTableBills(billTableId); }, [billsKey, loadTableBills]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Busy table: ask "Add to Bill 1 / Start a separate bill". */
  const chooseBill = useCallback(async (table: Pick<TableInfo, 'id' | 'table_number' | 'open_bills' | 'current_order'>) => {
    let bills: BillSummary[] = table.open_bills ?? [];
    if (online) {
      try { bills = await floorApi.tableBills(table.id); } catch { /* use what the table list had */ }
    }
    bills = bills.filter((b) => !b.status || b.status === 'open' || b.status === 'placed');
    if (!bills.length && table.current_order) bills = [{ id: table.current_order.id, bill_label: null, total_amount: table.current_order.total_amount, guests: null, customer_name: table.current_order.customer_name }];
    if (!bills.length) {
      if (getDraft().resume) resetCart({ orderType: 'DINE_IN' });
      patch({ orderType: 'DINE_IN', tableId: table.id, tableLabel: table.table_number, newBill: false });
      setSheet(null);
      return;
    }
    setSheet(null);
    setBillChoice({ tableId: table.id, tableLabel: table.table_number, bills });
  }, [online, patch, resetCart]);

  /** Start another bill on a table that already has one; unsent items come along. */
  const startSeparateBill = useCallback((tableId: string, tableLabel: string, details: { label: string; guests: number | null } = { label: '', guests: null }) => {
    const lines = getDraft().lines;
    const keepChannel = getDraft().channel;
    resetCart({ orderType: 'DINE_IN', channel: keepChannel });
    patch({ orderType: 'DINE_IN', tableId, tableLabel, newBill: true, billLabel: details.label, guests: details.guests, lines });
    setBillChoice(null);
    setSheet(null);
  }, [patch, resetCart]);

  const switchBill = useCallback((orderId: string) => {
    void openOrder(orderId, { keepLines: true });
  }, [openOrder]);

  const onResumeChange = useCallback((order: Order, message?: string) => {
    const current = getDraft().resume;
    patch({ resume: { ...order, table_label: order.table_label ?? current?.table_label } });
    if (message) toast.success(message);
    void useBadges.getState().refresh();
  }, [patch]);

  const onMoved = useCallback(({ source, target }: { source: Order; target: Order }) => {
    const label = target.table_label ?? source.table_label;
    const targetName = target.bill_label ?? 'the other bill';
    if (source.status === 'merged') {
      loadOrder({ ...target, table_label: label }, { keepLines: true });
      toast.success(`Everything moved to ${targetName} — this bill is closed`);
    } else {
      patch({ resume: { ...source, table_label: source.table_label ?? label } });
      toast.success(`Moved to ${targetName}`);
    }
    void loadTableBills(source.table_id ?? target.table_id);
  }, [loadOrder, patch, loadTableBills]);

  const saveBillDetails = async (details: { label: string; guests: number | null }) => {
    const d = getDraft();
    if (!d.resume) {
      patch({ billLabel: details.label, guests: details.guests });
      setSheet(null);
      return;
    }
    if (!online) { toast.error('Changing a running bill needs an internet connection'); return; }
    try {
      const updated = await floorApi.setDetails(d.resume.id, { bill_label: details.label || null, guests: details.guests });
      onResumeChange(updated, 'Bill updated');
      setSheet(null);
      void loadTableBills(updated.table_id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const mergeInto = async (sourceId: string) => {
    const d = getDraft();
    if (!d.resume) return;
    try {
      const updated = await floorApi.merge(d.resume.id, sourceId);
      onResumeChange(updated, 'Bills merged');
      setSheet(null);
      void loadTableBills(updated.table_id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  /** Running bill options, in a menu anchored to the bill's "⋯" button. */
  const billMenu: ActionMenuItem[] = (() => {
    const r = draft.resume;
    const acts: ActionMenuItem[] = [{ key: 'details', label: r ? 'Bill name & guests' : 'Name this bill', icon: 'create-outline', onPress: () => setSheet('billDetails'),
      disabled: !!r && !online, disabledReason: 'Needs internet' }];
    if (r && r.table_id) {
      const others = tableBills.filter((b) => b.id !== r.id);
      acts.push({ key: 'merge', label: 'Merge another bill into this one', icon: 'git-merge-outline', onPress: () => setSheet('merge'),
        disabled: !online || !others.length || itemsLocked(r), description: 'Tables joined, one person pays',
        disabledReason: !online ? 'Needs internet' : !others.length ? 'No other bill on this table' : 'This bill has a payment' });
      acts.push({ key: 'separate', label: 'Start a separate bill on this table', icon: 'add-circle-outline',
        onPress: () => startSeparateBill(r.table_id!, r.table_label ?? draft.tableLabel ?? ''),
        disabled: !online, description: 'Another party at the same table', disabledReason: 'Needs internet' });
    }
    return acts;
  })();

  const exitResume = useCallback(async () => {
    if (hasUnsaved() && !(await confirm({ title: 'Leave this running bill?', message: 'New items you added but did not send will be removed.', confirmLabel: 'Leave', danger: true }))) return;
    resetCart({ orderType: defaultType });
  }, [resetCart, defaultType]);

  // A running bill restored from storage may be stale (paid / changed on another device): refresh it once
  const resumeId = draft.resume?.id ?? null;
  const refreshedResume = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated || !resumeId || !online || refreshedResume.current === resumeId) return;
    refreshedResume.current = resumeId;
    ordersApi.get(resumeId)
      .then((fresh) => {
        const current = getDraft().resume;
        if (!current || current.id !== fresh.id) return;
        if (fresh.status === 'completed' || fresh.status === 'cancelled' || fresh.status === 'merged') {
          toast.info(fresh.status === 'merged' ? (fresh.cancel_reason ?? 'This bill was merged into another one')
            : `Bill ${fresh.invoice_no ?? fresh.code} was ${fresh.status === 'completed' ? 'already paid' : 'cancelled'}`);
          resetCart({ orderType: defaultType });
        } else {
          patch({ resume: { ...fresh, table_label: fresh.table_label ?? current.table_label } });
        }
      })
      .catch(() => { /* keep the cached copy */ });
  }, [hydrated, resumeId, online, patch, resetCart, defaultType]);

  // ------------------------------------------------------------------ deep links: /pos?table= | ?order= | ?channel=

  const params = useLocalSearchParams<{ table?: string; order?: string; channel?: string; bill?: string }>();
  const handledLink = useRef<string>('');
  useEffect(() => {
    if (!hydrated || !tenantId) return;
    const key = `${params.table ?? ''}|${params.order ?? ''}|${params.channel ?? ''}|${params.bill ?? ''}`;
    if (key === '|||' || key === handledLink.current) return;
    handledLink.current = key;
    const clear = () => { try { router.setParams({ table: undefined, order: undefined, channel: undefined, bill: undefined } as any); } catch { /* ignore */ } };
    void (async () => {
      if (params.channel) {
        const code = String(params.channel).toUpperCase() as ChannelCode;
        const ch = useData.getState().channels.find((c) => c.code === code);
        if (ch && (ch.enabled || code === 'POS')) {
          patch({ channel: code, ...(isAggregator(code) && !isRetail ? { orderType: 'DELIVERY' as OrderType } : {}) });
        } else toast.warning(`${code} orders are turned off in Settings`);
      }
      if (params.order) await openOrder(String(params.order));
      else if (params.table) {
        const id = String(params.table);
        let table: TableInfo | undefined = useData.getState().tables.find((t) => t.id === id);
        if (online) {
          try { table = (await tablesApi.list()).find((t) => t.id === id) ?? table; } catch { /* use cache */ }
        }
        const busy = !!table && (table.current_order || (table.open_bills?.length ?? 0) > 0);
        if (!table) toast.error('That table was not found');
        else if (busy && params.bill === 'new') startSeparateBill(table.id, table.table_number);
        else if (busy) await chooseBill(table);
        else {
          if (getDraft().resume) resetCart({ orderType: 'DINE_IN' });
          patch({ orderType: 'DINE_IN', tableId: table.id, tableLabel: table.table_number, newBill: false });
        }
      }
      clear();
    })();
  }, [hydrated, tenantId, params.table, params.order, params.channel, params.bill, online, openOrder, patch, resetCart, isRetail, chooseBill, startSeparateBill]);

  // ------------------------------------------------------------------ cart actions

  const onOrderType = (t: OrderType) => {
    patch({ orderType: t, ...(t !== 'DINE_IN' ? { tableId: null, tableLabel: null } : {}) });
    if (t === 'DINE_IN' && !draft.tableId) setSheet('table');
  };

  const onClear = async () => {
    if (!draft.lines.length) return;
    if (!(await confirm({ title: draft.resume ? 'Remove the new items?' : 'Clear this bill?', message: `${priced.newCount} item(s) will be removed.`, confirmLabel: 'Clear', danger: true }))) return;
    if (draft.resume) patch({ lines: [] });
    else resetCart({ orderType: draft.orderType ?? defaultType, channel: draft.channel });
  };

  /** New bills keep the customer locally; a running bill saves it on the server right away. */
  const pickCustomer = async (c: AttachedCustomer | null) => {
    const order = getDraft().resume;
    if (!order) { patch({ customer: c, redeemPoints: 0 }); setSheet(null); return; }
    if (!online) { toast.error('Changing the customer on a running bill needs an internet connection'); return; }
    try {
      const updated = await ordersApi.setCustomer(order.id, { customer_id: c?.id ?? null, customer_name: c?.name ?? null, customer_phone: c?.phone ?? null });
      patch({ resume: { ...updated, table_label: updated.table_label ?? order.table_label }, customer: c, redeemPoints: 0 });
      setSheet(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  /** Web: the cursor goes back to search, ready for the next item or scan (not on phones: no surprise keyboard). */
  const focusSearch = (fromKey = false) => {
    if (Platform.OS !== 'web' || (isPhone && !fromKey)) return;
    const run = () => {
      const el = searchRef.current as unknown as HTMLInputElement | null;
      el?.focus?.();
      if (fromKey) el?.select?.();
    };
    if (fromKey) run();
    else setTimeout(run, 320); // after a closing sheet has handed focus back
  };

  /** Ready for the next customer: empty bill, same order type, cursor in search. */
  const afterBill = (keepType: OrderType | null) => {
    resetCart({ orderType: keepType ?? defaultType });
    setCartOpen(false);
    setQuery('');
    focusSearch();
  };

  // The last paid bill's card goes away as soon as the next bill starts
  useEffect(() => {
    if (draft.lines.length || draft.resume) setLastBill(null);
  }, [draft.lines.length, draft.resume]);

  const printKotSafe = async (order: Order, items?: OrderItem[]) => {
    if (!usePrefs.getState().autoPrintKot) return;
    const kitchenItems = (items ?? order.items).filter((i) => i.sent_to_kitchen);
    if (!kitchenItems.length) return;
    try { await printKitchenTicket(kotFromOrder({ ...order, items: kitchenItems })); } catch (e) { toast.error(printErrorMessage(e)); }
  };

  const itemsInput = () => getDraft().lines.map((l) => ({ product_id: l.productId, variant_id: l.variantId, quantity: l.quantity, notes: l.notes }));

  const ensureId = (): string => {
    const d = getDraft();
    if (d.draftId) return d.draftId;
    const id = uuid();
    patch({ draftId: id });
    return id;
  };

  const sendKot = async () => {
    if (lock.current) return;
    const d = getDraft();
    const err = validateDraft(d, priced, { requireLines: true });
    if (err) { toast.warning(err); return; }
    lock.current = true;
    setSubmitting('kot');
    try {
      if (d.resume) {
        if (!online) { toast.error('Adding items to a running bill needs an internet connection'); return; }
        const before = new Set(d.resume.items.map((i) => i.id));
        const order = await ordersApi.addItems(d.resume.id, itemsInput(), true);
        const added = order.items.filter((i) => !before.has(i.id));
        void printKotSafe({ ...order, table_label: order.table_label ?? d.resume.table_label }, added); // printing never holds the till
        toast.success(`${added.reduce((s, i) => s + i.quantity, 0)} item(s) added${d.resume.table_label ? ` to Table ${d.resume.table_label}` : ''}`);
        afterBill(d.orderType);
        return;
      }
      if (d.orderType === 'DINE_IN' && !online) { toast.error('Tables need an internet connection. Bill it as Takeaway, or take payment now.'); return; }
      const id = ensureId();
      const createdAt = new Date().toISOString();
      try {
        const order = await ordersApi.create(buildCreatePayload(d, { id, createdAt, sendToKitchen: true, offerId: offerForNewBill() }));
        void printKotSafe({ ...order, table_label: order.table_label ?? d.tableLabel });
        const where = d.tableLabel && d.orderType === 'DINE_IN' ? `Table ${d.tableLabel}` : order.token_no ? `Token #${order.token_no}` : order.code;
        toast.success(isRetail ? `Bill held · ${where}` : `KOT sent · ${where}`);
        afterBill(d.orderType);
      } catch (e) {
        if (tableBusy(e) && d.tableId) {
          toast.warning(errorMessage(e));
          await chooseBill({ id: d.tableId, table_number: d.tableLabel ?? '', open_bills: [], current_order: null });
          return;
        }
        const why = saveOnDevice(e);
        if (!why) throw e;
        const payload = buildCreatePayload(d, { id, createdAt, sendToKitchen: true, offline: true });
        const plain = pricedPlain();
        queueOffline(payload, d.orderType, plain);
        void printKotSafe(buildLocalOrder(payload, plain, d, 0));
        toast.warning(why === 'lapsed'
          ? 'Your Tallyko plan has ended. This bill is saved on this device and reaches the server after you renew.'
          : applied
            ? 'Saved offline without the offer — it reaches the kitchen screen when you are back online'
            : 'Saved offline — it reaches the kitchen screen when you are back online');
        afterBill(d.orderType);
      }
    } catch (e) {
      toast.error(errorMessage(e));
      if (offerError(e)) offers.refresh();
    } finally {
      lock.current = false;
      setSubmitting(null);
    }
  };

  /** Offer to send with a new bill: exactly the one in the preview (none offline or without permission). */
  const offerForNewBill = (): string | null => (canApplyOffers && online && applied && !applied.fromOrder ? applied.id : null);
  const offerError = (e: unknown) => e instanceof ApiError && e.status === 400 && /offer/i.test(e.message);

  const queueOffline = (payload: ReturnType<typeof buildCreatePayload>, type: OrderType | null, p: PricedDraft = priced) => {
    if (!tenantId) return;
    const d = getDraft();
    useOutbox.getState().enqueue({
      id: payload.id!, tenantId, payload,
      preview: {
        total: p.preview.total, itemCount: p.itemCount,
        label: `${ORDER_TYPE_LABEL[type ?? 'TAKEAWAY']}${d.tableLabel && type === 'DINE_IN' ? ` · Table ${d.tableLabel}` : ''}${d.customer?.name ? ` · ${d.customer.name}` : ''}`,
      },
      createdAt: payload.created_at!,
    });
  };

  const openPay = async () => {
    if (!canBill) { toast.warning('Only cashiers and managers can take payment'); return; }
    if (lock.current) return;
    const d = getDraft();
    const err = validateDraft(d, priced, { requireLines: !d.resume });
    if (err) { toast.warning(err); return; }
    if (d.resume && !online) { toast.error('Paying a running bill needs an internet connection'); return; }
    if (offers.pending) {
      // Let the offer check for the latest cart finish (briefly) so the amount due is final
      lock.current = true;
      setSubmitting('pay');
      try { await offers.flush(); } finally { lock.current = false; setSubmitting(null); }
    }
    setSheet('pay');
  };

  const chooseOffer = (c: { mode: 'auto' | 'manual' | 'none'; offerId?: string | null; name?: string | null; code?: string | null }) => {
    const manual = c.mode === 'manual' && !!c.offerId;
    patch({
      offerMode: manual ? 'manual' : c.mode === 'manual' ? 'auto' : c.mode,
      offerId: manual ? c.offerId! : null, offerName: manual ? c.name ?? null : null, offerCode: manual ? c.code ?? null : null,
    });
    setSheet(null);
  };

  /** Paid: the till is ready for the next customer at once; the bill (change, print, share) waits in the new bill. */
  const showReceipt = (order: Order, offline: boolean, change: number, type: OrderType | null) => {
    setSheet(null);
    setLastBill({ order, offline, change });
    setReceiptOpen(false);
    afterBill(type);
    focusSearch();
    if (usePrefs.getState().autoPrintReceipt) {
      printBill(order, settings, { offline, change }).catch((e) => toast.error(printErrorMessage(e)));
    }
  };

  const confirmPay = async (payments: PaymentInput[], change: number) => {
    if (lock.current) return;
    lock.current = true;
    setSubmitting('pay');
    const d = getDraft();
    try {
      if (d.resume) {
        let order = d.resume;
        if (d.lines.length) {
          const before = new Set(order.items.map((i) => i.id));
          order = { ...(await ordersApi.addItems(order.id, itemsInput(), true)), table_label: order.table_label };
          patch({ resume: order, lines: [] }); // items are saved even if the payment below fails
          void printKotSafe(order, order.items.filter((i) => !before.has(i.id)));
        }
        const body: Parameters<typeof offersApi.payWithOffer>[1] = { payments };
        if (d.discount && d.discount.value > 0) body.discount = d.discount;
        if (d.redeemPoints) body.redeem_points = d.redeemPoints;
        // Offer changed by the cashier (or a better auto offer now fits): apply it with the payment
        if (canApplyOffers && offers.data && !offers.locked && !order.paid_amount) {
          const want = applied?.id ?? null;
          if (want !== (order.offer_id ?? null)) {
            if (want) body.offer_id = want;
            else body.remove_offer = true;
            // The server re-prices from scratch when the offer changes: carry over the bill's own discount and points
            const points = order.loyalty_points_redeemed || 0;
            if (!body.discount) {
              const manual = round2(order.discount_amount - (order.offer_discount ?? 0) - points * (settings?.loyalty_point_value ?? 0));
              if (manual > 0) body.discount = { type: 'flat', value: manual };
            }
            if (body.redeem_points == null && points) body.redeem_points = points;
          }
        }
        const paid = await offersApi.payWithOffer(order.id, body);
        const result = { ...paid, table_label: paid.table_label ?? order.table_label };
        if (paid.payment_status !== 'paid') {
          patch({ resume: result, discount: null, redeemPoints: 0 });
          setSheet(null);
          toast.warning(`${money(paid.balance_due, currency)} still due on this bill`);
          return;
        }
        showReceipt(result, false, paid.change ?? change, d.orderType);
        return;
      }

      const id = ensureId();
      const createdAt = new Date().toISOString();
      try {
        const order = await ordersApi.create(buildCreatePayload(d, { id, createdAt, payments, sendToKitchen: true, offerId: offerForNewBill() }));
        void printKotSafe({ ...order, table_label: order.table_label ?? d.tableLabel });
        const result = { ...order, table_label: order.table_label ?? (d.orderType === 'DINE_IN' ? d.tableLabel : null) };
        if (order.payment_status !== 'paid') {
          // Server total differed from the preview (e.g. a price changed) — keep it open so nothing is lost
          loadOrder(result);
          setSheet(null);
          toast.warning(`Prices changed — ${money(order.balance_due, currency)} still due. Collect the rest to close the bill.`);
          return;
        }
        const tendered = payments.reduce((s, p) => s + p.amount, 0);
        const serverChange = payments.some((p) => p.method === 'CASH') ? Math.max(0, round2(tendered - order.total_amount)) : 0;
        showReceipt(result, false, serverChange, d.orderType);
      } catch (e) {
        if (tableBusy(e) && d.tableId) {
          setSheet(null);
          toast.warning(errorMessage(e));
          await chooseBill({ id: d.tableId, table_number: d.tableLabel ?? '', open_bills: [], current_order: null });
          return;
        }
        const why = saveOnDevice(e);
        if (!why) throw e;
        if (priced.offerDiscount > 0) {
          // The amount collected included the offer, but offers can't be used offline: re-price before taking money
          // same bill id: if the server did get the first attempt, the offline copy replays as that bill (no duplicate)
          patch({ offerMode: 'none', offerId: null, offerName: null, offerCode: null, draftId: id });
          setSheet(null);
          toast.warning(`${why === 'lapsed' ? 'Your Tallyko plan has ended.' : 'Internet connection lost.'} Offers can't be used on bills saved on this device, so the bill is now ${money(pricedPlain().preview.total, currency)}. Take payment again.`);
          return;
        }
        const payload = buildCreatePayload(d, { id, createdAt, payments, sendToKitchen: true, offline: true });
        queueOffline(payload, d.orderType);
        if (why === 'lapsed') toast.warning('Your Tallyko plan has ended. This bill is saved on this device and reaches the server after you renew.');
        const local = buildLocalOrder(payload, priced, d, change);
        void printKotSafe(local);
        showReceipt(local, true, change, d.orderType);
      }
    } catch (e) {
      toast.error(errorMessage(e));
      if (offerError(e)) { offers.refresh(); setSheet(null); }
    } finally {
      lock.current = false;
      setSubmitting(null);
    }
  };

  // Loyalty redemption (online, loyalty on, a saved customer with points)
  const loyalty: LoyaltyOption | null = useMemo(() => {
    if (!settings?.loyalty_enabled || !online || !draft.customer?.id || customerPoints <= 0 || !settings.loyalty_point_value) return null;
    const base = priceDraft({ ...draft, redeemPoints: 0 }, productsById, settings, adjustPct, { tax, offer: previewOffer }).preview;
    const room = Math.max(0, base.subtotal - base.discount);
    return {
      available: customerPoints, pointValue: settings.loyalty_point_value, points: draft.redeemPoints,
      max: Math.min(customerPoints, Math.floor(room / settings.loyalty_point_value)),
      onChange: (n: number) => patch({ redeemPoints: n }),
    };
  }, [settings, online, draft, customerPoints, productsById, adjustPct, patch, tax, previewOffer]);

  const cartOffers: CartOfferInfo | null = (canApplyOffers || applied) && priced.itemCount > 0 ? {
    applied,
    eligibleCount: offers.eligible.filter((e) => e.offer_id !== applied?.id).length,
    pending: offers.pending,
    problem: offers.problem,
    locked: offers.locked || !canApplyOffers,
    online,
    freeItemName: applied?.freeProductId ? productsById.get(applied.freeProductId)?.name ?? 'Free item' : null,
    code: draft.offerMode === 'manual' ? draft.offerCode : null,
  } : null;
  const offerNote = applied ? `Includes offer: ${applied.name}${priced.offerDiscount > 0 ? ` (−${money(priced.offerDiscount, currency)})` : ''}` : null;

  // ------------------------------------------------------------------ keyboard (web / desktop)

  const anySheet = sheet !== null || !!variantProduct || receiptOpen || !!billChoice;
  const keysOn = Platform.OS === 'web' && !anySheet;
  const kotRef = useRef(sendKot);
  const payRef = useRef(openPay);
  kotRef.current = sendKot;
  payRef.current = openPay;

  useHotkeys({
    'F2|/': () => { if (cartOpen) return false; focusSearch(true); return undefined; },
    F9: () => { void kotRef.current(); },
    'F8|Ctrl+Enter': () => { void payRef.current(); },
    '+': () => { if (!getDraft().lines.length) return false; bumpLast(1); return undefined; },
    '-': () => { if (!getDraft().lines.length) return false; bumpLast(-1); return undefined; },
    Escape: () => {
      if (cartOpen) { setCartOpen(false); return undefined; }
      if (query) { setQuery(''); return undefined; }
      if (lastBill && !getDraft().lines.length) { setLastBill(null); return undefined; }
      return false;
    },
  }, [], { enabled: keysOn });

  // Type anywhere: a letter or digit typed outside a text field (people, or a USB / Bluetooth barcode scanner)
  // moves focus to search before the key lands, so the browser types it there and the scanner's Enter submits it.
  useEffect(() => {
    if (!keysOn || cartOpen || typeof document === 'undefined') return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (e.key.length !== 1 || !/^[0-9A-Za-z.]$/.test(e.key) || isTypingTarget(e.target)) return;
      const input = searchRef.current as unknown as HTMLInputElement | null;
      if (!input?.focus) return;
      input.focus();
      input.select?.(); // a new search replaces the old one
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [keysOn, cartOpen]);

  // ------------------------------------------------------------------ render

  const emptyMenu = !lastSyncedAt && allProducts.length === 0 ? (
    <Loading label="Loading your menu…" />
  ) : (
    <EmptyState icon="fast-food-outline" title="Your menu is empty"
      message={canManage
        ? 'Add your items with prices to start billing. You can type them in, or snap a photo of your printed menu and Tallyko will read the items and prices for you.'
        : 'Ask the owner or a manager to add items in Menu & items, then they will show up here.'}
      action={canManage ? { label: 'Add menu items', icon: 'add-circle-outline', onPress: () => router.navigate('/menu') } : undefined} />
  );

  const headerActions = (dense: boolean) => (!isRetail || draft.resume ? (
    dense
      ? <IconButton icon="time-outline" accessibilityLabel="Running bills" variant="secondary" onPress={() => setSheet('running')} />
      : <Button title="Running" icon="time-outline" variant="secondary" onPress={() => setSheet('running')} />
  ) : null);

  const lastBillCard = lastBill && !draft.resume ? (
    <LastBillCard receipt={lastBill} settings={settings} onView={() => setReceiptOpen(true)} onDismiss={() => setLastBill(null)} />
  ) : null;

  const cartPanel = (inSheet: boolean) => (
    <CartPanel
      draft={draft} priced={priced} settings={settings} currency={currency} isRetail={isRetail} canBill={canBill} canManage={canManage}
      showChannel={showChannel} submitting={submitting} inSheet={inSheet}
      onOrderType={onOrderType} onPickTable={() => setSheet('table')} onPickChannel={() => setSheet('channel')}
      onPickCustomer={() => setSheet('customer')} onDiscount={() => setSheet('discount')} onClear={() => void onClear()}
      onExitResume={() => void exitResume()} onKot={() => void sendKot()} onPay={() => void openPay()}
      offers={cartOffers} onOffers={() => setSheet('offer')}
      online={online} bills={tableBills} onResumeChange={onResumeChange} onMoved={onMoved} onSwitchBill={switchBill}
      onSeparateBill={() => { if (draft.tableId) startSeparateBill(draft.tableId, draft.tableLabel ?? ''); }}
      onBillMenu={() => setSheet('billDetails')} billMenu={billMenu}
      lastBill={inSheet ? null : lastBillCard}
      onClaimChanged={(o) => {
        // UPI confirmed and the bill is settled: show the receipt like any paid bill
        if (o.payment_status === 'paid' || o.status === 'completed') showReceipt(o, false, 0, getDraft().orderType);
        else onResumeChange(o);
      }}
    />
  );

  const cartWidth = cartWidthFor(bodyWidth || width);
  const hasNew = priced.lines.length > 0;
  const bottomBar = isPhone && (priced.itemCount > 0 || !!draft.resume);
  const barDue = priced.paid > 0 ? priced.due : priced.preview.total;
  const runningLabel = draft.resume
    ? draft.resume.table_label
      ? `Table ${draft.resume.table_label}${tableBills.length > 1 || draft.resume.bill_label ? ` · ${billName(draft.resume, Math.max(0, tableBills.findIndex((b) => b.id === draft.resume!.id)))}` : ''}`
      : 'Running bill'
    : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: isPhone ? insets.top : 0 }]}>
      <OfflineBanner />
      <View style={styles.body} onLayout={(e) => setBodyWidth(e.nativeEvent.layout.width)}>
        <ProductBrowser
          products={products} categories={categories} query={query} onQueryChange={setQuery}
          onSubmitSearch={(t, h) => void submitSearch(t, h)}
          onPick={pick} onDecrement={decrement} inCart={inCart} currency={currency} adjustPct={adjustPct} channel={draft.channel} searchRef={searchRef}
          onScan={() => { setLastScanned(null); setSheet('scan'); }}
          autoFocusSearch={Platform.OS === 'web' && !isPhone} compact={isPhone} actions={headerActions} emptyMenu={emptyMenu}
          view={view} onViewChange={(v) => setPosPrefs({ view: v })} keyboard={keysOn && !cartOpen}
          bottomInset={bottomBar ? 84 : lastBill && isPhone ? 150 : 0}
          header={isPhone && draft.resume ? (
            <Pressable onPress={() => setCartOpen(true)} style={[styles.phoneResume, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="receipt" size={16} color={colors.primary} />
              <Text variant="smallStrong" color={colors.primarySoftText} numberOfLines={1} style={{ flex: 1 }}>
                {runningLabel} · {money(draft.resume.total_amount, currency)}
              </Text>
              <Pressable onPress={() => void exitResume()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Exit running bill">
                <Ionicons name="close" size={18} color={colors.primarySoftText} />
              </Pressable>
            </Pressable>
          ) : undefined}
        />
        {!isPhone ? (
          <View style={[styles.cart, { width: cartWidth, borderLeftColor: colors.border }, shadow(1)]}>{cartPanel(false)}</View>
        ) : null}
      </View>

      {/* Phone: the bill as a sticky bar in thumb reach — KOT and Pay one tap away, the rest of the bill a tap on the left */}
      {bottomBar ? (
        <View style={[styles.barWrap, { bottom: 10 }]} pointerEvents="box-none">
          <View style={[styles.bar, shadow(3), { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg }]}>
            <Pressable onPress={() => setCartOpen(true)} accessibilityRole="button" testID="pos-cart-bar"
              accessibilityLabel={`${priced.itemCount} items, ${money(barDue, currency)}. Open the bill`}
              style={({ pressed }) => [styles.barMain, { borderRadius: radius.md, backgroundColor: pressed ? colors.surfaceSunken : 'transparent' }]}>
              <View style={[styles.barCount, { backgroundColor: colors.primary }]}>
                <Text variant="smallStrong" color={colors.primaryText} style={styles.num}>{priced.itemCount}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodyStrong" numberOfLines={1} style={styles.num}>{money(barDue, currency, Math.abs(barDue % 1) < 0.005)}</Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {runningLabel ?? (draft.tableLabel ? `Table ${draft.tableLabel}` : 'View bill')}
                </Text>
              </View>
            </Pressable>
            {!isRetail && hasNew ? (
              <Button title="KOT" icon="flame" variant="kitchen" badge={priced.newCount} onPress={() => void sendKot()}
                loading={submitting === 'kot'} disabled={submitting !== null} accessibilityLabel={`Send ${priced.newCount} to the kitchen`} testID="pos-bar-kot" />
            ) : null}
            {canBill ? (
              <Button title="Pay" icon="card" variant="success" onPress={() => void openPay()} loading={submitting === 'pay'}
                disabled={(!hasNew && !draft.resume) || submitting !== null} accessibilityLabel={`Pay ${money(barDue, currency)}`} testID="pos-bar-pay" />
            ) : null}
          </View>
        </View>
      ) : isPhone && lastBillCard ? (
        <View style={[styles.barWrap, { bottom: 10 }]} pointerEvents="box-none">
          <View style={[shadow(3), { borderRadius: radius.lg, backgroundColor: colors.surface }]}>{lastBillCard}</View>
        </View>
      ) : null}

      {isPhone ? (
        <Sheet visible={cartOpen} onClose={() => setCartOpen(false)} title={draft.resume ? 'Running bill' : 'Current bill'} scroll={false} width={560}>
          <View style={{ height: Math.max(360, height * 0.78), marginHorizontal: -20, marginVertical: -20 }}>{cartPanel(true)}</View>
        </Sheet>
      ) : null}

      <VariantSheet product={variantProduct} onClose={() => setVariantProduct(null)} onPick={onVariant} currency={currency} adjustPct={adjustPct} channel={draft.channel} />
      <TableSheet visible={sheet === 'table'} onClose={() => setSheet(null)} selectedId={draft.tableId} online={online} currency={currency}
        onPick={(t) => { patch({ orderType: 'DINE_IN', tableId: t.id, tableLabel: t.table_number, newBill: false, billLabel: '', guests: null }); setSheet(null); }}
        onOpenRunning={(t) => {
          if (!online) { toast.error('Busy tables need an internet connection to add to their bill'); return; }
          void chooseBill(t);
        }} />
      <TableBillsSheet visible={!!billChoice} onClose={() => setBillChoice(null)} tableLabel={billChoice?.tableLabel ?? ''} bills={billChoice?.bills ?? []}
        newItems={priced.newCount} currency={currency} online={online}
        onAddTo={(id) => { setBillChoice(null); void openOrder(id, { keepLines: true }); }}
        onSeparate={(details) => { if (billChoice) startSeparateBill(billChoice.tableId, billChoice.tableLabel, details); }} />
      <BillDetailsSheet visible={sheet === 'billDetails'} onClose={() => setSheet(null)}
        title={draft.resume ? 'Bill name & guests' : 'Separate bill'}
        label={draft.resume ? draft.resume.bill_label ?? '' : draft.billLabel} guests={draft.resume ? draft.resume.guests ?? null : draft.guests}
        placeholder={`e.g. Rahul, or Bill ${Math.max(1, (draft.resume ? tableBills.findIndex((b) => b.id === draft.resume!.id) : tableBills.length) + 1)}`}
        onSave={saveBillDetails} />
      <MergeBillsSheet visible={sheet === 'merge'} onClose={() => setSheet(null)} current={draft.resume}
        currentName={draft.resume ? billName(draft.resume, Math.max(0, tableBills.findIndex((b) => b.id === draft.resume!.id))) : ''}
        bills={tableBills} currency={currency} online={online} onMerge={mergeInto} />
      <ChannelSheet visible={sheet === 'channel'} onClose={() => setSheet(null)} value={draft.channel} channels={channels}
        onPick={(c) => { patch({ channel: c, externalOrderId: c === draft.channel ? draft.externalOrderId : '', ...(isAggregator(c) && !isRetail && draft.orderType === 'DINE_IN' ? { orderType: 'DELIVERY' as OrderType, tableId: null, tableLabel: null } : {}) }); setSheet(null); }} />
      <CustomerSheet visible={sheet === 'customer'} onClose={() => setSheet(null)} value={draft.customer} online={online}
        onPick={(c) => void pickCustomer(c)} />
      <DiscountSheet visible={sheet === 'discount'} onClose={() => setSheet(null)} value={draft.discount} currency={currency}
        subtotal={priced.preview.subtotal} onApply={(dsc) => { patch({ discount: dsc }); setSheet(null); }} />
      <RunningOrdersSheet visible={sheet === 'running'} onClose={() => setSheet(null)} online={online} currency={currency} onOpen={(o) => void openOrder(o.id)} />
      <ScannerSheet visible={sheet === 'scan'} onClose={() => setSheet(null)} onCode={(c) => void onCameraCode(c)} lastAdded={lastScanned} />
      <PaymentSheet visible={sheet === 'pay'} onClose={() => { setSheet(null); focusSearch(); }} due={priced.due} currency={currency} settings={settings}
        hasCustomer={!!draft.customer?.phone || !!draft.customer?.id} aggregator={isAggregator(draft.channel)} loyalty={loyalty}
        submitting={submitting === 'pay'} onConfirm={(p, c) => void confirmPay(p, c)} offerNote={offerNote}
        title={draft.resume?.table_label ? `Collect payment · Table ${draft.resume.table_label}` : undefined} />
      <OfferSheet visible={sheet === 'offer'} onClose={() => setSheet(null)} offers={offers} mode={draft.offerMode} offerId={draft.offerId}
        code={draft.offerCode} online={online} currency={currency} onChoose={chooseOffer} />
      <ReceiptSheet receipt={receiptOpen ? lastBill : null} settings={settings} onNewBill={() => {
        setReceiptOpen(false);
        focusSearch();
      }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, flexDirection: 'row', minHeight: 0 },
  cart: { borderLeftWidth: 1 },
  barWrap: { position: 'absolute', left: 10, right: 10 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6, minHeight: 64, borderWidth: 1 },
  barMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, minHeight: 52 },
  barCount: { minWidth: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  phoneResume: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  num: { fontVariant: ['tabular-nums'] },
});
