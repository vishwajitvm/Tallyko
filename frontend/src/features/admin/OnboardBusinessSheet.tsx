/**
 * Onboard a business for a customer who bought Tallyko, then show the owner's temporary password once (copy / share).
 * Also exports the one-time credentials sheet used after "Reset owner password".
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { errorMessage } from '@/api/client';
import { platformApi, type BusinessCreated, type PlanInfo } from '@/api/platform';
import type { BusinessType } from '@/api/types';
import { Button, Card, Input, Sheet, Text, toast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { Callout, ChoiceChips, FieldRow, SettingSwitch, copyText, shareText } from '@/features/settings/components';
import { fieldErrorsFrom, validateEmail, validatePhone } from '@/features/settings/validation';
import { BUSINESS_TYPES, BUSINESS_TYPE_LABEL, goTo, useOnline } from './shared';

export function OnboardBusinessSheet({ plans, onClose, onDone }: { plans: PlanInfo[]; onClose: () => void; onDone?: (created: BusinessCreated) => void }) {
  const online = useOnline();
  const activePlans = useMemo(() => plans.filter((p) => p.is_active), [plans]);
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('restaurant');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [planKey, setPlanKey] = useState<string>(activePlans.find((p) => p.key === 'standard')?.key ?? activePlans[0]?.key ?? 'pro');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<(BusinessCreated & { name: string }) | null>(null);
  const settings = useApi(() => platformApi.settings(), [], { refetchOnFocus: false });
  const defaultDays = settings.data?.trial_days ?? null;
  /** '' = the platform default */
  const [demo, setDemo] = useState('');
  const [development, setDevelopment] = useState(false);
  const demoNum = demo.trim() === '' ? null : Number(demo.trim());

  // Plans may finish loading after the sheet opens: make sure a real plan is selected
  useEffect(() => {
    if (activePlans.length && !activePlans.some((p) => p.key === planKey)) {
      setPlanKey(activePlans.find((p) => p.key === 'standard')?.key ?? activePlans[0]!.key);
    }
  }, [activePlans, planKey]);

  const errors: Record<string, string | undefined> = {
    business_name: businessName.trim().length < 2 ? 'Enter the business name (at least 2 characters).' : undefined,
    owner_name: !ownerName.trim() ? "Enter the owner's name." : undefined,
    owner_email: validateEmail(ownerEmail, true),
    owner_phone: validatePhone(ownerPhone, true),
    demo_days: demoNum !== null && !(Number.isInteger(demoNum) && demoNum >= 0 && demoNum <= 365) ? '0–365 days.' : undefined,
  };
  const show = (k: string) => serverErrors[k] || (submitted ? errors[k] : undefined);
  const clear = (k: string) => setServerErrors((s) => ({ ...s, [k]: '' }));

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (Object.values(errors).some(Boolean)) return;
    setSaving(true);
    try {
      const result = await platformApi.createBusiness({
        business_name: businessName.trim(), business_type: businessType, owner_name: ownerName.trim(),
        owner_email: ownerEmail.trim().toLowerCase(), owner_phone: ownerPhone.replace(/-/g, ' ').trim(), plan_key: planKey,
        demo_days: development ? undefined : demoNum, development,
      });
      toast.success(`${businessName.trim()} is on Tallyko`);
      setCreated({ ...result, name: businessName.trim() });
      onDone?.(result);
    } catch (e) {
      setServerErrors(fieldErrorsFrom(e));
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    return (
      <CredentialsSheet
        title="Business onboarded"
        heading={`${created.name} is ready`}
        message="Send the owner these sign-in details privately. They should change the password after signing in."
        email={created.owner_email}
        password={created.temporary_password}
        onClose={onClose}
        extraAction={<Button title="Open business" variant="secondary" icon="open-outline" onPress={() => { onClose(); goTo(`/admin/businesses/${created.id}`); }} />}
      />
    );
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Onboard a business"
      subtitle="Creates the business and its owner login. Tallyko generates a temporary password."
      width={640}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title="Create business" icon="storefront-outline" onPress={submit} loading={saving} disabled={!online} />
        </View>
      }
    >
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      {!online ? <Callout tone="warning">You're offline. Connect to the internet to onboard a business.</Callout> : null}
      <Input label="Business name" required value={businessName} onChangeText={(v) => { setBusinessName(v); clear('vendor_name'); }}
        error={show('business_name') || serverErrors.vendor_name} maxLength={100} placeholder="e.g. Sharma Sweets" autoFocus />
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Business type</Text>
        <ChoiceChips value={businessType} onChange={setBusinessType} accessibilityLabel="Business type"
          options={BUSINESS_TYPES.map((t) => ({ value: t, label: BUSINESS_TYPE_LABEL[t] ?? t }))} />
      </View>
      <FieldRow>
        <Input label="Owner name" required value={ownerName} onChangeText={(v) => { setOwnerName(v); clear('owner_name'); }}
          error={show('owner_name')} maxLength={80} placeholder="e.g. Rakesh Sharma" />
        <Input label="Owner phone" required value={ownerPhone} onChangeText={(v) => { setOwnerPhone(v); clear('owner_phone'); }}
          error={show('owner_phone')} keyboardType="phone-pad" maxLength={16} placeholder="98765 43210" />
      </FieldRow>
      <Input label="Owner email (used to sign in)" required value={ownerEmail} onChangeText={(v) => { setOwnerEmail(v); clear('owner_email'); clear('email'); }}
        error={show('owner_email') || serverErrors.email} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="owner@business.in" />
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Plan</Text>
        {activePlans.length ? (
          <ChoiceChips value={planKey} onChange={setPlanKey} accessibilityLabel="Plan"
            options={activePlans.map((p) => ({ value: p.key, label: p.price_monthly ? `${p.name} · ₹${p.price_monthly.toLocaleString('en-IN')}/mo` : p.name }))} />
        ) : <Text variant="small" tone="subtle">Plans are loading; the business starts on the default plan.</Text>}
      </View>
      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Free demo</Text>
        {development ? (
          <Text variant="small" tone="subtle">Not needed: development access has no expiry.</Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}>
              <ChoiceChips value={demo} onChange={setDemo} accessibilityLabel="Demo length"
                options={[
                  { value: '', label: defaultDays === null ? 'Default' : `Default · ${defaultDays ? `${defaultDays} days` : 'none'}` },
                  { value: '0', label: 'No demo' }, { value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' },
                ]} />
              <Input value={demo} onChangeText={(v) => setDemo(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={3} placeholder="Days"
                containerStyle={{ width: 84 }} accessibilityLabel="Custom demo days" error={show('demo_days') ? ' ' : undefined} />
            </View>
            {show('demo_days') ? <Text variant="small" tone="danger">{show('demo_days')}</Text> : (
              <Text variant="small" tone="subtle">
                {(demoNum ?? defaultDays) === 0
                  ? 'No demo: the business is locked until you record the first payment.'
                  : 'The business works free for the demo, then locks until a payment is recorded.'}
              </Text>
            )}
          </>
        )}
      </View>
      <SettingSwitch title="Development access" value={development} onValueChange={setDevelopment}
        subtitle="For internal or pilot owners: works with no expiry until you switch it off on the business page." />
    </Sheet>
  );
}

/** Shows a temporary password exactly once, with copy and share. */
export function CredentialsSheet({ title, heading, message, email, password, onClose, extraAction }: {
  title: string; heading: string; message: string; email: string; password: string | null; onClose: () => void; extraAction?: React.ReactNode;
}) {
  const text = `Tallyko sign-in\nEmail: ${email}${password ? `\nTemporary password: ${password}` : ''}\nPlease change the password after signing in (Settings → Account).`;
  return (
    <Sheet visible onClose={onClose} title={title} subtitle={password ? 'This password is shown only once.' : undefined} width={500}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {extraAction}
          <Button title="Share" variant="secondary" icon="share-social-outline" onPress={() => shareText(text, 'Tallyko sign-in')} />
          <Button title="Copy" variant="secondary" icon="copy-outline" onPress={() => copyText(text, 'Sign-in details')} />
          <Button title="Done" onPress={onClose} />
        </View>
      }>
      <Callout tone="success" title={heading}>{message}</Callout>
      <Card style={{ gap: 8 }}>
        <Text variant="small" tone="muted">Email</Text>
        <Text variant="bodyStrong" selectable>{email}</Text>
        {password ? (
          <>
            <Text variant="small" tone="muted" style={{ marginTop: 6 }}>Temporary password</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text variant="h2" selectable style={{ letterSpacing: 1, flex: 1 }}>{password}</Text>
              <Button icon="copy-outline" size="sm" variant="ghost" accessibilityLabel="Copy password" onPress={() => copyText(password, 'Password')} />
            </View>
          </>
        ) : null}
      </Card>
    </Sheet>
  );
}
