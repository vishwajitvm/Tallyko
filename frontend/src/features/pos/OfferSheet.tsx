/** Offers for the bill being rung up: best automatic offer, any eligible offer, coupon code, or none. */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { OfferEvaluation } from '@/api/offers';
import { Badge, Button, EmptyState, Input, Sheet, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { money } from '@/lib/format';
import { Callout } from '@/features/settings/components';
import type { OfferMode } from './cart';
import { findOfferByCode, offerValueLabel, useOfferCatalog, type CartOffers } from './offers';

export function OfferSheet({ visible, onClose, offers, mode, offerId, code, online, currency, onChoose }: {
  visible: boolean;
  onClose: () => void;
  offers: CartOffers;
  mode: OfferMode;
  offerId: string | null;
  code: string | null;
  online: boolean;
  currency: string;
  onChoose: (choice: { mode: OfferMode; offerId?: string | null; name?: string | null; code?: string | null }) => void;
}) {
  const { colors, radius } = useTheme();
  const catalog = useOfferCatalog((s) => s.offers);
  const loadCatalog = useOfferCatalog((s) => s.load);
  const [codeText, setCodeText] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const cur = (n: number) => money(n, currency);

  useEffect(() => {
    if (!visible) return;
    setCodeText(code ?? '');
    setCodeError(null);
    setShowOthers(false);
    if (online) { offers.refresh(); void loadCatalog(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const codesById = new Map(catalog.filter((o) => o.code).map((o) => [o.id, o.code!]));
  const appliedId = offers.applied?.id ?? null;
  const best = offers.bestAuto?.eligible ? offers.bestAuto : null;

  const applyCode = async () => {
    const text = codeText.trim();
    if (!text) { setCodeError('Type the code the customer gave you'); return; }
    setChecking(true);
    setCodeError(null);
    try {
      let found = findOfferByCode(useOfferCatalog.getState().offers, text);
      if (!found) {
        await loadCatalog(true);
        found = findOfferByCode(useOfferCatalog.getState().offers, text);
      }
      if (!found) { setCodeError(`No active offer with the code “${text.toUpperCase()}”`); return; }
      const ev = offers.data?.offers.find((o) => o.offer_id === found!.id);
      if (ev && !ev.eligible) { setCodeError(`${found.name}: ${ev.reason ?? 'not valid for this bill'}`); return; }
      onChoose({ mode: 'manual', offerId: found.id, name: found.name, code: found.code });
    } finally {
      setChecking(false);
    }
  };

  const body = () => {
    if (!online) {
      return (
        <EmptyState icon="cloud-offline-outline" title="Offers need the internet"
          message="You can keep billing — this bill will go through without an offer. Offers show up again when you are back online." />
      );
    }
    if (offers.locked) {
      return (
        <Callout tone="info" title="Offer locked">
          {offers.applied ? `${offers.applied.name} stays on this bill because a payment was already taken.` : 'A payment was already taken on this bill, so offers can no longer be changed.'}
        </Callout>
      );
    }
    if (!offers.data && offers.pending) return <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text tone="muted">Checking offers…</Text></View>;
    if (!offers.data && offers.error) {
      return (
        <EmptyState icon="pricetags-outline" title="Couldn't check offers" message="The bill can still be paid without an offer."
          action={{ label: 'Try again', icon: 'refresh', onPress: offers.refresh }} />
      );
    }
    return (
      <View style={{ gap: 8 }}>
        <Option selected={mode === 'auto'} icon="sparkles-outline" title="Best offer automatically"
          subtitle={best ? `${best.name} · ${best.description}` : 'No automatic offer applies to this bill right now'}
          value={best ? offerValueLabel(best, cur) : undefined}
          onPress={() => onChoose({ mode: 'auto' })} />
        {offers.eligible.map((ev) => (
          <Option key={ev.offer_id} selected={mode === 'manual' && offerId === ev.offer_id} icon="pricetag-outline" title={ev.name} subtitle={ev.description}
            value={offerValueLabel(ev, cur)} badges={badges(ev, codesById.get(ev.offer_id))}
            onPress={() => onChoose({ mode: 'manual', offerId: ev.offer_id, name: ev.name, code: null })} />
        ))}
        <Option selected={mode === 'none'} icon="close-circle-outline" title="No offer" subtitle="Bill at full price"
          onPress={() => onChoose({ mode: 'none' })} />
        {offers.eligible.length === 0 && offers.data ? (
          <Text variant="small" tone="muted" style={{ paddingHorizontal: 4 }}>No offer applies to this bill yet{offers.ineligible.length ? ' — see why below.' : '.'}</Text>
        ) : null}
        {offers.ineligible.length ? (
          <View style={{ gap: 6, marginTop: 4 }}>
            <Pressable onPress={() => setShowOthers((v) => !v)} accessibilityRole="button" style={styles.othersHead} hitSlop={6}>
              <Ionicons name={showOthers ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textMuted} />
              <Text variant="smallStrong" tone="muted">Not applicable ({offers.ineligible.length})</Text>
            </Pressable>
            {showOthers ? offers.ineligible.map((ev) => (
              <View key={ev.offer_id} style={[styles.other, { borderColor: colors.border, borderRadius: radius.md }]}>
                <Text variant="smallStrong" numberOfLines={1}>{ev.name}</Text>
                <Text variant="caption" tone="subtle" numberOfLines={2}>{ev.description}</Text>
                {ev.reason ? <Text variant="caption" tone="warning">{ev.reason}</Text> : null}
              </View>
            )) : null}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Offers" subtitle={offers.pending && offers.data ? 'Updating for the latest cart…' : 'Pick the offer for this bill'} width={520}
      footer={<Button title="Done" onPress={onClose} full />}>
      {offers.problem ? <Callout tone="warning" title="Offer removed from the preview">{offers.problem}</Callout> : null}
      {online && !offers.locked ? (
        <Input label="Coupon code" value={codeText} onChangeText={(t) => { setCodeText(t.toUpperCase()); setCodeError(null); }}
          placeholder="e.g. DIWALI20" autoCapitalize="characters" autoCorrect={false} maxLength={20} icon="ticket-outline"
          onSubmitEditing={() => void applyCode()} error={codeError}
          right={<Button title="Apply" size="sm" variant="soft" onPress={() => void applyCode()} loading={checking} style={{ marginRight: 6 }} />} />
      ) : null}
      {body()}
      {appliedId && offers.applied?.freeProductId ? (
        <Text variant="small" tone="muted">The free item is added to the bill when it is saved.</Text>
      ) : null}
    </Sheet>
  );
}

function badges(ev: OfferEvaluation, code?: string): { label: string; tone: 'primary' | 'accent' | 'neutral' }[] {
  const out: { label: string; tone: 'primary' | 'accent' | 'neutral' }[] = [];
  if (ev.auto_apply) out.push({ label: 'Auto', tone: 'primary' });
  if (code) out.push({ label: `Code ${code}`, tone: 'accent' });
  return out;
}

function Option({ selected, icon, title, subtitle, value, badges: tags, onPress }: {
  selected: boolean; icon: React.ComponentProps<typeof Ionicons>['name']; title: string; subtitle?: string; value?: string;
  badges?: { label: string; tone: 'primary' | 'accent' | 'neutral' }[]; onPress: () => void;
}) {
  const { colors, radius } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${title}${value ? `, ${value}` : ''}`}
      style={({ hovered }: any) => [styles.option, {
        borderRadius: radius.md, borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.primary : hovered ? colors.borderStrong : colors.border,
        backgroundColor: selected ? colors.primarySoft : colors.surface,
      }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.primary : colors.textSubtle} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Ionicons name={icon} size={15} color={selected ? colors.primarySoftText : colors.textMuted} />
          <Text variant="bodyStrong" color={selected ? colors.primarySoftText : colors.text} numberOfLines={1} style={{ flexShrink: 1 }}>{title}</Text>
          {tags?.map((b) => <Badge key={b.label} label={b.label} tone={b.tone} />)}
        </View>
        {subtitle ? <Text variant="small" tone="muted" numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {value ? <Text variant="money" tone="success">{value}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: 'center', gap: 10, padding: 24 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 56 },
  othersHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, alignSelf: 'flex-start' },
  other: { borderWidth: 1, borderStyle: 'dashed', padding: 10, gap: 2 },
});
