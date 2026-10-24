/** Settings → Account → "Signed-in devices": where this login is signed in, with "Sign out" per device. */
import React, { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage } from '@/api/client';
import { sessionsApi, type DeviceSession } from '@/api/subscription';
import { Badge, Button, ErrorState, Loading, Text, confirm, toast } from '@/components/ui';
import { FormSection, Hairline } from '@/features/settings/components';
import { useApi } from '@/hooks/useApi';
import { ago, formatDateTime } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

function deviceIcon(device: string): React.ComponentProps<typeof Ionicons>['name'] {
  if (/android|iphone|ipad|app/i.test(device)) return 'phone-portrait-outline';
  if (/windows|mac|linux|chrome|edge|firefox|safari|browser/i.test(device)) return 'desktop-outline';
  return 'hardware-chip-outline';
}

function DeviceRow({ s, busy, onSignOut }: { s: DeviceSession; busy: boolean; onSignOut: () => void }) {
  const { colors } = useTheme();
  const seen = s.last_seen_at ?? s.created_at;
  const seenText = ago(seen);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={deviceIcon(s.device)} size={18} color={colors.textMuted} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{s.device || 'Unknown device'}</Text>
          {s.current ? <Badge label="This device" tone="primary" /> : null}
        </View>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {s.current ? 'Active now' : `Last active ${seenText === 'just now' ? 'just now' : `${seenText} ago`}`}
          {s.ip ? ` · ${s.ip}` : ''} · Signed in {formatDateTime(s.created_at)}
        </Text>
      </View>
      {!s.current ? <Button title="Sign out" size="sm" variant="secondary" onPress={onSignOut} loading={busy} /> : null}
    </View>
  );
}

export function DevicesSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const list = useApi(() => sessionsApi.list(), [refreshKey], { refetchOnFocus: true });
  const [busyId, setBusyId] = useState<string | null>(null);
  const sessions = [...(list.data ?? [])].sort((a, b) => Number(b.current) - Number(a.current)); // this device first
  const others = sessions.filter((s) => !s.current);

  const signOutDevice = async (s: DeviceSession) => {
    const ok = await confirm({
      title: 'Sign out this device?',
      message: `${s.device || 'This device'} will be signed out right away. Bills it saved offline stay on it and sync after someone signs in there again.`,
      confirmLabel: 'Sign out device',
      danger: true,
    });
    if (!ok) return;
    setBusyId(s.id);
    try {
      await sessionsApi.signOutDevice(s.id);
      list.setData((prev) => (prev ?? []).filter((x) => x.id !== s.id));
      toast.success('Device signed out');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const signOutOthers = async () => {
    const ok = await confirm({
      title: `Sign out ${others.length} other device${others.length === 1 ? '' : 's'}?`,
      message: 'Every other device using your login is signed out right away. This device stays signed in.',
      confirmLabel: 'Sign out others',
      danger: true,
    });
    if (!ok) return;
    setBusyId('others');
    let failed = 0;
    for (const s of others) {
      try {
        await sessionsApi.signOutDevice(s.id);
      } catch {
        failed += 1;
      }
    }
    setBusyId(null);
    if (failed) toast.error(`${failed} device${failed === 1 ? '' : 's'} could not be signed out. Try again.`);
    else toast.success('Other devices signed out');
    void list.silentReload();
  };

  return (
    <FormSection title="Signed-in devices" description="Where your login is signed in. Changing your password signs out every other device."
      right={others.length > 1 ? <Button title="Sign out all others" size="sm" variant="ghost" onPress={signOutOthers} loading={busyId === 'others'} /> : undefined}>
      {list.loading && !list.data ? <Loading /> : null}
      {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
      {list.data && !sessions.length ? <Text tone="muted">No other devices are signed in.</Text> : null}
      {sessions.map((s, i) => (
        <View key={s.id} style={{ gap: 10 }}>
          {i > 0 ? <Hairline /> : null}
          <DeviceRow s={s} busy={busyId === s.id} onSignOut={() => void signOutDevice(s)} />
        </View>
      ))}
    </FormSection>
  );
}
