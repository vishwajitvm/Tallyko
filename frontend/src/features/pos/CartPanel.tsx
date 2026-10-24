/**
 * The bill being rung up: order type / running bill header, the lines, and a footer that always shows
 * Total, KOT and Pay (docs/20_High_Volume_UX.md §3). The tax breakdown folds into one summary line.
 * The header and lines scroll as one when the panel is short; the footer never scrolls away.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BusinessSettings, Order, OrderType } from '@/api/types';
import { ActionMenu, Badge, Button, Chip, IconButton, Segmented, Text, prompt, type ActionMenuItem } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts } from '@/theme/tokens';
import { CHANNEL_LABEL, money } from '@/lib/format';
import { useCart, type Draft } from './cart';
import { BillTabs } from './BillSheets';
import { PaymentClaimBanner } from '../ops/PaymentClaim';
import { ItemSelectionBar, RunningItems } from './RunningBill';
import { billName, pruneSelection, selectableItems } from './runningBill';
import type { AppliedOffer } from './offers';
import { isAggregator, type PricedDraft, type PricedLine } from './totals';
import { Avatar } from './sheets';
import { usePosPrefs } from './posPrefs';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const QUICK_NOTES_FOOD = ['Less spicy', 'Extra spicy', 'No onion', 'Jain', 'Parcel'];
const QUICK_NOTES_RETAIL = ['Gift wrap', 'Exchange', 'Loose'];

/** What the cart shows about offers (hidden when the staff member can't apply offers). */
export interface CartOfferInfo {
  applied: AppliedOffer | null;
  /** Offers that fit the cart, other than the applied one. */
  eligibleCount: number;
  pending: boolean;
  problem: string | null;
  locked: boolean;
  online: boolean;
  /** Name of the free item the applied offer adds. */
  freeItemName: string | null;
  code: string | null;
}

export interface CartPanelProps {
  draft: Draft;
  priced: PricedDraft;
  settings: BusinessSettings | null;
  currency: string;
  isRetail: boolean;
  canBill: boolean;
  canManage: boolean;
  showChannel: boolean;
  submitting: 'kot' | 'pay' | null;
  onOrderType: (t: OrderType) => void;
  onPickTable: () => void;
  onPickChannel: () => void;
  onPickCustomer: () => void;
  onDiscount: () => void;
  onClear: () => void;
  onExitResume: () => void;
  onKot: () => void;
  onPay: () => void;
  offers?: CartOfferInfo | null;
  onOffers?: () => void;
  /** Rendered in a phone sheet (no outer border). */
  inSheet?: boolean;
  online: boolean;
  /** Open bills on this table, oldest first (the running bill among them). */
  bills: Order[];
  /** The running bill changed on the server (items cancelled, marked served, ...). */
  onResumeChange: (order: Order, message?: string) => void;
  /** Items moved to another bill (the source may have closed as merged). */
  onMoved: (result: { source: Order; target: Order }) => void;
  onSwitchBill: (orderId: string) => void;
  onSeparateBill: () => void;
  /** Name of a new separate bill (opens the bill details sheet). */
  onBillMenu: () => void;
  /** Running bill options (name, guests, merge, separate bill), shown in a menu anchored to "⋯". */
  billMenu: ActionMenuItem[];
  /** A customer's "paid by UPI" claim was confirmed or rejected. */
  onClaimChanged?: (order: Order) => void;
  /** The bill just paid (change to return, print, share): shown while the new bill is still empty. */
  lastBill?: React.ReactNode;
}

