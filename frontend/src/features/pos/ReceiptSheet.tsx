import React, { useState } from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BusinessSettings, Order } from '@/api/types';
import { Button, IconButton, Sheet, Text, toast } from '@/components/ui';
import { Barcode } from '@/components/Barcode';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { lightColors } from '@/theme/tokens';
import { formatDateTime, money, PAYMENT_LABEL } from '@/lib/format';
import { printBill, printErrorMessage, receiptFromOrder } from '@/lib/billing';
import { COMP_LABEL, buildReceiptText, discountRows, receiptTitle, taxRows } from '@/lib/print/receipt';
import { usePrefs } from '@/store/prefs';

export interface ReceiptState {
  order: Order;
  offline: boolean;
  change: number;
}

/** Print the paid bill; errors become a toast. */
export async function printReceipt(r: ReceiptState, settings: BusinessSettings | null): Promise<void> {
  try {
    await printBill(r.order, settings, { offline: r.offline, change: r.change });
  } catch (e) {
    toast.error(printErrorMessage(e));
  }
}

/** Share the bill as text (WhatsApp / SMS); on web without the share sheet it is copied. */
export async function shareReceipt(r: ReceiptState, settings: BusinessSettings | null): Promise<void> {
  const data = receiptFromOrder(r.order, settings, { offline: r.offline, change: r.change });
  const text = buildReceiptText(data, usePrefs.getState().paperWidth);
  try {
    if (Platform.OS === 'web') {
      const nav: any = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.share) {
        await nav.share({ title: `Bill ${data.billNo}`, text });
      } else if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(text);
        toast.success('Bill copied — paste it in WhatsApp or SMS');
      } else {
        toast.error('Sharing is not supported in this browser');
      }
      return;
    }
    await Share.share({ message: text, title: `Bill ${data.billNo}` });
  } catch (e: any) {
    if (e?.name !== 'AbortError') toast.error('Could not share the bill');
  }
}

/**
 * The bill just paid, inside the (already empty) new bill: amount, change to hand back, print / share / view.
 * Nothing blocks the till: tapping the next item starts the next bill and this card goes away.
 */
