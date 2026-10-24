import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { adminApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/client';
import type { BusinessSettings, BusinessType } from '@/api/types';
import { Badge, Button, EmptyState, ErrorState, Input, Loading, Text, toast } from '@/components/ui';
import { QrCode } from '@/components/QrCode';
import { useApi } from '@/hooks/useApi';
import { can, useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { syncNow } from '@/lib/sync';
import { printHtml } from '@/lib/print/printers';
import { printErrorMessage } from '@/lib/billing';
import { chargesGst, checkGstin, normalizeGstin, type GstRegistration } from '@/lib/gstin';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame } from './SettingsFrame';
import { Callout, ChoiceChips, FieldRow, FormSection, Hairline, SaveBar, copyText, webAppOrigin, shareText, SettingSwitch } from './components';
import { fieldErrorsFrom, INVOICE_PREFIX_PATTERN, validateEmail, validateFssai, validatePhone, validateUpi } from './validation';
import { buildQrPosterHtml, upiPayUrl } from './poster';

interface Form {
  business_name: string;
  business_type: BusinessType;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  gst_registration: GstRegistration;
  fssai: string;
  prices_include_tax: boolean;
  default_tax_rate: number;
  invoice_prefix: string;
  receipt_footer: string;
  upi_id: string;
  loyalty_enabled: boolean;
  loyalty_points_per_100: string;
  loyalty_point_value: string;
  store_enabled: boolean;
  qr_ordering_enabled: boolean;
  low_stock_default: string;
}

type FieldKey = keyof Form;

const BUSINESS_TYPES: { value: BusinessType; label: string }[] = [
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'cafe', label: 'Café' },
  { value: 'cloud_kitchen', label: 'Cloud kitchen' },
  { value: 'retail', label: 'Retail shop' },
];

const GST_RATES = [0, 5, 12, 18, 28];

function toForm(s: BusinessSettings): Form {
  return {
    business_name: s.business_name ?? '',
    business_type: s.business_type,
    address: s.address ?? '',
    phone: s.phone ?? '',
    email: s.email ?? '',
    gstin: s.gstin ?? '',
    gst_registration: s.gst_registration ?? 'regular',
    fssai: s.fssai ?? '',
    prices_include_tax: !!s.prices_include_tax,
    default_tax_rate: Number(s.default_tax_rate ?? 0),
    invoice_prefix: s.invoice_prefix ?? '',
    receipt_footer: s.receipt_footer ?? '',
    upi_id: s.upi_id ?? '',
    loyalty_enabled: !!s.loyalty_enabled,
    loyalty_points_per_100: String(s.loyalty_points_per_100 ?? 0),
    loyalty_point_value: String(s.loyalty_point_value ?? 0),
    store_enabled: !!s.store_enabled,
    qr_ordering_enabled: !!s.qr_ordering_enabled,
    low_stock_default: String(s.low_stock_default ?? 0),
  };
}

const toNum = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(',', '.')));

function toPayload(f: Form): Partial<BusinessSettings> {
  return {
    business_name: f.business_name.trim(),
    business_type: f.business_type,
    address: f.address.trim(),
    phone: f.phone.trim(),
    // Pydantic EmailStr rejects "", so an empty email is sent as null.
    email: f.email.trim() || null,
    gstin: normalizeGstin(f.gstin),
    gst_registration: f.gst_registration,
    fssai: f.fssai.trim(),
    prices_include_tax: f.prices_include_tax,
    default_tax_rate: f.default_tax_rate,
    invoice_prefix: f.invoice_prefix.trim().toUpperCase(),
    receipt_footer: f.receipt_footer.trim(),
    upi_id: f.upi_id.trim(),
    loyalty_enabled: f.loyalty_enabled,
    loyalty_points_per_100: Math.round(toNum(f.loyalty_points_per_100)),
    loyalty_point_value: toNum(f.loyalty_point_value),
    store_enabled: f.store_enabled,
    qr_ordering_enabled: f.qr_ordering_enabled,
    low_stock_default: Math.round(toNum(f.low_stock_default)),
  };
}