export function CartPanel(p: CartPanelProps) {
  const { draft, priced, currency, isRetail, canBill, showChannel, submitting, settings } = p;
  const { colors, radius } = useTheme();
  const patch = useCart((s) => s.patch);
  const lastLineId = useCart((s) => s.lastLineId);
  const totalsOpen = usePosPrefs((s) => s.totalsOpen);
  const setPrefs = usePosPrefs((s) => s.set);
  const scrollRef = useRef<ScrollView>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  // Key hints only where the buttons have room for them (the amount on Pay matters more)
  const [actionsWidth, setActionsWidth] = useState(0);
  const hints = actionsWidth >= 390;
  const resume = draft.resume;
  const orderType = draft.orderType ?? (isRetail ? 'RETAIL_WALKIN' : 'TAKEAWAY');
  const preview = priced.preview;
  const hasNew = priced.lines.length > 0;
  const lastIndex = priced.lines.findIndex((l) => l.line.id === lastLineId);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const bills = p.bills ?? [];
  const billLabel = draft.billLabel ?? '';
  const billIndex = resume ? bills.findIndex((b) => b.id === resume.id) : -1;
  const currentBillName = resume ? billName(resume, billIndex >= 0 ? billIndex : 0) : billLabel.trim() || `Bill ${bills.length + 1}`;
  const showTabs = resume ? !!resume.table_id && bills.length > 0 : orderType === 'DINE_IN' && !!draft.tableId && !!draft.newBill;

  // A different bill clears the selection; a refreshed bill keeps what is still there
  const resumeId = resume?.id ?? null;
  useEffect(() => { setSelected(new Set()); }, [resumeId]);
  const items = useMemo(() => resume?.items ?? [], [resume]);
  useEffect(() => { setSelected((s) => (s.size ? pruneSelection(items, s) : s)); }, [items]);
  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = (all: boolean) => setSelected(all ? new Set(selectableItems(items).map((i) => i.id)) : new Set());

  // Keep the most recently added line in view
  useEffect(() => {
    if (lastIndex >= 0 && lastIndex === priced.lines.length - 1) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 30);
  }, [lastIndex, priced.lines.length]);

  const typeOptions: { value: OrderType; label: string; icon: IconName }[] = isRetail
    ? [{ value: 'RETAIL_WALKIN', label: 'Walk-in', icon: 'walk-outline' }, { value: 'TAKEAWAY', label: 'Takeaway', icon: 'bag-handle-outline' }]
    : [
      { value: 'TAKEAWAY', label: 'Takeaway', icon: 'bag-handle-outline' },
      { value: 'DINE_IN', label: 'Dine-in', icon: 'restaurant-outline' },
      { value: 'DELIVERY', label: 'Delivery', icon: 'bicycle-outline' },
    ];

  const payBlocked = !canBill;
  const nothingToPay = !hasNew && !resume;
  const due = priced.paid > 0 ? priced.due : preview.total;
  const taxTotal = preview.taxBreakup.reduce((s, t) => s + t.cgst + t.sgst, 0);
  // Collapsed: one short line (items + tax); the full breakdown opens below it
  const summary = [
    `${priced.itemCount} item${priced.itemCount === 1 ? '' : 's'}`,
    taxTotal > 0 ? `GST ${money(taxTotal, currency)}${settings?.prices_include_tax ? ' incl.' : ''}` : null,
    preview.discount > 0 ? `−${money(preview.discount, currency)} off` : null,
  ].filter(Boolean).join(' · ');

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        {/* Header: order type / running bill */}
        <View style={[styles.header, { borderBottomColor: colors.divider }]}>
          {resume ? (
            <View style={[styles.resume, { backgroundColor: colors.primarySoft, borderRadius: radius.md }]}>
              <Ionicons name={resume.table_label ? 'grid' : 'receipt'} size={18} color={colors.primary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodyStrong" color={colors.primarySoftText} numberOfLines={1}>
                  {resume.table_label ? `Table ${resume.table_label}${bills.length > 1 || resume.bill_label ? ` · ${currentBillName}` : ''}` : `${resume.type === 'DELIVERY' ? 'Delivery' : resume.type === 'DINE_IN' ? 'Dine-in' : 'Takeaway'}${resume.token_no ? ` #${resume.token_no}` : ''}`} · {money(resume.total_amount, currency)}
                </Text>
                <Text variant="caption" color={colors.primarySoftText} numberOfLines={1}>
                  {[`Running bill #${resume.code}`, resume.guests ? `${resume.guests} guest${resume.guests === 1 ? '' : 's'}` : null, resume.customer_name, resume.channel !== 'POS' ? CHANNEL_LABEL[resume.channel] : null, resume.paid_amount ? `${money(resume.paid_amount, currency)} paid` : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <ActionMenu items={p.billMenu} title={resume.table_label ? `Table ${resume.table_label} · ${currentBillName}` : `Bill #${resume.code}`} align="end"
                trigger={(open) => <IconButton icon="ellipsis-horizontal" variant="secondary" accessibilityLabel="Bill options: name, guests, merge" onPress={open} testID="pos-bill-menu" />} />
              <IconButton icon="close" variant="secondary" accessibilityLabel="Leave this running bill" onPress={p.onExitResume} />
            </View>
          ) : (
            <View onLayout={(e) => setNarrow(e.nativeEvent.layout.width < 340)}>
              <Segmented size="sm" value={orderType} onChange={p.onOrderType} options={narrow ? typeOptions.map(({ icon: _icon, ...o }) => o) : typeOptions} />
            </View>
          )}

          {resume ? <PaymentClaimBanner order={resume} currency={currency} compact onChanged={(o) => (p.onClaimChanged ?? p.onResumeChange)(o)} /> : null}

          {showTabs ? (
            <View style={styles.tabRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <BillTabs bills={bills} currentId={resume?.id ?? null} newBill={!resume && draft.newBill} newLabel={billLabel} currency={currency}
                  onSwitch={p.onSwitchBill} onSeparate={p.onSeparateBill} disabled={!p.online || submitting !== null} />
              </View>
              {resume ? <CustomerButton customer={draft.customer} onPress={p.onPickCustomer} /> : null}
            </View>
          ) : null}

          {resume && showTabs ? null : (
          <View style={styles.pillBar}>
            <View style={styles.pills}>
              {orderType === 'DINE_IN' && !resume ? (
                <Pill icon="grid-outline" label={draft.tableLabel ? `Table ${draft.tableLabel}` : 'Pick table'} onPress={p.onPickTable}
                  tone={draft.tableId ? 'active' : 'warn'} />
              ) : null}
              {orderType === 'DINE_IN' && !resume && draft.newBill && draft.tableId ? (
                <Pill icon="people-outline" label={currentBillName} sub={draft.guests ? `${draft.guests} guests · separate bill` : 'Separate bill'}
                  onPress={p.onBillMenu} tone="active" />
              ) : null}
              {showChannel && !resume ? (
                <Pill icon={draft.channel === 'POS' ? 'storefront-outline' : 'bicycle-outline'} label={CHANNEL_LABEL[draft.channel] ?? draft.channel}
                  onPress={p.onPickChannel} tone={draft.channel === 'POS' ? 'plain' : 'active'} />
              ) : null}
              <Pill icon={draft.customer ? undefined : 'person-add-outline'} label={draft.customer ? draft.customer.name : 'Customer'}
                sub={draft.customer ? `${draft.customer.phone}${draft.customer.points ? ` · ${draft.customer.points} pts` : ''}` : undefined}
                left={draft.customer ? <Avatar name={draft.customer.name} size={22} /> : undefined}
                badge={draft.customer?.tier ?? undefined}
                onPress={p.onPickCustomer} tone={draft.customer ? 'active' : orderType === 'DELIVERY' && !isAggregator(draft.channel) ? 'warn' : 'plain'} />
            </View>
            {hasNew ? (
              <Pressable onPress={p.onClear} accessibilityRole="button" accessibilityLabel="Clear cart" hitSlop={6}
                style={({ hovered }: any) => [styles.clear, { borderRadius: radius.sm, backgroundColor: hovered ? colors.dangerSoft : 'transparent' }]}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </Pressable>
            ) : null}
          </View>
          )}

          {isAggregator(draft.channel) && !resume ? (
            <InlineField icon="pricetag-outline" placeholder={`${CHANNEL_LABEL[draft.channel] ?? 'Aggregator'} order ID`} value={draft.externalOrderId}
              onChangeText={(t) => patch({ externalOrderId: t })} maxLength={64} />
          ) : null}
          {orderType === 'DELIVERY' && !resume ? (
            <InlineField icon="location-outline" placeholder="Delivery address" value={draft.deliveryAddress}
              onChangeText={(t) => patch({ deliveryAddress: t })} maxLength={500} multiline />
          ) : null}
        </View>

        {/* Lines: at least three rows tall; on a short panel everything above scrolls as one */}
        <ScrollView ref={scrollRef} style={{ flex: 1, minHeight: resume ? 200 : 168 }} contentContainerStyle={styles.lines}
          keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {resume && priced.existing.length ? (
            <View style={{ marginBottom: hasNew ? 10 : 0 }}>
              <RunningItems items={priced.existing} selected={selected} onToggle={toggle} onToggleAll={toggleAll} currency={currency} selectable />
              {hasNew ? (
                <View style={[styles.sectionHead, { marginTop: 10 }]}>
                  <Ionicons name="add-circle-outline" size={14} color={colors.primary} />
                  <Text variant="caption" tone="primary" style={{ textTransform: 'uppercase' }}>New items</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {!hasNew && !(resume && priced.existing.length) ? (
            <View style={styles.empty}>
              {p.lastBill ?? (
                <>
                  <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceSunken }]}>
                    <Ionicons name={isRetail ? 'barcode-outline' : 'fast-food-outline'} size={28} color={colors.textSubtle} />
                  </View>
                  <Text variant="h3" align="center">{resume ? 'Add more items' : 'New bill'}</Text>
                  <Text variant="small" tone="muted" align="center" style={{ maxWidth: 260 }}>
                    {isRetail ? 'Scan a barcode or tap items to add them.' : 'Tap items to add them. Tap a line to add a note.'}
                  </Text>
                </>
              )}
            </View>
          ) : null}

          {priced.lines.map((l) => (
            <LineRow key={l.line.id} pl={l} currency={currency} expanded={expanded === l.line.id} highlight={l.line.id === lastLineId}
              onToggle={() => setExpanded((e) => (e === l.line.id ? null : l.line.id))} quickNotes={isRetail ? QUICK_NOTES_RETAIL : QUICK_NOTES_FOOD} />
          ))}
        </ScrollView>
      </ScrollView>

      {/* Actions for ticked items: directly under the rows, above the totals */}
      {resume && selected.size ? (
        <ItemSelectionBar order={resume} selected={selected} online={p.online} currency={currency} bills={bills}
          onClear={() => setSelected(new Set())}
          onOrder={(o, message) => p.onResumeChange(o, message)}
          onMoved={(r) => { setSelected(new Set()); p.onMoved(r); }} />
      ) : null}

      {/* Totals + actions: always visible */}
      <View style={[styles.footer, { borderTopColor: colors.divider, backgroundColor: colors.surfaceAlt }]}>
        {priced.itemCount > 0 ? (
          <View style={styles.summaryRow}>
            <Pressable onPress={() => setPrefs({ totalsOpen: !totalsOpen })} accessibilityRole="button" accessibilityState={{ expanded: totalsOpen }}
              accessibilityLabel={`${summary}. ${totalsOpen ? 'Hide' : 'Show'} tax breakdown`} hitSlop={8} testID="pos-totals-toggle"
              style={({ hovered }: any) => [styles.summaryToggle, { borderRadius: radius.sm }, hovered && { backgroundColor: colors.surfaceSunken },
                Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
              <Ionicons name={totalsOpen ? 'chevron-down' : 'chevron-forward'} size={15} color={colors.textMuted} />
              <Text variant="small" tone="muted" numberOfLines={1} style={[styles.num, { flexShrink: 1 }]}>{totalsOpen ? 'Hide breakdown' : summary}</Text>
            </Pressable>
            {p.offers ? <OfferChip info={p.offers} currency={currency} discount={priced.offerDiscount} onPress={p.onOffers} /> : null}
            {canBill ? (
              <MiniChip icon="pricetag-outline" label={priced.manualDiscount > 0 ? `−${money(priced.manualDiscount, currency)}` : 'Discount'}
                tone={priced.manualDiscount > 0 ? 'success' : 'plain'} onPress={p.onDiscount}
                accessibilityLabel={priced.manualDiscount > 0 ? `${discountLabel(draft, priced.redeemValue, currency)} ${money(priced.manualDiscount, currency)}, change` : 'Add discount'} />
            ) : null}
          </View>
        ) : null}
        {priced.itemCount > 0 && totalsOpen ? (
          <View style={{ gap: 2 }}>
            <TotalRow label={`Subtotal · ${priced.itemCount} item${priced.itemCount === 1 ? '' : 's'}`} value={money(preview.subtotal, currency)} />
            {p.offers?.applied ? <OfferRow info={p.offers} currency={currency} discount={priced.offerDiscount} onPress={p.onOffers} /> : null}
            {priced.manualDiscount > 0 ? (
              <TotalRow label={discountLabel(draft, priced.redeemValue, currency)} value={`−${money(priced.manualDiscount, currency)}`} tone="success"
                onPress={canBill ? p.onDiscount : undefined} />
            ) : null}
            {preview.taxBreakup.filter((t) => t.rate > 0 && (t.cgst || t.sgst)).map((t) => (
              <React.Fragment key={t.rate}>
                <TotalRow label={`CGST ${t.rate / 2}%${settings?.prices_include_tax ? ' (incl.)' : ''}`} value={money(t.cgst, currency)} muted />
                <TotalRow label={`SGST ${t.rate / 2}%${settings?.prices_include_tax ? ' (incl.)' : ''}`} value={money(t.sgst, currency)} muted />
              </React.Fragment>
            ))}
            {preview.roundOff ? <TotalRow label="Round off" value={`${preview.roundOff > 0 ? '+' : '−'}${money(Math.abs(preview.roundOff), currency)}`} muted /> : null}
            {priced.paid > 0 ? <TotalRow label="Already paid" value={`−${money(priced.paid, currency)}`} muted /> : null}
          </View>
        ) : priced.paid > 0 ? (
          <TotalRow label="Already paid" value={`−${money(priced.paid, currency)}`} muted />
        ) : null}
        {p.offers?.problem && !p.offers.applied && !p.offers.locked && p.offers.online ? (
          <Text variant="caption" tone="warning" numberOfLines={2}>{p.offers.problem}</Text>
        ) : null}
        {p.offers?.applied && p.offers.freeItemName && !totalsOpen ? (
          <Text variant="caption" tone="success" numberOfLines={1}>
            + {p.offers.applied.freeQuantity > 1 ? `${p.offers.applied.freeQuantity} × ` : ''}{p.offers.freeItemName} free with {p.offers.applied.name}
          </Text>
        ) : null}
        <View style={styles.totalRow}>
          <Text variant="bodyStrong" tone="muted">{priced.paid > 0 ? 'Balance due' : 'Total'}</Text>
          <Text variant="moneyLarge" testID="pos-total" style={styles.num}>{money(due, currency)}</Text>
        </View>
        <View style={styles.actions} onLayout={(e) => setActionsWidth(e.nativeEvent.layout.width)}>
          <Button title={isRetail ? 'Hold' : 'KOT'} variant={isRetail ? 'outline' : 'kitchen'} size="lg" icon={isRetail ? 'bookmark-outline' : 'flame'}
            badge={hasNew ? priced.newCount : undefined} shortcut={hints ? 'F9' : undefined}
            onPress={p.onKot} loading={submitting === 'kot'} disabled={!hasNew || submitting !== null}
            disabledReason={submitting ? undefined : resume ? 'Add new items to send them to the kitchen' : 'Add an item first'}
            style={{ flex: payBlocked ? 1 : undefined, minWidth: 104 }}
            accessibilityLabel={isRetail ? 'Hold bill (F9)' : hasNew ? `Send ${priced.newCount} new item${priced.newCount === 1 ? '' : 's'} to the kitchen (F9)` : 'Nothing new to send to the kitchen'} testID="pos-kot" />
          {!payBlocked ? (
            <Button title={`Pay ${money(due, currency)}`} variant="success" size="lg" icon="card" shortcut={hints ? 'F8' : undefined}
              onPress={p.onPay} loading={submitting === 'pay'} disabled={nothingToPay || submitting !== null} disabledReason={submitting ? undefined : 'Add an item first'}
              style={{ flex: 1 }} accessibilityLabel={`Pay ${money(due, currency)} (F8)`} testID="pos-pay" />
          ) : null}
        </View>
        {payBlocked ? <Text variant="caption" tone="subtle" align="center">Only cashiers and managers can take payment.</Text> : null}
      </View>
    </View>
  );
}

/** Small pill in the totals summary row (discount, offers). */
function MiniChip({ icon, label, tone, onPress, accessibilityLabel }: {
  icon: IconName; label: string; tone: 'plain' | 'success' | 'warning' | 'primary'; onPress?: () => void; accessibilityLabel?: string;
}) {
  const { colors, radius } = useTheme();
  const fg = tone === 'success' ? colors.successText : tone === 'warning' ? colors.warningText : tone === 'primary' ? colors.primarySoftText : colors.textMuted;
  const bg = tone === 'success' ? colors.successSoft : tone === 'warning' ? colors.warningSoft : tone === 'primary' ? colors.primarySoft : 'transparent';
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} hitSlop={6}
      style={({ hovered }: any) => [styles.miniChip, { borderRadius: radius.pill, backgroundColor: hovered && onPress ? colors.surfaceSunken : bg,
        borderColor: tone === 'plain' ? colors.border : bg }, Platform.OS === 'web' && onPress && ({ cursor: 'pointer' } as any)]}>
      <Ionicons name={icon} size={13} color={fg} />
      <Text variant="caption" color={fg} numberOfLines={1} style={[styles.num, { flexShrink: 1 }]}>{label}</Text>
    </Pressable>
  );
}

/** The offer as a chip in the summary row: applied (tap to change), a problem, or how many offers fit. */
function OfferChip({ info, currency, discount, onPress }: { info: CartOfferInfo; currency: string; discount: number; onPress?: () => void }) {
  const tap = info.locked ? undefined : onPress;
  if (info.applied) {
    return <MiniChip icon="pricetag" tone="success" onPress={tap} label={discount > 0 ? `−${money(discount, currency)}` : info.applied.name}
      accessibilityLabel={`Offer ${info.applied.name}${discount > 0 ? `, ${money(discount, currency)} off` : ''}${tap ? ', change offer' : ''}`} />;
  }
  if (info.locked || !info.online) return null;
  if (info.problem) return <MiniChip icon="alert-circle-outline" tone="warning" label="Offer" onPress={tap} accessibilityLabel={`${info.problem}. Change offer`} />;
  if (info.eligibleCount > 0) return <MiniChip icon="pricetags-outline" tone="primary" label={`${info.eligibleCount} offer${info.eligibleCount === 1 ? '' : 's'}`} onPress={tap} />;
  return <MiniChip icon="ticket-outline" tone="plain" label={info.pending ? 'Offers…' : 'Coupon'} onPress={tap} accessibilityLabel="Coupon or offers" />;
}

/** Customer on a running bill as one compact button next to the bill tabs. */
function CustomerButton({ customer, onPress }: { customer: Draft['customer']; onPress: () => void }) {
  const { colors, radius } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={customer ? `Customer ${customer.name}${customer.phone ? `, ${customer.phone}` : ''}. Change customer` : 'Add customer'}
      style={({ hovered }: any) => [styles.custBtn, {
        borderRadius: radius.pill, borderColor: customer ? colors.primary : colors.border,
        backgroundColor: hovered ? colors.surfaceSunken : customer ? colors.primarySoft : colors.surface,
      }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
      {customer ? <Avatar name={customer.name} size={28} /> : <Ionicons name="person-add-outline" size={18} color={colors.textMuted} />}
    </Pressable>
  );
}

/** Offer line in the totals: the applied offer (tap to change), or how many offers fit the cart. */
function OfferRow({ info, currency, discount, onPress }: { info: CartOfferInfo; currency: string; discount: number; onPress?: () => void }) {
  const { colors } = useTheme();
  const tap = info.locked ? undefined : onPress;
  if (info.applied) {
    const label = `${info.applied.name}${info.code ? ` · ${info.code}` : ''}`;
    return (
      <Pressable onPress={tap} disabled={!tap} accessibilityRole="button" accessibilityLabel={`Offer ${label}${tap ? ', change offer' : ''}`}>
        <View style={styles.tRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
            <Ionicons name="pricetag" size={13} color={colors.successText} />
            <Text variant="small" tone="success" numberOfLines={1} style={{ flexShrink: 1 }}>{label}{tap ? '  ✎' : ''}</Text>
          </View>
          {discount > 0 ? <Text variant="small" tone="success" style={styles.num}>−{money(discount, currency)}</Text> : null}
        </View>
        {info.freeItemName ? (
          <View style={styles.tRow}>
            <Text variant="caption" tone="success" numberOfLines={1} style={{ flex: 1, paddingLeft: 17 }}>
              + {info.applied.freeQuantity > 1 ? `${info.applied.freeQuantity} × ` : ''}{info.freeItemName} free
            </Text>
            <Text variant="caption" tone="success">{money(0, currency)}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  }
  if (info.locked || !info.online) return null;
  if (info.problem) {
    return (
      <Pressable onPress={tap} accessibilityRole="button" style={styles.addDiscount} hitSlop={4}>
        <Ionicons name="alert-circle-outline" size={14} color={colors.warning} />
        <Text variant="small" tone="warning" numberOfLines={2} style={{ flexShrink: 1 }}>{info.problem} · change offer</Text>
      </Pressable>
    );
  }
  if (info.eligibleCount > 0) {
    return (
      <Pressable onPress={tap} accessibilityRole="button" style={styles.addDiscount} hitSlop={4}>
        <Ionicons name="pricetags-outline" size={14} color={colors.primary} />
        <Text variant="smallStrong" tone="primary">{info.eligibleCount} offer{info.eligibleCount === 1 ? '' : 's'} available</Text>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={tap} accessibilityRole="button" style={styles.addDiscount} hitSlop={4}>
      <Ionicons name="ticket-outline" size={14} color={colors.textMuted} />
      <Text variant="small" tone="muted">{info.pending ? 'Checking offers…' : 'Coupon / offers'}</Text>
    </Pressable>
  );
}

function discountLabel(draft: Draft, redeem: number, currency: string): string {
  const parts: string[] = [];
  if (draft.discount && draft.discount.value > 0) parts.push(draft.discount.type === 'percent' ? `Discount ${draft.discount.value}%` : 'Discount');
  else if (draft.resume?.discount_amount && !redeem) parts.push('Discount');
  if (redeem) parts.push(`Points ${money(redeem, currency, true)}`);
  return parts.join(' + ') || 'Discount';
}

function LineRow({ pl, currency, expanded, highlight, onToggle, quickNotes }: {
  pl: PricedLine; currency: string; expanded: boolean; highlight: boolean; onToggle: () => void; quickNotes: string[];
}) {
  const { colors, radius } = useTheme();
  const bump = useCart((s) => s.bump);
  const setQty = useCart((s) => s.setQty);
  const setNote = useCart((s) => s.setNote);
  const remove = useCart((s) => s.remove);
  const { line } = pl;
  const missing = !pl.product || !pl.product.is_active || pl.unavailable;

  const editQty = async () => {
    const v = await prompt({ title: `Quantity · ${line.name}`, label: 'Quantity', placeholder: String(line.quantity), confirmLabel: 'Set' });
    if (v === null) return;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) setQty(line.id, n);
  };

  const toggleNote = (n: string) => {
    const current = line.notes ? line.notes.split(', ').filter(Boolean) : [];
    const next = current.includes(n) ? current.filter((x) => x !== n) : [...current, n];
    setNote(line.id, next.join(', '));
  };

  return (
    <View style={[styles.line, { borderRadius: radius.md, backgroundColor: expanded ? colors.surfaceSunken : highlight ? colors.primarySoft : 'transparent' }]}>
      <View style={styles.lineMain}>
        <Pressable onPress={onToggle} style={{ flex: 1, minWidth: 0 }} accessibilityRole="button" accessibilityLabel={`${line.name}, edit note or remove`}>
          <Text variant="bodyStrong" numberOfLines={2} tone={missing ? 'danger' : 'default'}>
            {line.name}{line.variantName ? <Text variant="body" tone="muted"> · {line.variantName}</Text> : null}
          </Text>
          <Text variant="caption" tone={missing ? 'danger' : 'subtle'} numberOfLines={1}>
            {pl.unavailable ? 'Not on this channel\'s menu — remove it' : missing ? 'No longer on the menu — remove it' : `${money(pl.unitPrice, currency)} each`}
          </Text>
          {line.notes ? (
            <View style={styles.noteRow}>
              <Ionicons name="chatbubble-ellipses-outline" size={12} color={colors.accentText} />
              <Text variant="caption" tone="accent" numberOfLines={2} style={{ flexShrink: 1 }}>{line.notes}</Text>
            </View>
          ) : null}
        </Pressable>
        <View style={[styles.stepper, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface }]}>
          <StepBtn icon={line.quantity === 1 ? 'trash-outline' : 'remove'} label={line.quantity === 1 ? `Remove ${line.name}` : `One less ${line.name}`}
            danger={line.quantity === 1} onPress={() => bump(line.id, -1)} />
          <Pressable onPress={() => void editQty()} accessibilityRole="button" accessibilityLabel={`Quantity ${line.quantity}, tap to type`} style={styles.qtyBox}>
            <Text variant="bodyStrong" style={styles.num}>{line.quantity}</Text>
          </Pressable>
          <StepBtn icon="add" label={`One more ${line.name}`} onPress={() => bump(line.id, 1)} />
        </View>
        <Text variant="money" style={[styles.lineTotal, styles.num]} numberOfLines={1}>{money(pl.total, currency)}</Text>
      </View>
      {expanded ? (
        <View style={{ gap: 8, paddingTop: 8 }}>
          <NoteInput value={line.notes ?? ''} onCommit={(t) => setNote(line.id, t)} />
          <View style={styles.noteChips}>
            {quickNotes.map((n) => <Chip key={n} label={n} selected={!!line.notes?.split(', ').includes(n)} onPress={() => toggleNote(n)} />)}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Button title="Remove item" size="sm" variant="ghost" icon="trash-outline" onPress={() => remove(line.id)} />
            <Button title="Done" size="sm" variant="soft" onPress={onToggle} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function NoteInput({ value, onCommit }: { value: string; onCommit: (t: string) => void }) {
  const { colors, radius } = useTheme();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <TextInput value={text} onChangeText={setText} onBlur={() => onCommit(text)} onSubmitEditing={() => onCommit(text)}
      placeholder="Note for kitchen (e.g. less spicy)" placeholderTextColor={colors.textSubtle} maxLength={200} autoFocus={Platform.OS === 'web'}
      accessibilityLabel="Item note"
      style={[styles.noteInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.sm, fontFamily: fonts.regular },
        Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]} />
  );
}

function StepBtn({ icon, onPress, label, danger }: { icon: IconName; onPress: () => void; label: string; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
      style={({ pressed, hovered }: any) => [styles.step, { backgroundColor: pressed ? colors.surfaceSunken : hovered ? colors.surfaceAlt : 'transparent' },
        Platform.OS === 'web' && ({ cursor: 'pointer', userSelect: 'none' } as any)]}>
      <Ionicons name={icon} size={18} color={danger ? colors.danger : colors.text} />
    </Pressable>
  );
}

function TotalRow({ label, value, muted, tone, onPress }: { label: string; value: string; muted?: boolean; tone?: 'success'; onPress?: () => void }) {
  const content = (
    <View style={styles.tRow}>
      <Text variant="small" tone={tone ?? (muted ? 'muted' : 'default')} numberOfLines={1} style={{ flex: 1 }}>{label}{onPress ? '  ✎' : ''}</Text>
      <Text variant="small" tone={tone ?? (muted ? 'muted' : 'default')} style={styles.num}>{value}</Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button">{content}</Pressable> : content;
}

function Pill({ icon, label, sub, onPress, tone, left, badge }: {
  icon?: IconName; label: string; sub?: string; onPress: () => void; tone: 'plain' | 'active' | 'warn'; left?: React.ReactNode; badge?: string;
}) {
  const { colors, radius } = useTheme();
  const border = tone === 'active' ? colors.primary : tone === 'warn' ? colors.warning : colors.border;
  const bg = tone === 'active' ? colors.primarySoft : tone === 'warn' ? colors.warningSoft : colors.surface;
  const fg = tone === 'active' ? colors.primarySoftText : tone === 'warn' ? colors.warningText : colors.text;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={sub ? `${label}, ${sub}` : label}
      style={({ hovered }: any) => [styles.pill, { borderColor: border, backgroundColor: hovered ? colors.surfaceSunken : bg, borderRadius: radius.pill },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
      {left ?? (icon ? <Ionicons name={icon} size={15} color={fg} /> : null)}
      <View style={{ flexShrink: 1 }}>
        <Text variant="smallStrong" color={fg} numberOfLines={1}>{label}</Text>
        {sub ? <Text variant="caption" color={fg} numberOfLines={1} style={{ opacity: 0.8 }}>{sub}</Text> : null}
      </View>
      {badge ? <Badge label={badge} tone={badge === 'Gold' ? 'accent' : badge === 'Silver' ? 'info' : 'neutral'} /> : null}
      <Ionicons name="chevron-down" size={14} color={fg} />
    </Pressable>
  );
}

function InlineField({ icon, ...rest }: { icon: IconName } & React.ComponentProps<typeof TextInput>) {
  const { colors, radius } = useTheme();
  return (
    <View style={[styles.inlineField, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface }]}>
      <Ionicons name={icon} size={16} color={colors.textSubtle} />
      <TextInput {...rest} placeholderTextColor={colors.textSubtle} accessibilityLabel={rest.placeholder}
        style={[{ flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 14, paddingVertical: 8, maxHeight: 64 }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  summaryToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, minHeight: 32, paddingRight: 4 },
  miniChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, paddingHorizontal: 8, height: 28, maxWidth: 150 },
  header: { padding: 12, gap: 8, borderBottomWidth: 1 },
  tabRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  custBtn: { width: 44, height: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  resume: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 },
  pillBar: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  pills: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, paddingHorizontal: 10, minHeight: 34, paddingVertical: 4, maxWidth: 220 },
  clear: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  inlineField: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, paddingHorizontal: 10 },
  lines: { padding: 8, paddingBottom: 16, flexGrow: 1 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, paddingVertical: 4 },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, paddingVertical: 6, borderBottomWidth: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, minHeight: 150 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  line: { paddingHorizontal: 8, paddingVertical: 8 },
  lineMain: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, overflow: 'hidden' },
  step: { width: 34, height: 36, alignItems: 'center', justifyContent: 'center' },
  qtyBox: { minWidth: 30, height: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  lineTotal: { minWidth: 76, textAlign: 'right' },
  noteInput: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  noteChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  footer: { borderTopWidth: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, gap: 6 },
  tRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, minHeight: 20 },
  addDiscount: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: 8 },
  num: { fontVariant: ['tabular-nums'] },
});