export function LastBillCard({ receipt, settings, onView, onDismiss }: {
  receipt: ReceiptState; settings: BusinessSettings | null; onView: () => void; onDismiss: () => void;
}) {
  const { colors, radius } = useTheme();
  const [printing, setPrinting] = useState(false);
  const { order, offline, change } = receipt;
  const cur = settings?.currency_symbol ?? '₹';
  const methods = [...new Set((order.payments ?? []).map((p) => PAYMENT_LABEL[p.method] ?? p.method))].join(' + ');
  const tint = offline ? colors.warning : colors.success;
  return (
    <View style={[cardStyles.card, { borderColor: tint, backgroundColor: offline ? colors.warningSoft : colors.successSoft, borderRadius: radius.lg }]}
      accessibilityRole="summary" accessibilityLabel={`Last bill ${money(order.total_amount, cur)} paid${change > 0 ? `, return change ${money(change, cur)}` : ''}`}
      testID="pos-last-bill">
      <View style={cardStyles.head}>
        <Ionicons name={offline ? 'cloud-offline' : 'checkmark-circle'} size={22} color={tint} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong" tone={offline ? 'warning' : 'success'} numberOfLines={1}>
            {money(order.total_amount, cur)} {offline ? 'saved offline' : 'paid'}{methods ? ` · ${methods}` : ''}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {offline ? 'Syncs when the internet is back' : `Bill ${order.invoice_no ?? order.code}`}{order.token_no ? ` · Token #${order.token_no}` : ''}{order.table_label ? ` · Table ${order.table_label}` : ''}
          </Text>
        </View>
        <IconButton icon="close" size="sm" accessibilityLabel="Hide last bill" onPress={onDismiss} />
      </View>
      {change > 0 ? (
        <View style={[cardStyles.change, { backgroundColor: colors.surface, borderRadius: radius.md }]}>
          <Text variant="bodyStrong" tone="success">Return change</Text>
          <Text variant="moneyLarge" tone="success" style={cardStyles.num}>{money(change, cur)}</Text>
        </View>
      ) : null}
      <View style={cardStyles.actions}>
        <Button title="Print" icon="print-outline" size="sm" variant="secondary" loading={printing} style={{ flex: 1 }}
          onPress={() => { setPrinting(true); void printReceipt(receipt, settings).finally(() => setPrinting(false)); }} />
        <Button title="Share" icon="share-social-outline" size="sm" variant="secondary" style={{ flex: 1 }} onPress={() => void shareReceipt(receipt, settings)} />
        <Button title="View" icon="receipt-outline" size="sm" variant="ghost" onPress={onView} testID="pos-last-bill-view" />
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: { alignSelf: 'stretch', borderWidth: 1, padding: 12, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  change: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  actions: { flexDirection: 'row', gap: 8 },
  num: { fontVariant: ['tabular-nums'] },
});

/** The full on-screen bill: print, share, next customer. */
export function ReceiptSheet({ receipt, settings, onNewBill }: {
  receipt: ReceiptState | null; settings: BusinessSettings | null; onNewBill: () => void;
}) {
  const { colors, radius } = useTheme();
  const { isPhone } = useLayout();
  const [printing, setPrinting] = useState(false);

  if (!receipt) return <Sheet visible={false} onClose={onNewBill}><View /></Sheet>;
  const { order, offline, change } = receipt;
  const data = receiptFromOrder(order, settings, { offline, change });
  const cur = data.business.currencySymbol;

  const print = async () => {
    setPrinting(true);
    await printReceipt(receipt, settings);
    setPrinting(false);
  };
  const share = () => shareReceipt(receipt, settings);

  const ink = lightColors.text;
  const muted = lightColors.textMuted;
  const row = (label: string, value: string, strong = false) => (
    <View style={styles.row} key={label}>
      <Text variant={strong ? 'bodyStrong' : 'small'} color={strong ? ink : muted}>{label}</Text>
      <Text variant={strong ? 'bodyStrong' : 'small'} color={strong ? ink : muted} style={styles.num}>{value}</Text>
    </View>
  );

  return (
    <Sheet visible onClose={onNewBill} title={offline ? 'Bill saved offline' : 'Payment received'} width={520}
      subtitle={offline ? 'It will sync automatically when the internet is back' : `Bill ${data.billNo}${order.token_no ? ` · Token #${order.token_no}` : ''}`}
      footer={
        <View style={styles.actions}>
          <Button title="Print" icon="print-outline" variant="secondary" onPress={() => void print()} loading={printing} style={{ flex: isPhone ? 1 : undefined }} />
          <Button title="Share" icon="share-social-outline" variant="secondary" onPress={() => void share()} style={{ flex: isPhone ? 1 : undefined }} />
          <View style={{ flex: isPhone ? 0 : 1 }} />
          <Button title="New bill" icon="add" onPress={onNewBill} style={{ flex: isPhone ? 1.4 : undefined }} testID="pos-new-bill" />
        </View>
      }>
      <View style={[styles.banner, { backgroundColor: offline ? colors.warningSoft : colors.successSoft, borderRadius: radius.md }]}>
        <Ionicons name={offline ? 'cloud-offline' : 'checkmark-circle'} size={22} color={offline ? colors.warning : colors.success} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" tone={offline ? 'warning' : 'success'}>{money(data.total, cur)} {order.payment_status === 'paid' || offline ? 'paid' : 'recorded'}</Text>
          {change > 0 ? <Text variant="small" tone={offline ? 'warning' : 'success'}>Return change {money(change, cur)}</Text> : null}
        </View>
        {change > 0 ? <Text variant="moneyLarge" tone="success">{money(change, cur)}</Text> : null}
      </View>

      <View style={[styles.paper, { backgroundColor: lightColors.surface, borderColor: colors.border, borderRadius: radius.md }]}>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text variant="h3" color={ink} align="center">{data.business.name}</Text>
          {data.business.address ? <Text variant="small" color={muted} align="center">{data.business.address}</Text> : null}
          {data.business.phone ? <Text variant="small" color={muted}>Ph: {data.business.phone}</Text> : null}
          {data.business.gstin ? <Text variant="small" color={muted}>GSTIN: {data.business.gstin}</Text> : null}
          {data.business.fssai ? <Text variant="small" color={muted}>FSSAI: {data.business.fssai}</Text> : null}
          <Text variant="caption" color={muted} style={{ marginTop: 6, letterSpacing: 1 }}>{receiptTitle(data)}</Text>
        </View>
        <Dash />
        <View style={styles.row}>
          <Text variant="small" color={ink}>Bill: {data.billNo}</Text>
          <Text variant="small" color={muted}>{formatDateTime(data.createdAt)}</Text>
        </View>
        <Text variant="small" color={muted}>
          {[data.orderType, data.tableLabel ? `Table ${data.tableLabel}` : null, data.tokenNo ? `Token #${data.tokenNo}` : null, data.channel].filter(Boolean).join(' · ')}
        </Text>
        {data.customerName || data.customerPhone ? <Text variant="small" color={muted}>Customer: {[data.customerName, data.customerPhone].filter(Boolean).join(' · ')}</Text> : null}
        <Dash />
        {data.items.map((it, i) => (
          <View key={i} style={styles.item}>
            <View style={{ flex: 1 }}>
              <Text variant="smallStrong" color={ink}>{it.name}{it.variant ? ` (${it.variant})` : ''}</Text>
              <Text variant="caption" color={it.free || it.comp ? lightColors.successText : muted}>
                {it.free ? `${it.quantity} × free${order.offer_name ? ` · ${order.offer_name}` : ''}`
                  : it.comp ? `${it.quantity} × ${COMP_LABEL.toLowerCase()}` : `${it.quantity} × ${money(it.unitPrice, cur)}`}
              </Text>
            </View>
            <Text variant="smallStrong" color={it.free || it.comp ? lightColors.successText : ink} style={styles.num}>
              {it.free ? 'FREE' : it.comp ? money(0, cur) : money(it.lineTotal, cur)}
            </Text>
          </View>
        ))}
        <Dash />
        {row('Subtotal', money(data.subtotal, cur))}
        {discountRows(data).map((d) => row(d.label, `−${money(d.amount, cur)}`))}
        {taxRows(data.taxBreakup).map((t) => row(t.label.replace(' @', ' '), money(t.amount, cur)))}
        {data.roundOff ? row('Round off', `${data.roundOff > 0 ? '+' : ''}${money(data.roundOff, cur)}`) : null}
        <View style={[styles.row, { marginTop: 6 }]}>
          <Text variant="h2" color={ink}>TOTAL</Text>
          <Text variant="h2" color={ink} style={styles.num}>{money(data.total, cur)}</Text>
        </View>
        {data.pricesIncludeTax ? <Text variant="caption" color={muted}>Prices include GST</Text> : null}
        {data.payments.length ? <Dash /> : null}
        {data.payments.map((p, i) => row(`${PAYMENT_LABEL[p.method] ?? p.method}${data.payments.length > 1 ? ` (${i + 1})` : ''}`, money(p.amount, cur)))}
        {change > 0 ? row('Change returned', money(change, cur)) : null}
        {data.loyaltyEarned ? row('Points earned', String(data.loyaltyEarned)) : null}
        <View style={{ alignItems: 'center', marginTop: 12 }}>
          <Barcode value={data.code} height={44} width={220} color={ink} background={lightColors.surface} />
        </View>
        <Text variant="small" color={muted} align="center" style={{ marginTop: 6 }}>{data.business.footer || 'Thank you! Visit again.'}</Text>
        {offline ? <Text variant="caption" color={muted} align="center">Offline bill · invoice number assigned on sync</Text> : null}
      </View>
    </Sheet>
  );
}

function Dash() {
  return <View style={{ borderBottomWidth: 1, borderStyle: 'dashed', borderColor: lightColors.borderStrong, marginVertical: 8 }} />;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  paper: { borderWidth: 1, padding: 18, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  item: { flexDirection: 'row', gap: 12, paddingVertical: 3 },
  num: { fontVariant: ['tabular-nums'] },
});
