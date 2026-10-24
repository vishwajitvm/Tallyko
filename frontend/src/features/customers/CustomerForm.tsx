import React, { useState } from 'react';
import { View } from 'react-native';
import { crmApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/client';
import type { Customer } from '@/api/types';
import { Button, Input, Sheet, Text, toast } from '@/components/ui';
import { useData } from '@/store/data';
import { Callout, FieldRow, SettingSwitch } from '@/features/settings/components';
import { fieldErrorsFrom, formatMobile, normaliseMobile, validateEmail } from '@/features/settings/validation';

/** Add or edit a customer. Managers can also correct loyalty points. */
export function CustomerFormSheet({ customer, canEditPoints, onClose, onSaved }: {
  customer?: Customer | null; canEditPoints: boolean; onClose: () => void; onSaved: (c: Customer) => void;
}) {
  const editing = !!customer;
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer ? formatMobile(customer.phone) : '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [optIn, setOptIn] = useState(!!customer?.marketing_opt_in);
  const [points, setPoints] = useState(customer ? String(customer.points) : '0');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const mobile = normaliseMobile(phone);
  // Numbers saved from old bills may not follow today's rules; don't block an edit that leaves the phone alone.
  const phoneUnchanged = !!customer && phone === formatMobile(customer.phone);
  const pointsNum = Number(points);
  const errors: Record<string, string | undefined> = {
    name: !name.trim() ? 'Name is required.' : name.trim().length > 100 ? 'Use 100 characters or fewer.' : undefined,
    phone: phoneUnchanged ? undefined : mobile.error,
    email: validateEmail(email),
    notes: notes.length > 500 ? 'Use 500 characters or fewer.' : undefined,
    points: editing && canEditPoints && (!/^\d+$/.test(points) || pointsNum > 10_000_000) ? 'Use a whole number of 0 or more.' : undefined,
  };
  const show = (k: string) => serverErrors[k] || (submitted || (k === 'phone' && phone.replace(/\D/g, '').length >= 10) ? errors[k] : undefined);
  const invalid = Object.values(errors).some(Boolean);

  const save = async () => {
    setSubmitted(true);
    setFormError(null);
    if (invalid || (!mobile.value && !phoneUnchanged)) return;
    setSaving(true);
    try {
      // Consent only makes sense with an email address; clearing the email withdraws it.
      const marketing = !!email.trim() && optIn;
      const body = {
        name: name.trim(), phone: phoneUnchanged ? customer!.phone : (mobile.value as string), email: email.trim() || null, notes: notes.trim() || null,
        marketing_opt_in: marketing,
      };
      let saved: Customer;
      if (customer) {
        const update: Partial<Customer> = {};
        if (body.name !== customer.name) update.name = body.name;
        if (!phoneUnchanged && body.phone !== customer.phone) update.phone = body.phone;
        if (body.email !== (customer.email ?? null)) update.email = body.email;
        if (body.notes !== (customer.notes ?? null)) update.notes = body.notes;
        if (marketing !== !!customer.marketing_opt_in) update.marketing_opt_in = marketing;
        if (canEditPoints && pointsNum !== customer.points) update.points = pointsNum;
        if (Object.keys(update).length === 0) {
          onClose();
          return;
        }
        saved = await crmApi.update(customer.id, update);
        toast.success('Customer updated');
      } else {
        saved = await crmApi.create(body);
        toast.success(`${saved.name} added`);
      }
      useData.getState().upsertCustomer(saved);
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setServerErrors({ phone: 'Another customer already has this phone number. Search for them instead.' });
      else {
        const fields = fieldErrorsFrom(e);
        setServerErrors(fields);
        if (!Object.keys(fields).length) setFormError(errorMessage(e));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={editing ? 'Edit customer' : 'Add customer'}
      subtitle={editing ? undefined : 'Customers are also saved automatically when you add a phone number to a bill.'} width={560}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={editing ? 'Save' : 'Add customer'} icon="checkmark" onPress={save} loading={saving} />
        </View>
      }>
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      <Input label="Name" required value={name} onChangeText={(v) => { setName(v); setServerErrors((s) => ({ ...s, name: '' })); }}
        error={show('name')} maxLength={100} placeholder="e.g. Priya Sharma" autoFocus={!editing} autoCapitalize="words" />
      <FieldRow>
        <Input label="Mobile number" required value={phone} onChangeText={(v) => { setPhone(v); setServerErrors((s) => ({ ...s, phone: '' })); }}
          error={show('phone')} keyboardType="phone-pad" maxLength={18} placeholder="98765 43210" icon="call-outline"
          hint="10-digit Indian mobile. Use +country code for other countries." />
        <Input label="Email (optional)" value={email} onChangeText={(v) => { setEmail(v); setServerErrors((s) => ({ ...s, email: '' })); }}
          error={show('email')} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="priya@example.com" icon="mail-outline" />
      </FieldRow>
      {email.trim() ? (
        <View style={{ gap: 8 }}>
          <SettingSwitch title="Customer agreed to receive offers by email" value={optIn} onValueChange={setOptIn}
            subtitle={optIn ? 'They will get your offer announcements by email.' : 'They only get receipts and rewards, not offers.'} />
          <Text variant="small" tone="subtle">Only switch this on if the customer said yes. Ask again if you're not sure — consent is required before sending offers.</Text>
        </View>
      ) : null}
      <Input label="Notes (optional)" value={notes} onChangeText={setNotes} error={show('notes')} multiline maxLength={500}
        placeholder="Allergies, favourite table, birthday…" hint={`${notes.length}/500 · Visible to staff only.`} style={{ minHeight: 72, textAlignVertical: 'top' }} />
      {editing && canEditPoints ? (
        <Input label="Loyalty points" value={points} onChangeText={(v) => setPoints(v.replace(/[^\d]/g, ''))} error={show('points')}
          keyboardType="number-pad" maxLength={8} hint="Change only to correct a mistake. Points are normally added and redeemed on bills." />
      ) : null}
    </Sheet>
  );
}
