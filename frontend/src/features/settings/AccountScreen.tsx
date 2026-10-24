import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { authApi } from '@/api/endpoints';
import { ApiError, errorMessage } from '@/api/client';
import { Badge, Button, Card, Input, ListRow, Segmented, Sheet, Text, confirm, toast } from '@/components/ui';
import { ServerField } from '@/components/ServerField';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useOutbox } from '@/store/outbox';
import { usePrefs } from '@/store/prefs';
import { syncNow } from '@/lib/sync';
import { endSession } from '@/lib/signOut';
import { DevicesSection } from '@/features/subscription/DevicesSection';
import { useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame } from './SettingsFrame';
import { Callout, FieldRow, FormSection } from './components';
import { ROLE_LABEL } from './sections';
import { validatePassword } from './validation';

function useUnsynced() {
  const tenantId = useAuth((s) => s.session?.tenantId);
  const queue = useOutbox((s) => s.queue);
  const mine = queue.filter((q) => q.tenantId === tenantId);
  return { pending: mine.filter((q) => !q.failed).length, failed: mine.filter((q) => q.failed).length, total: mine.length };
}

export default function AccountScreen() {
  const { colors } = useTheme();
  const session = useAuth((s) => s.session);
  const theme = usePrefs((s) => s.theme);
  const setPrefs = usePrefs((s) => s.set);
  const businessName = useData((s) => s.settings?.business_name) ?? session?.businessName ?? '';
  const me = useApi(() => authApi.me() as Promise<{ phone: string | null; full_name: string | null; email: string }>, [], { refetchOnFocus: false });
  const unsynced = useUnsynced();
  const [syncing, setSyncing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [devicesKey, setDevicesKey] = useState(0);

  const name = me.data?.full_name || session?.fullName || 'Your account';
  const email = me.data?.email || session?.email || '';
  const role = session?.role ?? null;

  const sync = async () => {
    setSyncing(true);
    try {
      await syncNow();
      const left = useOutbox.getState().queue.filter((q) => q.tenantId === session?.tenantId && !q.failed).length;
      if (left) toast.warning(`${left} bill${left === 1 ? '' : 's'} still waiting. Check the internet connection.`);
      else toast.success('Everything is synced');
    } finally {
      setSyncing(false);
    }
  };

  const signOut = async () => {
    const ok = await confirm({
      title: 'Sign out?',
      message: unsynced.total
        ? `${unsynced.total} bill${unsynced.total === 1 ? ' has' : 's have'} not reached the server yet. They stay saved on this device and sync after the next sign-in here, but it is safest to sync before signing out.`
        : 'You will need your email and password to sign in again.',
      confirmLabel: 'Sign out',
      danger: unsynced.total > 0,
    });
    if (!ok) return;
    setSigningOut(true);
    try {
      await endSession();
      router.replace('/login' as Href);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <SettingsFrame active="account" title="Account" subtitle="Your login on this device.">
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="h2" color={colors.primarySoftText}>{name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?'}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="h3" numberOfLines={1}>{name}</Text>
          <Text tone="muted" numberOfLines={1} selectable>{email}</Text>
          {me.data?.phone ? <Text variant="small" tone="subtle">{me.data.phone}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {role ? <Badge label={ROLE_LABEL[role]} tone={role === 'owner' ? 'accent' : 'primary'} /> : null}
          {businessName ? <Text variant="small" tone="muted" numberOfLines={1} style={{ maxWidth: 180 }}>{businessName}</Text> : null}
        </View>
      </Card>

      <ChangePassword onChanged={() => setDevicesKey((k) => k + 1)} />

      <DevicesSection refreshKey={devicesKey} />

      <FormSection title="Appearance" description="Applies to this device.">
        <Segmented value={theme} onChange={(v) => setPrefs({ theme: v })}
          options={[{ value: 'system', label: 'System', icon: 'phone-portrait-outline' }, { value: 'light', label: 'Light', icon: 'sunny-outline' }, { value: 'dark', label: 'Dark', icon: 'moon-outline' }]} />
        <Text variant="small" tone="subtle">System follows your device's light/dark setting.</Text>
      </FormSection>

      {Platform.OS !== 'web' || process.env.EXPO_PUBLIC_ALLOW_SERVER_CHANGE ? (
        <FormSection title="Server" description="The Tallyko server this app talks to. Change it only if whoever set up Tallyko asks you to.">
          <ServerField />
        </FormSection>
      ) : null}

      <FormSection title="Sign out" description="Signs out of this device only.">
        {unsynced.total ? (
          <Callout tone="warning" title={`${unsynced.total} bill${unsynced.total === 1 ? '' : 's'} not synced yet`}
            action={<Button title="Sync now" size="sm" icon="sync" variant="secondary" onPress={sync} loading={syncing} />}>
            {unsynced.failed
              ? `${unsynced.failed} need attention in Orders. The rest will upload when the internet is back. They are kept on this device if you sign out.`
              : 'They will upload when the internet is back. They are kept on this device if you sign out, but sync first to be safe.'}
          </Callout>
        ) : null}
        <Button title="Sign out" icon="log-out-outline" variant="secondary" onPress={signOut} loading={signingOut} style={{ alignSelf: 'flex-start' }} />
      </FormSection>

      <FormSection title="Privacy" description="What Tallyko stores and why.">
        <ListRow title="Privacy policy" subtitle="How your data and your customers' data is handled" icon="shield-checkmark-outline"
          onPress={() => router.push('/privacy' as Href)} />
      </FormSection>

      <FormSection title="Delete account" description="Permanently remove your login. This cannot be undone.">
        <Text tone="muted">
          {role === 'owner'
            ? `You are the owner, so deleting your account also closes ${businessName || 'this business'} for everyone.`
            : 'Your login is removed. The business and its records are not affected.'}
        </Text>
        <Button title="Delete my account…" icon="trash-outline" variant="dangerOutline" onPress={() => setDeleteOpen(true)} style={{ alignSelf: 'flex-start' }} />
      </FormSection>

      {deleteOpen ? <DeleteAccountSheet businessName={businessName} owner={role === 'owner'} unsynced={unsynced.total} onClose={() => setDeleteOpen(false)} /> : null}
    </SettingsFrame>
  );
}

function ChangePassword({ onChanged }: { onChanged?: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);

  const errors = {
    current: !current ? 'Enter your current password.' : undefined,
    next: validatePassword(next) ?? (next && next === current ? 'Choose a password different from the current one.' : undefined),
    again: !again ? 'Type the new password again.' : again !== next ? "Passwords don't match." : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);

  const save = async () => {
    setSubmitted(true);
    setCurrentError(null);
    if (invalid) return;
    setSaving(true);
    try {
      await authApi.changePassword(current, next);
      toast.success('Password changed. Other devices were signed out.');
      onChanged?.();
      setCurrent('');
      setNext('');
      setAgain('');
      setSubmitted(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setCurrentError(e.message);
      else toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const dirty = !!(current || next || again);
  return (
    <FormSection title="Password" description="Use at least 8 characters that are hard to guess. Don't reuse the password of your email.">
      <Input label="Current password" value={current} onChangeText={(v) => { setCurrent(v); setCurrentError(null); }} secureTextEntry
        autoComplete="current-password" textContentType="password" error={currentError ?? (submitted ? errors.current : undefined)} />
      <FieldRow>
        <Input label="New password" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" textContentType="newPassword"
          error={submitted || (next.length > 0 && next.length < 8 && again.length > 0) ? errors.next : undefined} maxLength={64}
          hint={next ? `${next.length} characters` : undefined} />
        <Input label="Confirm new password" value={again} onChangeText={setAgain} secureTextEntry autoComplete="new-password" textContentType="newPassword"
          error={submitted || (again.length >= next.length && again.length > 0) ? errors.again : undefined} maxLength={64} onSubmitEditing={save} />
      </FieldRow>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Change password" icon="key-outline" onPress={save} loading={saving} disabled={!dirty} />
        {dirty ? <Button title="Clear" variant="ghost" onPress={() => { setCurrent(''); setNext(''); setAgain(''); setSubmitted(false); setCurrentError(null); }} /> : null}
      </View>
    </FormSection>
  );
}

function DeleteAccountSheet({ businessName, owner, unsynced, onClose }: { businessName: string; owner: boolean; unsynced: number; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = password.length > 0 && typed.trim().toUpperCase() === 'DELETE';

  const remove = async () => {
    if (!ready) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await authApi.deleteAccount(password);
      await useAuth.getState().logout();
      useData.getState().reset();
      toast.success(result?.business_closed ? 'Your account was deleted and the business closed' : 'Your account was deleted');
      router.replace('/login' as Href);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 ? 'Password is incorrect.' : errorMessage(e));
      setDeleting(false);
    }
  };

  return (
    <Sheet visible onClose={deleting ? () => {} : onClose} dismissable={!deleting} title="Delete your account" width={520}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={deleting} />
          <Button title={owner ? 'Delete account and close business' : 'Delete my account'} variant="danger" icon="trash-outline" onPress={remove} loading={deleting} disabled={!ready} />
        </View>
      }>
      {owner ? (
        <Callout tone="danger" title={`This closes ${businessName || 'your business'}`}>
          <View style={{ gap: 4 }}>
            <Text variant="small">• Every staff login stops working and your online store goes offline.</Text>
            <Text variant="small">• Customer names, phone numbers, emails and notes are erased.</Text>
            <Text variant="small">• Your name, email and phone are erased.</Text>
            <Text variant="small">• Invoices and sales records are kept, anonymised, because GST law requires businesses to keep them.</Text>
          </View>
        </Callout>
      ) : (
        <Callout tone="warning" title="Your login will be removed">
          <View style={{ gap: 4 }}>
            <Text variant="small">• You can't sign in to {businessName || 'this business'} again.</Text>
            <Text variant="small">• Your name, email and phone are erased.</Text>
            <Text variant="small">• Bills you created stay in the business's records, as GST law requires.</Text>
          </View>
        </Callout>
      )}
      {unsynced ? (
        <Callout tone="warning">{`${unsynced} bill${unsynced === 1 ? ' on this device has' : 's on this device have'} not been synced and will be lost. Cancel and sync first if you need them.`}</Callout>
      ) : null}
      <Input label="Your password" value={password} onChangeText={(v) => { setPassword(v); setError(null); }} secureTextEntry autoComplete="current-password" error={error} />
      <Input label='Type DELETE to confirm' value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} placeholder="DELETE"
        hint="This can't be undone." onSubmitEditing={remove} />
      <Text variant="small" tone="subtle">Read more in the privacy policy, or ask your shop owner if you only want to leave the business.</Text>
    </Sheet>
  );
}
