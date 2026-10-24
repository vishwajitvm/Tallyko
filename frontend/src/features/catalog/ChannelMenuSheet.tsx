/**
 * "View menu" for one sales channel (GET /channels/{code}/menu): what the app sells, at which price, and why
 * (own price vs the channel's mark-up). Copy / Export CSV to keep the Swiggy / Zomato partner portal in step.
 */
import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { channelsApi, type ChannelMenu, type ChannelMenuItem } from '@/api/channels';
import { errorMessage } from '@/api/client';
import type { SalesChannel } from '@/api/types';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Badge, Button, ErrorState, Loading, Segmented, Sheet, Text, VegMark, toast, type BadgeTone } from '@/components/ui';
import { money } from '@/lib/format';
import { saveTextFile } from '@/features/reports/saveFile';
import { copyText } from '@/features/settings/components';
import { channelMenuCsv, channelMenuText, channelShortName, formatPct, sourceLabel } from './channelPricing';

const SOURCE_TONE: Record<ChannelMenuItem['price_source'], BadgeTone> = { item: 'primary', markup: 'info', counter: 'neutral' };

export function ChannelMenuSheet({ channel, onClose, symbol = '₹' }: { channel: SalesChannel; onClose: () => void; symbol?: string }) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const [menu, setMenu] = useState<ChannelMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'on' | 'off'>('on');
  const [exporting, setExporting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    channelsApi.menu(channel.code)
      .then((m) => { if (alive) { setMenu(m); setError(null); } })
      .catch((e) => { if (alive) setError(errorMessage(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [channel.code, attempt]);

  const live = menu?.channel ?? channel;
  const name = channelShortName(live);
  const pct = Number(live.price_adjust_pct) || 0;
  const items = (menu?.items ?? []).filter((i) => (tab === 'on' ? i.available : !i.available));
  const ownPrices = (menu?.items ?? []).filter((i) => i.available && i.price_source === 'item').length;

  const exportCsv = async () => {
    if (!menu) return;
    setExporting(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await saveTextFile(`${live.code.toLowerCase()}-menu-${stamp}.csv`, channelMenuCsv(menu));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const footer = (
    <View style={styles.footer}>
      <Button title={isPhone ? 'Edit prices' : 'Edit prices in Menu'} variant="ghost" icon="create-outline"
        onPress={() => { onClose(); router.navigate('/menu' as Href); }} />
      <View style={{ flex: 1 }} />
      <Button title="Copy" icon="copy-outline" variant="secondary" disabled={!menu} onPress={() => menu && copyText(channelMenuText(menu, symbol), `${name} menu`)} />
      <Button title="Export CSV" icon="download-outline" disabled={!menu} loading={exporting} onPress={exportCsv} />
    </View>
  );

  return (
    <Sheet visible onClose={onClose} title={`${live.name} menu`} subtitle="What this channel sells, and at which price" width={820} footer={footer} scroll={false}>
      {loading && !menu ? <Loading label={`Loading the ${name} menu…`} /> : null}
      {error && !menu ? <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {menu ? (
        <View style={{ gap: 12, flexShrink: 1, minHeight: 0 }}>
          <View style={styles.stats}>
            <StatTile label="On the menu" value={String(menu.available_count)} />
            <StatTile label={`Not on ${name}`} value={String(menu.hidden_count)} tone={menu.hidden_count ? 'warning' : undefined} />
            <StatTile label="Own prices" value={String(ownPrices)} />
            <StatTile label="Mark-up" value={pct ? formatPct(pct) : 'None'} />
          </View>
          <Text variant="small" tone="muted">
            {pct
              ? `An item’s own ${name} price wins; every other item is your counter price ${formatPct(pct)} (the channel mark-up). Options add their extra cost on top.`
              : `An item’s own ${name} price wins; every other item sells at your counter price. Options add their extra cost on top.`}
          </Text>
          <Segmented<'on' | 'off'> value={tab} onChange={setTab} size="sm" options={[
            { value: 'on', label: `On the menu (${menu.available_count})` },
            { value: 'off', label: `Not on ${name} (${menu.hidden_count})` },
          ]} />
          <View style={[styles.table, { borderColor: colors.border }]}>
            {!isPhone ? (
              <View style={[styles.row, styles.headRow, { backgroundColor: colors.surfaceAlt, borderBottomColor: colors.border }]}>
                <Text variant="caption" tone="subtle" style={{ flex: 1 }}>ITEM</Text>
                <Text variant="caption" tone="subtle" style={styles.num}>COUNTER</Text>
                <Text variant="caption" tone="subtle" style={styles.num} numberOfLines={1}>{name.toUpperCase()}</Text>
                <Text variant="caption" tone="subtle" style={styles.src}>PRICE FROM</Text>
              </View>
            ) : null}
            <FlatList
              data={items}
              keyExtractor={(i) => i.id}
              style={{ flexGrow: 0 }}
              ListEmptyComponent={
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text tone="muted" align="center">{tab === 'on' ? `Nothing is on the ${name} menu yet.` : `Every item is on ${name}.`}</Text>
                </View>
              }
              renderItem={({ item }) => <MenuItemRow item={item} symbol={symbol} pct={pct} phone={isPhone} />}
            />
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stat, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
      <Text variant="caption" tone="subtle" numberOfLines={1}>{label}</Text>
      <Text variant="h3" tone={tone ?? 'default'}>{value}</Text>
    </View>
  );
}

function MenuItemRow({ item, symbol, pct, phone }: { item: ChannelMenuItem; symbol: string; pct: number; phone: boolean }) {
  const { colors } = useTheme();
  const variants = item.variants.map((v) => `${v.name} ${money(v.price, symbol)}`).join(' · ');
  const sub = [item.category, variants || null].filter(Boolean).join('  ·  ');
  const badge = <Badge label={sourceLabel(item.price_source, pct)} tone={SOURCE_TONE[item.price_source]} />;
  return (
    <View style={[styles.row, { borderBottomColor: colors.divider, opacity: item.available ? 1 : 0.75 }]}>
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <VegMark veg={item.is_veg} size={12} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="bodyStrong" numberOfLines={1}>{item.name}</Text>
          {sub ? <Text variant="small" tone="muted" numberOfLines={1}>{sub}</Text> : null}
          {phone ? <View style={{ marginTop: 4 }}>{badge}</View> : null}
        </View>
      </View>
      {phone ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="money">{money(item.price, symbol)}</Text>
          {item.price !== item.counter_price ? <Text variant="caption" tone="subtle">counter {money(item.counter_price, symbol)}</Text> : null}
        </View>
      ) : (
        <>
          <Text variant="small" tone="muted" style={styles.num}>{money(item.counter_price, symbol)}</Text>
          <Text variant="money" style={styles.num} tone={item.price_source === 'item' ? 'primary' : 'default'}>{money(item.price, symbol)}</Text>
          <View style={styles.src}>{badge}</View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexGrow: 1, flexBasis: 120, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  table: { borderWidth: 1, borderRadius: 12, overflow: 'hidden', flexShrink: 1, minHeight: 120 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  headRow: { paddingVertical: 8 },
  num: { width: 96, textAlign: 'right' },
  src: { width: 130, alignItems: 'flex-end' },
});