const GST_REGISTRATIONS: { value: GstRegistration; label: string }[] = [
  { value: 'regular', label: 'Regular GST' },
  { value: 'composition', label: 'Composition' },
  { value: 'unregistered', label: 'Not registered' },
];

const NEEDS_GSTIN = 'Enter your GSTIN to bill as a GST-registered business, or choose “Not registered”';

/** GSTIN rules (mirror the server): a typed GSTIN must be valid; regular/composition need one once either field is changed. */
function gstinError(f: Form, initial: Form | null): string | undefined {
  const check = checkGstin(f.gstin);
  if (check.gstin && !check.ok) return check.error;
  const changed = !initial || normalizeGstin(initial.gstin) !== check.gstin || initial.gst_registration !== f.gst_registration;
  if (!check.gstin && f.gst_registration !== 'unregistered' && changed) return NEEDS_GSTIN;
  return undefined;
}

function validate(f: Form, initial: Form | null): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {};
  if (!f.business_name.trim()) e.business_name = 'Business name is required.';
  else if (f.business_name.trim().length > 100) e.business_name = 'Use 100 characters or fewer.';
  if (f.address.length > 300) e.address = 'Use 300 characters or fewer.';
  const phone = validatePhone(f.phone);
  if (phone) e.phone = phone;
  const email = validateEmail(f.email);
  if (email) e.email = email;
  const gstin = gstinError(f, initial);
  if (gstin) e.gstin = gstin;
  const fssai = validateFssai(f.fssai);
  if (fssai) e.fssai = fssai;
  if (!f.invoice_prefix.trim()) e.invoice_prefix = 'Invoice prefix is required.';
  else if (!INVOICE_PREFIX_PATTERN.test(f.invoice_prefix.trim())) e.invoice_prefix = 'Use 1 to 10 letters, numbers or dashes.';
  if (f.receipt_footer.length > 300) e.receipt_footer = 'Use 300 characters or fewer.';
  const upi = validateUpi(f.upi_id);
  if (upi) e.upi_id = upi;
  const pp = toNum(f.loyalty_points_per_100);
  if (!Number.isFinite(pp) || pp < 0 || pp > 100 || !Number.isInteger(pp)) e.loyalty_points_per_100 = 'Use a whole number from 0 to 100.';
  const pv = toNum(f.loyalty_point_value);
  if (!Number.isFinite(pv) || pv < 0 || pv > 100) e.loyalty_point_value = 'Use a value from 0 to 100.';
  const ls = toNum(f.low_stock_default);
  if (!Number.isFinite(ls) || ls < 0 || ls > 100000 || !Number.isInteger(ls)) e.low_stock_default = 'Use a whole number from 0 to 100000.';
  return e;
}

const SECTION_KEYS = ['profile', 'tax', 'payments', 'loyalty', 'online', 'inventory'] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

export default function BusinessSettingsScreen() {
  const role = useAuth((s) => s.session?.role ?? null);
  if (!can(role, 'manage')) {
    return (
      <SettingsFrame active="business" title="Business">
        <EmptyState icon="lock-closed-outline" title="Managers only" message="Ask the owner or a manager to change business settings." />
      </SettingsFrame>
    );
  }
  return <BusinessSettingsForm />;
}

