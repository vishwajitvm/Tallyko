import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { adminApi } from '@/api/endpoints';
import type { BusinessType } from '@/api/types';
import { Badge, Card, ListRow, SectionTitle, StatusPill, Text } from '@/components/ui';
import { useAccessLine } from '@/components/nav/shellStatus';
import { useApi } from '@/hooks/useApi';
import { can, useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { usePrefs } from '@/store/prefs';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame, SettingsSearch, useSettingsSections } from './SettingsFrame';
import { StatusDot, serverOrigin } from './components';
import { ROLE_LABEL } from './sections';

const TYPE_LABEL: Record<BusinessType, string> = { restaurant: 'Restaurant', cafe: 'Café', cloud_kitchen: 'Cloud kitchen', retail: 'Retail shop' };

const go = (href: string) => router.push(href as Href);

export default function SettingsHome() {
  const { isDesktop, isWide } = useLayout();
  const session = useAuth((s) => s.session);
  const role = session?.role ?? null;
  const manager = can(role, 'manage');
  const settings = useData((s) => s.settings);
  const channels = useData((s) => s.channels);
  const printer = usePrefs((s) => s.printer);
  const theme = usePrefs((s) => s.theme);
  const businessName = settings?.business_name || session?.businessName || 'Your business';
  const liveChannels = channels.filter((c) => c.enabled && c.code !== 'POS').length;

  const sections = useSettingsSections();
  const [query, setQuery] = useState('');
  const accessLine = useAccessLine();
  const has = (key: string) => sections.some((x) => x.key === key);
  const extra = sections.filter((x) => ['taxes', 'qr', 'floor', 'emails', 'modules', 'billing'].includes(x.key));

  return (
    <SettingsFrame active="overview" title="Settings" subtitle={isDesktop ? `${businessName} · signed in as ${role ? ROLE_LABEL[role] : ''}` : businessName}>
      {!isWide ? <SettingsSearch query={query} onQuery={setQuery} sections={sections} onOpen={go} compact /> : null}

      {query.trim() && !isWide ? null : (
      <>
      {manager ? <SetupChecklist /> : null}

      {!isWide ? (
        <>
          {manager && has('business') ? (
            <Group title="Business">
              <ListRow icon="storefront-outline" title="Business profile" subtitle={settings ? `${TYPE_LABEL[settings.business_type]} · ${settings.address || 'No address yet'}` : 'Name, address, contact'}
                onPress={() => go('/settings/business?section=profile')} />
              <ListRow icon="document-text-outline" title="GST & invoices" subtitle={settings?.gstin ? `GSTIN ${settings.gstin}` : 'GSTIN, FSSAI, tax rate, bill footer'}
                onPress={() => go('/settings/business?section=tax')} />
              <ListRow icon="qr-code-outline" title="Payments & UPI" subtitle={settings?.upi_id || 'Add a UPI ID for payment QR on bills'}
                onPress={() => go('/settings/business?section=payments')} />
              <ListRow icon="gift-outline" title="Loyalty" subtitle={settings?.loyalty_enabled ? `On · ${settings.loyalty_points_per_100} point${settings.loyalty_points_per_100 === 1 ? "" : "s"} per ₹100` : 'Off'}
                onPress={() => go('/settings/business?section=loyalty')} />
              <ListRow icon="globe-outline" title="Online ordering" subtitle={onlineSummary(settings?.store_enabled, settings?.qr_ordering_enabled)}
                onPress={() => go('/settings/business?section=online')} />
            </Group>
          ) : null}

          <Group title="This device">
            <ListRow icon="print-outline" title="Printers & receipts" subtitle={printer ? `Bills print on ${printer.name}` : 'Using the print dialog'} onPress={() => go('/settings/printers')} />
          </Group>

          {has('channels') || has('brands') || has('staff') ? (
            <Group title="Selling & team">
              {has('channels') ? <ListRow icon="git-network-outline" title="Sales channels" subtitle={liveChannels ? `${liveChannels} channel${liveChannels === 1 ? '' : 's'} on · Swiggy, Zomato, ONDC…` : 'Swiggy, Zomato, ONDC, magicpin, QR, store'}
                onPress={() => go('/settings/channels')} /> : null}
              {has('brands') ? <ListRow icon="pricetags-outline" title="Brands" subtitle="Virtual brands for cloud kitchens" onPress={() => go('/settings/brands')} /> : null}
              {has('staff') ? <ListRow icon="people-outline" title="Staff & roles" subtitle="Logins for cashiers, waiters and kitchen" onPress={() => go('/settings/staff')} /> : null}
            </Group>
          ) : null}

          {extra.length ? (
            <Group title="More settings">
              {extra.map((x) => (
                <ListRow key={x.key} icon={x.icon} title={x.label} subtitle={x.key === 'billing' && accessLine ? accessLine.label : x.description} onPress={() => go(x.href)}
                  right={x.key === 'billing' && accessLine ? <StatusPill status={accessLine.status} label={accessLine.status === 'development' ? 'Dev' : undefined} /> : undefined} />
              ))}
            </Group>
          ) : null}

          <Group title="You">
            <ListRow icon="person-circle-outline" title="Account" subtitle={`${session?.email ?? ''} · ${theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light'} theme`}
              onPress={() => go('/settings/account')} />
          </Group>
        </>
      ) : (
        <QuickLinks manager={manager} printerName={printer?.name ?? null} liveChannels={liveChannels} />
      )}

      <About />
      </>
      )}
    </SettingsFrame>
  );
}

