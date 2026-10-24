/** Create / edit an offer or loyalty reward, with a live plain-language preview. */
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import { offersApi, type Offer, type OfferBenefit, type OfferKind } from '@/api/offers';
import type { OrderType, Product } from '@/api/types';
import { Button, Chip, Input, Text, VegMark, toast } from '@/components/ui';
import { DetailPanel } from '@/features/catalog/DetailPanel';
import { confirmTop as confirm } from '@/features/catalog/dialogs';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { activeCategories, useData } from '@/store/data';
import { CHANNEL_LABEL, ORDER_TYPE_LABEL, money } from '@/lib/format';
import { ChoiceChips, FieldRow, FormSection, SettingSwitch } from '@/features/settings/components';
import { ALL_ORDER_TYPES, DAY_SHORT, emptyForm, fromOffer, previewSentence, toInput, validateForm, type FormErrors, type OfferForm } from './form';

export function OfferEditor({ offer, initialKind, loyaltyAllowed, canAnnounce, onClose, onSaved }: {
  offer: Offer | null;
  initialKind: OfferKind;
  loyaltyAllowed: boolean;
  canAnnounce: boolean;
  onClose: () => void;
  onSaved: (o: Offer) => void;
}) {
  const { colors, radius } = useTheme();
  const { isPhone } = useLayout();
  // Side panel next to the list on tablets and desktops, full screen on phones
  const products = useData((s) => s.products);
  const categories = useData((s) => s.categories);
  const channels = useData((s) => s.channels);
  const settings = useData((s) => s.settings);
  const isRetail = settings?.business_type === 'retail';

  const initial = useMemo(() => (offer ? fromOffer(offer) : emptyForm(initialKind)), [offer, initialKind]);
  const [form, setForm] = useState<OfferForm>(initial);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const errors: FormErrors = useMemo(() => validateForm(form), [form]);
  const shown = (k: keyof OfferForm) => (tried ? errors[k] ?? null : null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof OfferForm>(k: K, v: OfferForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const productName = useMemo(() => {
    const m = new Map(products.map((p) => [p.id, p.name]));
    return (id: string) => m.get(id);
  }, [products]);
  const categoryName = useMemo(() => {
    const m = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string) => m.get(id);
  }, [categories]);
  const channelName = (code: string) => channels.find((c) => c.code === code)?.name ?? CHANNEL_LABEL[code] ?? code;
  const sentence = previewSentence(form, { product: productName, category: categoryName, channel: channelName });

  const sellable = useMemo(() => products.filter((p) => p.is_active).sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const cats = useMemo(() => activeCategories(categories), [categories]);
  const channelOptions = useMemo(() => channels.filter((c) => c.enabled || c.code === 'POS'), [channels]);
  const orderTypes: OrderType[] = isRetail ? ['RETAIL_WALKIN', 'TAKEAWAY', 'DELIVERY'] : ALL_ORDER_TYPES.filter((t) => t !== 'RETAIL_WALKIN');

  const kindOptions: { value: OfferKind; label: string }[] = [
    { value: 'bill', label: 'Whole bill' },
    { value: 'items', label: 'Selected items' },
    ...(loyaltyAllowed || form.kind === 'loyalty' ? [{ value: 'loyalty' as OfferKind, label: 'Loyalty reward' }] : []),
  ];
  const benefitOptions: { value: OfferBenefit; label: string }[] = [
    { value: 'percent', label: '% off' },
    { value: 'flat', label: `${settings?.currency_symbol ?? '₹'} off` },
    { value: 'free_item', label: 'Free item' },
  ];

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const close = async () => {
    if (dirty && !(await confirm({ title: 'Discard changes?', message: 'Your changes to this offer will be lost.', confirmLabel: 'Discard', danger: true }))) return;
    onClose();
  };

  const save = async () => {
    setTried(true);
    const first = Object.values(errors)[0];
    if (first) { toast.warning(first); return; }
    setSaving(true);
    try {
      const body = toInput(form);
      const saved = offer ? await offersApi.update(offer.id, body) : await offersApi.create(body);
      toast.success(offer ? 'Offer updated' : form.kind === 'loyalty' ? 'Loyalty reward created' : 'Offer created');
      onSaved(saved);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const announce = async () => {
    if (!offer) return;
    if (dirty) { toast.warning('Save your changes first, then announce the offer'); return; }
    if (!offer.is_active) { toast.warning('Switch the offer on before announcing it'); return; }
    const ok = await confirm({
      title: 'Email this offer to customers?',
      message: `“${offer.name}” will be emailed to every customer who agreed to receive offers. This can't be undone.`,
      confirmLabel: 'Send emails',
    });
    if (!ok) return;
    setAnnouncing(true);
    try {
      const r = await offersApi.announce(offer.id);
      if (r.queued > 0) toast.success(`Emailing ${r.queued} customer${r.queued === 1 ? '' : 's'}`);
      else toast.info(r.opted_in_customers ? 'Those customers were already emailed about this offer' : 'No customers have agreed to receive offers by email yet');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setAnnouncing(false);
    }
  };

  const title = offer ? `Edit ${offer.kind === 'loyalty' ? 'reward' : 'offer'}` : form.kind === 'loyalty' ? 'New loyalty reward' : 'New offer';

  return (
    <DetailPanel onClose={() => void close()} title={offer ? offer.name : title} subtitle={offer ? title : 'Set what the customer gets, then who and when'}
      dismissable={!saving} testID="offer-editor"
      footer={
        <View style={{ gap: 10 }}>
          <View style={[styles.preview, { backgroundColor: colors.primarySoft, borderRadius: radius.md }]} accessibilityLiveRegion="polite">
            <Ionicons name="eye-outline" size={16} color={colors.primarySoftText} style={{ marginTop: 2 }} />
            <Text variant="small" color={colors.primarySoftText} style={{ flex: 1 }} numberOfLines={isPhone ? 4 : 3}>{sentence}</Text>
          </View>
          <View style={styles.footerRow}>
            {offer && canAnnounce ? (
              <Button title={isPhone ? 'Email' : 'Announce by email'} icon="mail-outline" variant="ghost" onPress={() => void announce()} loading={announcing} disabled={saving} />
            ) : null}
            <View style={{ flex: 1 }} />
            <Button title={offer ? 'Save' : 'Create'} icon="checkmark" onPress={() => void save()} loading={saving}
              disabled={announcing || (!!offer && !dirty)} disabledReason={offer && !dirty ? 'No changes yet' : undefined}
              style={isPhone ? { flex: 1 } : undefined} testID="offer-save" />
          </View>
        </View>
      }>
      <View style={{ gap: 20 }}>
        <FormSection stacked title="The offer" description="Customers see the name on their bill.">
          <ChoiceChips value={form.kind} options={kindOptions} accessibilityLabel="Offer applies to"
            onChange={(k) => setForm((f) => ({ ...f, kind: k, ...(k === 'loyalty' && !f.min_visits ? { min_visits: '5' } : {}) }))} />
          <Input label="Name" required value={form.name} onChangeText={(t) => set('name', t)} maxLength={80}
            placeholder={form.kind === 'loyalty' ? 'e.g. 5th visit reward' : 'e.g. Happy hours 20% off'} error={shown('name')} />
          <Input label="Description (optional)" value={form.description} onChangeText={(t) => set('description', t)} maxLength={300}
            placeholder="Shown to staff and in the announcement email" error={shown('description')} />
        </FormSection>

        <FormSection stacked title="What the customer gets">
          <ChoiceChips value={form.benefit_type} options={benefitOptions} onChange={(b) => set('benefit_type', b)} accessibilityLabel="Benefit" />
          {form.benefit_type === 'free_item' ? (
            <>
              <ItemPicker label="Free item" products={sellable} selected={form.free_product_id ? [form.free_product_id] : []} single
                onChange={(ids) => set('free_product_id', ids[0] ?? null)} error={shown('free_product_id')} currency={settings?.currency_symbol ?? '₹'} />
              <Input label="How many free" keyboardType="number-pad" value={form.free_quantity} onChangeText={(t) => set('free_quantity', t)}
                containerStyle={{ maxWidth: 200 }} error={shown('free_quantity')} />
            </>
          ) : (
            <FieldRow>
              <Input label={form.benefit_type === 'percent' ? 'Percent off' : 'Amount off'} required keyboardType="decimal-pad" value={form.value}
                onChangeText={(t) => set('value', t)} placeholder={form.benefit_type === 'percent' ? 'e.g. 20' : 'e.g. 100'}
                prefix={form.benefit_type === 'flat' ? settings?.currency_symbol ?? '₹' : undefined}
                right={form.benefit_type === 'percent' ? <Text tone="muted" style={{ marginRight: 12 }}>%</Text> : undefined}
                error={shown('value')} hint="Taken off before GST" />
              {form.benefit_type === 'percent' ? (
                <Input label="Up to (optional)" keyboardType="decimal-pad" value={form.max_discount} onChangeText={(t) => set('max_discount', t)}
                  prefix={settings?.currency_symbol ?? '₹'} placeholder="No limit" error={shown('max_discount')} hint="Largest discount on one bill" />
              ) : null}
            </FieldRow>
          )}
        </FormSection>

        <FormSection stacked title="Who and when" description="Leave anything empty to allow it at any time, on any order.">
          {form.kind === 'items' ? (
            <>
              <ItemPicker label="Items" products={sellable} selected={form.product_ids} onChange={(ids) => set('product_ids', ids)}
                error={shown('product_ids')} currency={settings?.currency_symbol ?? '₹'} />
              {cats.length ? (
                <View style={{ gap: 6 }}>
                  <Text variant="smallStrong" tone="muted">…or whole categories</Text>
                  <View style={styles.chips}>
                    {cats.map((c) => (
                      <Chip key={c.id} label={c.name} selected={form.category_ids.includes(c.id)} onPress={() => set('category_ids', toggle(form.category_ids, c.id))} />
                    ))}
                  </View>
                </View>
              ) : null}
            </>
          ) : null}
          {form.kind === 'loyalty' ? (
            <FieldRow>
              <Input label="Visits needed" required keyboardType="number-pad" value={form.min_visits} onChangeText={(t) => set('min_visits', t)}
                placeholder="e.g. 5" error={shown('min_visits')} hint="Completed bills by this customer" />
              <Input label="Within the last (days)" keyboardType="number-pad" value={form.window_days} onChangeText={(t) => set('window_days', t)}
                placeholder="All time" error={shown('window_days')} />
            </FieldRow>
          ) : null}
          <Input label="Minimum bill (optional)" keyboardType="decimal-pad" value={form.min_order} onChangeText={(t) => set('min_order', t)}
            prefix={settings?.currency_symbol ?? '₹'} placeholder="Any amount" error={shown('min_order')} containerStyle={{ maxWidth: 320 }} />

          <View style={{ gap: 6 }}>
            <Text variant="smallStrong" tone="muted">Days</Text>
            <View style={styles.chips}>
              <Chip label="Every day" selected={form.days.length === 0 || form.days.length === 7} onPress={() => set('days', [])} />
              {DAY_SHORT.map((d, i) => (
                <Chip key={d} label={d} selected={form.days.length > 0 && form.days.length < 7 && form.days.includes(i)}
                  onPress={() => set('days', toggle(form.days.length === 7 ? [] : form.days, i))} />
              ))}
            </View>
          </View>
          <FieldRow>
            <Input label="From time" value={form.start_time} onChangeText={(t) => set('start_time', t)} placeholder="e.g. 18:00" maxLength={5}
              keyboardType="numbers-and-punctuation" error={shown('start_time')} />
            <Input label="To time" value={form.end_time} onChangeText={(t) => set('end_time', t)} placeholder="e.g. 22:00" maxLength={5}
              keyboardType="numbers-and-punctuation" error={shown('end_time')} hint="24-hour. 22:00 to 02:00 runs overnight." />
          </FieldRow>
          <FieldRow>
            <Input label="First day" value={form.starts_on} onChangeText={(t) => set('starts_on', t)} placeholder="YYYY-MM-DD (today)" maxLength={10}
              keyboardType="numbers-and-punctuation" error={shown('starts_on')} />
            <Input label="Last day" value={form.ends_on} onChangeText={(t) => set('ends_on', t)} placeholder="YYYY-MM-DD (no end)" maxLength={10}
              keyboardType="numbers-and-punctuation" error={shown('ends_on')} />
          </FieldRow>
          {channelOptions.length > 1 ? (
            <View style={{ gap: 6 }}>
              <Text variant="smallStrong" tone="muted">Sales channels</Text>
              <View style={styles.chips}>
                <Chip label="All channels" selected={form.channels.length === 0} onPress={() => set('channels', [])} />
                {channelOptions.map((c) => (
                  <Chip key={c.code} label={c.name || CHANNEL_LABEL[c.code] || c.code} selected={form.channels.includes(c.code)}
                    onPress={() => set('channels', toggle(form.channels, c.code))} />
                ))}
              </View>
            </View>
          ) : null}
          <View style={{ gap: 6 }}>
            <Text variant="smallStrong" tone="muted">Order types</Text>
            <View style={styles.chips}>
              <Chip label="All" selected={form.order_types.length === 0} onPress={() => set('order_types', [])} />
              {orderTypes.map((t) => (
                <Chip key={t} label={ORDER_TYPE_LABEL[t] ?? t} selected={form.order_types.includes(t)} onPress={() => set('order_types', toggle(form.order_types, t))} />
              ))}
            </View>
          </View>
        </FormSection>

        <FormSection stacked title="Limits" description="Stop the offer after a number of uses. Per-customer limits need the customer on the bill.">
          <FieldRow>
            <Input label="Total uses" keyboardType="number-pad" value={form.max_total} onChangeText={(t) => set('max_total', t)} placeholder="No limit" error={shown('max_total')} />
            <Input label="Uses per customer" keyboardType="number-pad" value={form.max_per_customer} onChangeText={(t) => set('max_per_customer', t)} placeholder="No limit" error={shown('max_per_customer')} />
            <Input label="Priority" keyboardType="number-pad" value={form.priority} onChangeText={(t) => set('priority', t)} placeholder="0" error={shown('priority')}
              hint="Higher shows first" />
          </FieldRow>
        </FormSection>

        <FormSection stacked title="Code and applying">
          <Input label="Coupon code (optional)" value={form.code} onChangeText={(t) => set('code', t.toUpperCase().replace(/\s/g, ''))} maxLength={20}
            autoCapitalize="characters" autoCorrect={false} placeholder="e.g. DIWALI20" icon="ticket-outline" error={shown('code')}
            hint="Customers can quote it; the cashier types it on the bill." />
          <SettingSwitch title="Apply automatically" subtitle="The POS adds the best automatic offer when the bill qualifies. Staff can still change or remove it."
            value={form.auto_apply} onValueChange={(v) => set('auto_apply', v)} />
          <SettingSwitch title="Offer is on" subtitle="Switch off to stop it right away. You can switch it back on later."
            value={form.is_active} onValueChange={(v) => set('is_active', v)} />
        </FormSection>
      </View>
    </DetailPanel>
  );
}

/** Searchable list of menu items with checkboxes (or radio buttons when `single`). */
function ItemPicker({ label, products, selected, onChange, single, error, currency }: {
  label: string; products: Product[]; selected: string[]; onChange: (ids: string[]) => void; single?: boolean; error?: string | null; currency: string;
}) {
  const { colors, radius } = useTheme();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(selected.length === 0);
  const q = query.trim().toLowerCase();
  const list = useMemo(() => (q ? products.filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q)) : products).slice(0, 80),
    [products, q]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const pick = (id: string) => {
    if (single) { onChange([id]); setOpen(false); return; }
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text variant="smallStrong" tone="muted">{label}{selected.length && !single ? ` · ${selected.length} chosen` : ''}</Text>
        {selected.length ? <Button title={open ? 'Done' : single ? 'Change' : 'Add or remove'} size="sm" variant="ghost" onPress={() => setOpen((o) => !o)} /> : null}
      </View>
      {selected.length ? (
        <View style={styles.chips}>
          {selected.map((id) => (
            <Chip key={id} label={byId.get(id)?.name ?? 'Removed item'} icon={single ? 'gift-outline' : 'close'} selected
              onPress={single ? () => setOpen(true) : () => onChange(selected.filter((x) => x !== id))} />
          ))}
        </View>
      ) : null}
      {open ? (
        <View style={[styles.picker, { borderColor: error ? colors.danger : colors.border, borderRadius: radius.md }]}>
          <Input value={query} onChangeText={setQuery} placeholder="Search menu items" icon="search" autoCorrect={false} accessibilityLabel={`Search ${label}`} />
          {products.length === 0 ? (
            <Text variant="small" tone="muted" style={{ padding: 8 }}>No menu items yet. Add items in Menu & items first.</Text>
          ) : list.length === 0 ? (
            <Text variant="small" tone="muted" style={{ padding: 8 }}>No items match “{query}”.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {list.map((p) => {
                const on = selected.includes(p.id);
                return (
                  <Pressable key={p.id} onPress={() => pick(p.id)} accessibilityRole={single ? 'radio' : 'checkbox'} accessibilityState={{ checked: on }}
                    accessibilityLabel={p.name}
                    style={({ hovered }: any) => [styles.pickRow, { borderRadius: radius.sm, backgroundColor: on ? colors.primarySoft : hovered ? colors.surfaceSunken : 'transparent' },
                      Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                    <Ionicons name={single ? (on ? 'radio-button-on' : 'radio-button-off') : on ? 'checkbox' : 'square-outline'} size={20}
                      color={on ? colors.primary : colors.textSubtle} />
                    <VegMark veg={p.is_veg} size={12} />
                    <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>{p.name}</Text>
                    <Text variant="small" tone="muted">{money(p.base_price, currency)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      ) : null}
      {error ? <Text variant="small" tone="danger">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { flexDirection: 'row', gap: 8, padding: 10, alignItems: 'flex-start' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  picker: { borderWidth: 1, padding: 8, gap: 6 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, minHeight: 44 },
});