function BusinessSettingsForm() {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const tenantId = useAuth((s) => s.session?.tenantId ?? '');
  const params = useLocalSearchParams<{ section?: string }>();
  const { data, error, loading, reload, setData } = useApi(() => adminApi.settings(), [], { refetchOnFocus: false });

  const [initial, setInitial] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const bodyOffset = useRef(0);
  const sectionY = useRef<Partial<Record<SectionKey, number>>>({});
  const scrolledFor = useRef<string | null>(null);

  useEffect(() => {
    if (data && !initial) {
      const f = toForm(data);
      setInitial(f);
      setForm(f);
    }
  }, [data, initial]);

  const dirty = useMemo(
    () => !!form && !!initial && JSON.stringify(toPayload(form)) !== JSON.stringify(toPayload(initial)),
    [form, initial],
  );
  const errors = useMemo(() => (form ? validate(form, initial) : {}), [form, initial]);

  // Browsers: warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty || typeof window === 'undefined') return undefined;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Deep links like /settings/business?section=payments jump to that section once the form has laid out.
  const scrollToSection = (key: string | undefined, force = false) => {
    if (!key || (!force && scrolledFor.current === key)) return;
    scrolledFor.current = key;
    const run = () => {
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.getElementById(`business-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const y = sectionY.current[key as SectionKey];
      if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, bodyOffset.current + y - 12), animated: true });
    };
    setTimeout(run, 250);
    setTimeout(run, 700); // again once fonts/images have settled the layout
  };
  const onSectionLayout = (key: SectionKey) => (y: number) => {
    sectionY.current[key] = y;
  };
  const loaded = !!form;
  useEffect(() => {
    if (loaded && params.section) scrollToSection(params.section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, params.section]);

  if (loading && !form) {
    // scrollRef is passed from the first render: react-native-web's ScrollView only reports its node to the ref it mounted with.
    return <SettingsFrame active="business" title="Business" scrollRef={scrollRef}><Loading label="Loading business settings" /></SettingsFrame>;
  }
  if (!form || !initial) {
    return <SettingsFrame active="business" title="Business" scrollRef={scrollRef}><ErrorState message={error ?? 'Could not load settings.'} onRetry={reload} /></SettingsFrame>;
  }

  const set = <K extends FieldKey>(key: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    if (serverErrors[key]) setServerErrors((s) => ({ ...s, [key]: undefined }));
  };
  const touch = (key: FieldKey) => () => setTouched((t) => ({ ...t, [key]: true }));
  const err = (key: FieldKey): string | undefined => serverErrors[key] ?? ((touched[key] || submitted) ? errors[key] : undefined);
  // A full 15-character GSTIN is checked while typing; a shorter one once the field is left.
  const gstinErr = serverErrors.gstin ?? ((touched.gstin || submitted || normalizeGstin(form.gstin).length >= 15) ? errors.gstin : undefined);
  const hasErrors = Object.keys(errors).length > 0;

  const save = async () => {
    setSubmitted(true);
    if (hasErrors) {
      toast.error('Fix the highlighted fields before saving.');
      const first = SECTION_KEYS.find((k) => sectionHasError(k, errors));
      if (first) {
        scrollToSection(first, true);
      }
      return;
    }
    setSaving(true);
    try {
      const payload = toPayload(form);
      // Only send the GST fields when they changed: the server re-checks them whenever they are sent.
      if (payload.gstin === normalizeGstin(initial.gstin)) delete payload.gstin;
      if (payload.gst_registration === initial.gst_registration) delete payload.gst_registration;
      const saved = await adminApi.updateSettings(payload);
      useData.getState().setSettings(saved);
      const f = toForm(saved);
      setData(saved);
      setInitial(f);
      setForm(f);
      setSubmitted(false);
      setTouched({});
      toast.success('Business settings saved');
      // Store / QR switches also flip the matching sales channels on the server.
      void syncNow();
    } catch (e) {
      const fields = fieldErrorsFrom(e) as Partial<Record<FieldKey, string>>;
      // GSTIN problems come back as a plain 422 message ("This GSTIN has a typo…"): show it under the field.
      if (e instanceof ApiError && e.status === 422 && !Object.keys(fields).length && /GSTIN|GST-registered|state code/i.test(e.message)) {
        fields.gstin = e.message;
        scrollToSection('tax', true);
      }
      setServerErrors(fields);
      toast.error(Object.keys(fields).length ? 'Some fields need attention.' : errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setForm(initial);
    setTouched({});
    setSubmitted(false);
    setServerErrors({});
  };

  const gst = checkGstin(form.gstin);
  const charges = chargesGst(form.gst_registration, form.gstin);
  const gstinCleared = !gst.gstin && !!normalizeGstin(initial.gstin) && form.gst_registration !== 'unregistered';
  const gstChanged = gst.gstin !== normalizeGstin(initial.gstin) || form.gst_registration !== initial.gst_registration;
  const gstStatus: { tone: 'success' | 'warning' | 'neutral' | 'danger'; icon: 'receipt' | 'alert-circle' | 'document-text-outline'; title: string; body: string } =
    form.gst_registration === 'regular'
      ? charges
        ? { tone: 'success', icon: 'receipt', title: 'GST is charged on your bills (Tax invoice)',
            body: `Bills show your GSTIN and the GST for each rate.${gst.state ? ` Registered in ${gst.state}.` : ''}` }
        : { tone: gstinCleared ? 'danger' : 'warning', icon: 'alert-circle',
            title: gst.gstin ? 'No GST on bills — fix your GSTIN' : 'No GST on bills — add your GSTIN',
            body: gstinCleared
              ? 'You removed the GSTIN. A regular GST business needs one. If you are not registered for GST, choose “Not registered” so bills become a Bill of Supply without GST.'
              : gst.gstin
                ? 'GST is only charged once the GSTIN is correct. Check it on your GST certificate.'
                : 'GST is only charged when a valid GSTIN is set. If you are not registered for GST, choose “Not registered”.' }
      : form.gst_registration === 'composition'
        ? { tone: 'neutral', icon: 'document-text-outline', title: 'Composition: Bill of Supply, no GST',
            body: 'Composition dealers don’t collect GST from customers. Your GSTIN is still printed on the bill.' }
        : { tone: 'neutral', icon: 'document-text-outline', title: 'Not registered: Bill of Supply, no GST',
            body: 'Bills don’t add GST. Add your GSTIN and choose Regular GST once you register.' };
  const upiValid = !!form.upi_id.trim() && !validateUpi(form.upi_id);
  const storeUrl = `${webAppOrigin()}/store/${tenantId}`;
  const pp = toNum(form.loyalty_points_per_100);
  const pv = toNum(form.loyalty_point_value);
  const loyaltyExample = Number.isFinite(pp) && Number.isFinite(pv)
    ? `A ₹500 bill earns ${Math.floor(5 * pp)} points, worth ₹${(Math.floor(5 * pp) * pv).toFixed(2).replace(/\.00$/, '')} off a later bill.`
    : 'Enter both values to see an example.';

  const printPoster = async () => {
    setPrinting(true);
    try {
      await printHtml(buildQrPosterHtml({
        title: `${form.business_name} online store`,
        heading: form.business_name || 'Order online',
        subheading: 'Scan to see the menu and order',
        url: storeUrl,
        footer: 'Powered by Tallyko',
      }));
    } catch (e) {
      toast.error(printErrorMessage(e));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <SettingsFrame
      active="business"
      title="Business"
      subtitle="Shown on bills, your online store and GST reports."
      dirty={dirty}
      scrollRef={scrollRef}
      onBodyOffset={(y) => { bodyOffset.current = y; }}
      footer={<SaveBar visible={dirty} saving={saving} onSave={save} onDiscard={discard} />}
    >
      {submitted && hasErrors ? (
        <Callout tone="danger" title="Some details need fixing">
          {`${Object.keys(errors).length} field${Object.keys(errors).length === 1 ? '' : 's'} below ${Object.keys(errors).length === 1 ? 'has' : 'have'} a problem. They are marked in red.`}
        </Callout>
      ) : null}

      <FormSection title="Profile" description="Your shop's name and contact details, printed at the top of every bill." onLayout={onSectionLayout('profile')} nativeID="business-profile">
        <Input label="Business name" required value={form.business_name} onChangeText={(v) => set('business_name', v)} onBlur={touch('business_name')}
          error={err('business_name')} maxLength={100} placeholder="e.g. Sharma Tiffin Centre" />
        <View style={{ gap: 6 }}>
          <Text variant="smallStrong" tone="muted">Business type</Text>
          <ChoiceChips value={form.business_type} options={BUSINESS_TYPES} onChange={(v) => set('business_type', v)} accessibilityLabel="Business type" />
          <Text variant="small" tone="subtle">Retail shops hide tables and the kitchen screen.</Text>
        </View>
        <Input label="Address" value={form.address} onChangeText={(v) => set('address', v)} onBlur={touch('address')} error={err('address')}
          multiline numberOfLines={2} maxLength={300} placeholder="Shop no, street, area, city, PIN" style={{ minHeight: 64, textAlignVertical: 'top' }} />
        <FieldRow>
          <Input label="Phone" value={form.phone} onChangeText={(v) => set('phone', v)} onBlur={touch('phone')} error={err('phone')}
            keyboardType="phone-pad" maxLength={20} placeholder="98765 43210" icon="call-outline" />
          <Input label="Email" value={form.email} onChangeText={(v) => set('email', v)} onBlur={touch('email')} error={err('email')}
            keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="hello@yourshop.in" icon="mail-outline" />
        </FieldRow>
      </FormSection>

      <FormSection title="GST & invoices" description="GST is added to bills only when you have a regular GST registration and a valid GSTIN." onLayout={onSectionLayout('tax')} nativeID="business-tax">
        <View style={{ gap: 6 }}>
          <Text variant="smallStrong" tone="muted">GST registration</Text>
          <ChoiceChips value={form.gst_registration} options={GST_REGISTRATIONS} onChange={(v) => set('gst_registration', v)} accessibilityLabel="GST registration" />
        </View>
        <FieldRow>
          <Input label="GSTIN" required={form.gst_registration !== 'unregistered'} value={form.gstin}
            onChangeText={(v) => set('gstin', v.toUpperCase().replace(/[^0-9A-Z]/g, ''))} onBlur={touch('gstin')}
            error={gstinErr}
            hint={gst.ok ? `Valid GSTIN · ${gst.state}` : gst.gstin ? `${gst.gstin.length}/15 characters` : '15 characters, from your GST certificate'}
            autoCapitalize="characters" autoCorrect={false} maxLength={15} placeholder="29ABCDE1234F1ZW"
            icon={gst.ok ? 'checkmark-circle' : 'document-text-outline'} />
          <Input label="FSSAI licence no." value={form.fssai} onChangeText={(v) => set('fssai', v.replace(/\s/g, ''))} onBlur={touch('fssai')}
            error={err('fssai')} hint="14 digits. Required on bills for food businesses." keyboardType="number-pad" maxLength={14} placeholder="12345678901234" />
        </FieldRow>
        <Callout tone={gstStatus.tone} icon={gstStatus.icon} title={`${gstStatus.title}${dirty && gstChanged && !errors.gstin ? ' (after you save)' : ''}`}
          action={gstinCleared && form.gst_registration === 'regular'
            ? <Button title="Choose “Not registered”" size="sm" variant="secondary" onPress={() => set('gst_registration', 'unregistered')} />
            : <Button title="GST rates & tax classes" size="sm" variant="ghost" iconRight="arrow-forward" onPress={() => router.navigate('/settings/taxes' as Href)} />}>
          {gstStatus.body}
        </Callout>
        <Hairline />
        <SettingSwitch title="Menu prices include GST" value={form.prices_include_tax} onValueChange={(v) => set('prices_include_tax', v)}
          subtitle={form.prices_include_tax
            ? 'A ₹100 item costs the customer ₹100; GST is worked out from inside the price.'
            : `A ₹100 item at ${form.default_tax_rate || 5}% GST costs the customer ₹${100 + (form.default_tax_rate || 5)}; GST is added on top.`} />
        <View style={{ gap: 6 }}>
          <Text variant="smallStrong" tone="muted">Default GST rate</Text>
          <ChoiceChips
            value={form.default_tax_rate}
            options={[...new Set([...GST_RATES, form.default_tax_rate])].sort((a, b) => a - b).map((r) => ({ value: r, label: `${r}%` }))}
            onChange={(v) => set('default_tax_rate', v)}
            accessibilityLabel="Default GST rate"
          />
          <Text variant="small" tone="subtle">Used for items that don't have their own rate. Most restaurants and cafés charge 5%.</Text>
        </View>
        <Hairline />
        <FieldRow>
          <Input label="Invoice prefix" required value={form.invoice_prefix} onChangeText={(v) => set('invoice_prefix', v.toUpperCase().replace(/\s/g, ''))}
            onBlur={touch('invoice_prefix')} error={err('invoice_prefix')} hint="Printed before each bill number. Letters, numbers and dashes."
            autoCapitalize="characters" maxLength={10} placeholder="INV" />
          <View />
        </FieldRow>
        <Input label="Bill footer" value={form.receipt_footer} onChangeText={(v) => set('receipt_footer', v)} onBlur={touch('receipt_footer')}
          error={err('receipt_footer')} hint={`${form.receipt_footer.length}/300 · Printed at the bottom of every bill, above "Thank you! Visit again."`} multiline maxLength={300}
          placeholder="e.g. Free home delivery within 3 km. Call 98765 43210" style={{ minHeight: 64, textAlignVertical: 'top' }} />
      </FormSection>

      <FormSection title="Payments" description="Your UPI ID is printed as a QR code on bills so customers can pay from any UPI app." onLayout={onSectionLayout('payments')} nativeID="business-payments">
        <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 16, alignItems: isPhone ? 'stretch' : 'flex-start' }}>
          <View style={{ flex: 1, gap: 12 }}>
            <Input label="UPI ID" value={form.upi_id} onChangeText={(v) => set('upi_id', v.trim())} onBlur={touch('upi_id')} error={err('upi_id')}
              hint="Use the UPI ID of your business bank account or merchant app." autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
              placeholder="yourshop@okaxis" icon="qr-code-outline" />
            {upiValid ? (
              <Text variant="small" tone="muted">Scan the preview with any UPI app to check it opens a payment to {form.business_name || 'your shop'}. Don't complete the payment.</Text>
            ) : null}
          </View>
          <View style={{ alignItems: 'center', gap: 6, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, minWidth: 180 }}>
            {upiValid ? (
              <>
                <View style={{ borderRadius: 8, overflow: 'hidden' }}>
                  <QrCode value={upiPayUrl(form.upi_id, form.business_name)} size={140} margin={3} />
                </View>
                <Text variant="caption" tone="muted">Preview · {form.upi_id}</Text>
              </>
            ) : (
              <View style={{ width: 152, height: 152, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Text variant="small" tone="subtle" align="center">{form.upi_id ? 'Fix the UPI ID to see the QR' : 'QR preview appears here'}</Text>
              </View>
            )}
          </View>
        </View>
      </FormSection>

      <FormSection title="Loyalty" description="Reward regulars with points they can redeem on a later bill. Customers are saved when a phone number is added to a bill." onLayout={onSectionLayout('loyalty')} nativeID="business-loyalty">
        <SettingSwitch title="Loyalty points" subtitle={form.loyalty_enabled ? 'Customers earn points on every paid bill.' : 'Turned off. No points are given or redeemed.'}
          value={form.loyalty_enabled} onValueChange={(v) => set('loyalty_enabled', v)} />
        {form.loyalty_enabled ? (
          <>
            <FieldRow>
              <Input label="Points per ₹100 spent" value={form.loyalty_points_per_100} onChangeText={(v) => set('loyalty_points_per_100', v.replace(/[^\d]/g, ''))}
                onBlur={touch('loyalty_points_per_100')} error={err('loyalty_points_per_100')} keyboardType="number-pad" maxLength={3} placeholder="1" />
              <Input label="Value of 1 point" prefix="₹" value={form.loyalty_point_value} onChangeText={(v) => set('loyalty_point_value', v.replace(/[^\d.]/g, ''))}
                onBlur={touch('loyalty_point_value')} error={err('loyalty_point_value')} keyboardType="decimal-pad" maxLength={6} placeholder="1" />
            </FieldRow>
            <Callout tone="neutral" icon="gift-outline">{loyaltyExample}</Callout>
          </>
        ) : null}
      </FormSection>

      <FormSection title="Online ordering" description="Let customers order from their phone. Orders arrive in Online orders and the kitchen." onLayout={onSectionLayout('online')} nativeID="business-online">
        <SettingSwitch title="Own online store" subtitle="A menu page customers can order from for takeaway or delivery. No commission."
          value={form.store_enabled} onValueChange={(v) => set('store_enabled', v)} />
        <SettingSwitch title="QR table ordering" subtitle="Guests scan the QR on their table and order without waiting. Print table QRs from Tables."
          value={form.qr_ordering_enabled} onValueChange={(v) => set('qr_ordering_enabled', v)} />
        {form.store_enabled || initial.store_enabled ? (
          <>
            <Hairline />
            <View style={{ flexDirection: isPhone ? 'column' : 'row', gap: 16, alignItems: isPhone ? 'stretch' : 'center' }}>
              <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text variant="smallStrong" tone="muted">Store link</Text>
                  {initial.store_enabled ? <Badge label="Live" tone="success" icon="radio-button-on" /> : <Badge label="Save to go live" tone="warning" />}
                </View>
                <Text selectable variant="bodyStrong" style={{ fontFamily: Platform.select({ web: 'ui-monospace, Menlo, Consolas, monospace', ios: 'Menlo', default: 'monospace' }), fontSize: 13 }}>{storeUrl}</Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Button title="Copy link" size="sm" variant="secondary" icon="copy-outline" onPress={() => copyText(storeUrl, 'Store link')} />
                  <Button title="Share" size="sm" variant="secondary" icon="share-social-outline" onPress={() => shareText(`Order from ${form.business_name} online: ${storeUrl}`, form.business_name)} />
                  <Button title="Print QR poster" size="sm" variant="secondary" icon="print-outline" loading={printing} onPress={printPoster} />
                </View>
                {Platform.OS === 'web' && /localhost|127\.0\.0\.1/.test(storeUrl) ? (
                  <Text variant="small" tone="warning">This link uses "localhost", so it only opens on this computer. Use your shop's public web address for customers.</Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'center', borderRadius: 10, overflow: 'hidden', alignSelf: 'center' }}>
                <QrCode value={storeUrl} size={136} margin={3} />
              </View>
            </View>
          </>
        ) : null}
      </FormSection>

      <FormSection title="Inventory" description="Items with stock tracking show a low-stock warning at this level unless the item has its own." onLayout={onSectionLayout('inventory')} nativeID="business-inventory">
        <FieldRow>
          <Input label="Low-stock alert at" value={form.low_stock_default} onChangeText={(v) => set('low_stock_default', v.replace(/[^\d]/g, ''))}
            onBlur={touch('low_stock_default')} error={err('low_stock_default')} keyboardType="number-pad" maxLength={6} hint="Units left in stock" />
          <View />
        </FieldRow>
        <Button title="Open inventory" variant="ghost" size="sm" iconRight="arrow-forward" onPress={() => router.navigate('/inventory' as Href)} style={{ alignSelf: 'flex-start' }} />
      </FormSection>
    </SettingsFrame>
  );
}

const SECTION_FIELDS: Record<SectionKey, FieldKey[]> = {
  profile: ['business_name', 'business_type', 'address', 'phone', 'email'],
  tax: ['gstin', 'gst_registration', 'fssai', 'prices_include_tax', 'default_tax_rate', 'invoice_prefix', 'receipt_footer'],
  payments: ['upi_id'],
  loyalty: ['loyalty_enabled', 'loyalty_points_per_100', 'loyalty_point_value'],
  online: ['store_enabled', 'qr_ordering_enabled'],
  inventory: ['low_stock_default'],
};

function sectionHasError(key: SectionKey, errors: Partial<Record<FieldKey, string>>): boolean {
  return SECTION_FIELDS[key].some((f) => !!errors[f]);
}