function onlineSummary(store?: boolean, qr?: boolean) {
  if (store && qr) return 'Online store and QR table ordering are on';
  if (store) return 'Online store is on';
  if (qr) return 'QR table ordering is on';
  return 'Own store and QR table ordering are off';
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <SectionTitle title={title} />
      <Card padded={false} style={{ padding: 4 }}>{children}</Card>
    </View>
  );
}

function SetupChecklist() {
  const { colors } = useTheme();
  const { isDesktop } = useLayout();
  const settings = useData((s) => s.settings);
  const printer = usePrefs((s) => s.printer);
  const staff = useApi(() => adminApi.staff(), [], { refetchOnFocus: true });
  if (!settings) return null;

  const items = [
    { key: 'profile', title: 'Add your address and phone', detail: 'Printed at the top of every bill.', done: !!settings.address && !!settings.phone, href: '/settings/business?section=profile' },
    { key: 'gst', title: 'Add GSTIN and FSSAI', detail: 'Optional if you are not GST registered.', done: !!settings.gstin || !!settings.fssai, optional: true, href: '/settings/business?section=tax' },
    { key: 'upi', title: 'Add your UPI ID', detail: 'Customers scan the QR on the bill to pay.', done: !!settings.upi_id, href: '/settings/business?section=payments' },
    { key: 'printer', title: 'Connect a receipt printer', detail: 'On this device. Bills use the print dialog until then.', done: !!printer, optional: true, href: '/settings/printers' },
    { key: 'staff', title: 'Add staff logins', detail: 'So each bill shows who made it.', done: (staff.data?.length ?? 0) > 1, optional: true, href: '/settings/staff' },
    { key: 'online', title: 'Take orders online', detail: 'Own store or QR table ordering, with no commission.', done: settings.store_enabled || settings.qr_ordering_enabled, optional: true, href: '/settings/business?section=online' },
  ];
  const done = items.filter((i) => i.done).length;
  const todo = items.filter((i) => !i.done);
  if (!isDesktop && todo.length === 0) return null;
  const shown = isDesktop ? items : todo.slice(0, 3);

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="h3">{done === items.length ? 'Your shop is fully set up' : 'Finish setting up'}</Text>
          <Text variant="small" tone="muted">{done} of {items.length} done</Text>
        </View>
        {done === items.length ? <Badge label="All done" tone="success" icon="checkmark" /> : null}
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken, overflow: 'hidden' }}
        accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: items.length, now: done }}>
        <View style={{ width: `${(done / items.length) * 100}%`, height: 6, backgroundColor: colors.success }} />
      </View>
      <View style={{ gap: 0 }}>
        {shown.map((i) => (
          <ListRow key={i.key} title={i.title} subtitle={i.detail} left={<StatusDot ok={i.done} />}
            right={i.done ? <Text variant="small" tone="success">Done</Text> : i.optional ? <Text variant="small" tone="subtle">Optional</Text> : <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />}
            onPress={() => go(i.href)} />
        ))}
      </View>
    </Card>
  );
}

function QuickLinks({ manager, printerName, liveChannels }: { manager: boolean; printerName: string | null; liveChannels: number }) {
  const { colors } = useTheme();
  const tiles = [
    ...(manager ? [{ icon: 'storefront-outline' as const, title: 'Business', detail: 'Profile, GST, UPI, loyalty, online ordering', href: '/settings/business' }] : []),
    { icon: 'print-outline' as const, title: 'Printers & receipts', detail: printerName ? `Bills print on ${printerName}` : 'Using the print dialog', href: '/settings/printers' },
    ...(manager ? [
      { icon: 'git-network-outline' as const, title: 'Sales channels', detail: liveChannels ? `${liveChannels} on` : 'Swiggy, Zomato, ONDC, magicpin', href: '/settings/channels' },
      { icon: 'pricetags-outline' as const, title: 'Brands', detail: 'Virtual brands for cloud kitchens', href: '/settings/brands' },
      { icon: 'people-outline' as const, title: 'Staff & roles', detail: 'Logins and permissions', href: '/settings/staff' },
    ] : []),
    { icon: 'person-circle-outline' as const, title: 'Account', detail: 'Password, appearance, sign out', href: '/settings/account' },
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {tiles.map((t) => (
        <Card key={t.href} onPress={() => router.replace(t.href as Href)} style={{ flexBasis: 260, flexGrow: 1, gap: 8 }}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={t.icon} size={18} color={colors.primarySoftText} />
          </View>
          <Text variant="bodyStrong">{t.title}</Text>
          <Text variant="small" tone="muted" numberOfLines={2}>{t.detail}</Text>
        </Card>
      ))}
    </View>
  );
}

function About() {
  const version = Constants.expoConfig?.version ?? '—';
  const build = Platform.OS === 'ios' ? Constants.expoConfig?.ios?.buildNumber : Platform.OS === 'android' ? Constants.expoConfig?.android?.versionCode : null;
  const platform = Platform.OS === 'web' ? 'Web app' : Platform.OS === 'ios' ? 'iPhone / iPad app' : 'Android app';
  return (
    <Group title="About">
      <ListRow icon="information-circle-outline" title={`Tallyko ${version}${build ? ` (${build})` : ''}`} subtitle={platform} />
      <ListRow icon="server-outline" title="Server" subtitle={serverOrigin()} />
      <ListRow icon="shield-checkmark-outline" title="Privacy policy" subtitle="What we store and how to delete it" onPress={() => go('/privacy')} />
    </Group>
  );
}
