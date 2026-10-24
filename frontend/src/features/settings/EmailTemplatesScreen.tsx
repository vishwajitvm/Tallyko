/**
 * Settings › Customer emails: is sending set up, business-wide switches (on/off, sender name, reply-to),
 * the four templates with a live preview editor, and the delivery log.
 */
import React, { useEffect, useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { errorMessage, isOffline } from '@/api/client';
import { emailApi, type EmailTemplate, type EmailTemplateKey } from '@/api/email';
import { adminApi } from '@/api/endpoints';
import type { BusinessSettings } from '@/api/types';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Loading, Segmented, Text, toast } from '@/components/ui';
import { TopDialogHost, confirmTop } from '@/features/catalog/dialogs';
import { useApi } from '@/hooks/useApi';
import { getServerUrl } from '@/store/prefs';
import { hasAccess, useAccessInfo } from '@/store/access';
import { can, useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { SettingsFrame } from './SettingsFrame';
import { Callout, FieldRow, FormSection, Hairline, SettingSwitch } from './components';
import { validateEmail } from './validation';
import { DeliveryLog } from './email/DeliveryLog';
import { TemplateEditor } from './email/TemplateEditor';
import { useCanManageTaxes as useCanManageSettings, useOnline } from './taxes/shared';

const TEMPLATE_ICON: Record<EmailTemplateKey, keyof typeof Ionicons.glyphMap> = {
  loyalty_reward: 'gift-outline',
  offer_announcement: 'megaphone-outline',
  order_receipt: 'receipt-outline',
  welcome: 'hand-left-outline',
};

const MAILPIT_URL = 'http://localhost:8025';

function isLocalServer(): boolean {
  return /localhost|127\.0\.0\.1|10\.0\.2\.2/.test(getServerUrl());
}

export default function EmailTemplatesScreen() {
  const info = useAccessInfo();
  const role = useAuth((s) => s.session?.role ?? null);
  if (info && !info.features.includes('email')) {
    return (
      <SettingsFrame active="emails" title="Customer emails">
        <EmptyState icon="mail-unread-outline" title="Not in your plan" message="Customer emails aren't included in your current plan. See Modules & plan to upgrade." />
      </SettingsFrame>
    );
  }
  const allowed = hasAccess(info, { permissions: ['email.manage'], feature: 'email' }) ?? can(role, 'manage');
  if (!allowed) {
    return (
      <SettingsFrame active="emails" title="Customer emails">
        <EmptyState icon="lock-closed-outline" title="Managers only" message="Ask the owner or a manager to change customer emails." />
      </SettingsFrame>
    );
  }
  return <EmailSettings />;
}

function EmailSettings() {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const online = useOnline();
  const canSettings = useCanManageSettings();
  const userEmail = useAuth((s) => s.session?.email ?? '');
  const status = useApi(() => emailApi.status(), [], { refetchOnFocus: false });
  const templates = useApi(() => emailApi.templates(), []);
  const settingsReq = useApi(() => adminApi.settings(), [], { refetchOnFocus: false });
  const cachedSettings = useData((s) => s.settings);
  const settings: BusinessSettings | null = settingsReq.data ?? cachedSettings;

  const [tab, setTab] = useState<'templates' | 'log'>('templates');
  const [selected, setSelected] = useState<EmailTemplateKey | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [senderName, setSenderName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [busy, setBusy] = useState<null | 'enabled' | 'sender'>(null);

  useEffect(() => {
    if (!settings) return;
    setSenderName(settings.email_sender_name ?? '');
    setReplyTo(settings.email_reply_to ?? '');
  }, [settings?.email_sender_name, settings?.email_reply_to]); // eslint-disable-line react-hooks/exhaustive-deps

  const senderDirty = !!settings && (senderName.trim() !== (settings.email_sender_name ?? '') || replyTo.trim() !== (settings.email_reply_to ?? ''));
  const replyError = replyTo.trim() ? validateEmail(replyTo.trim()) : undefined;
  const dirty = editorDirty || senderDirty;
  const enabled = settings?.email_enabled !== false;

  const saveSettings = async (key: 'enabled' | 'sender', body: Partial<BusinessSettings>, ok: string) => {
    setBusy(key);
    try {
      const saved = await adminApi.updateSettings(body);
      settingsReq.setData(saved);
      useData.getState().setSettings(saved);
      toast.success(ok);
    } catch (e) {
      toast.error(isOffline(e) ? "You're offline. Try again when you're connected." : errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const openTemplate = async (key: EmailTemplateKey | null) => {
    if (editorDirty && !(await confirmTop({ title: 'Discard unsaved changes?', message: 'Your changes to this email have not been saved.', confirmLabel: 'Discard', danger: true }))) return;
    setEditorDirty(false);
    setSelected(key);
  };

  const reloadAll = () => {
    void status.reload();
    void templates.reload();
    void settingsReq.reload();
  };

  const list = templates.data ?? [];
  const current = list.find((t) => t.key === selected) ?? null;
  const placeholders = status.data?.placeholders ?? [];
  const local = isLocalServer();

  const statusBanner = status.loading && !status.data ? null : !status.data ? (
    <Callout tone="warning" title="Couldn't check email setup" action={<Button title="Try again" size="sm" variant="secondary" icon="refresh" onPress={status.reload} />}>
      {status.error ?? 'Unknown error'}
    </Callout>
  ) : status.data.configured ? (
    <Callout tone="success" icon="mail-outline" title="Email sending is set up"
      action={local && Platform.OS === 'web' ? <Button title="Open Mailpit" size="sm" variant="secondary" icon="open-outline" onPress={() => void Linking.openURL(MAILPIT_URL)} /> : undefined}>
      {local
        ? `Development server: every email is caught by Mailpit at ${MAILPIT_URL} instead of reaching real customers.`
        : 'Customers who share their email get the emails you switch on below.'}
    </Callout>
  ) : (
    <Callout tone="warning" title="Email sending isn't set up on the server">
      {'Emails are logged as "skipped" until the server administrator sets SMTP_HOST (and login details) in the server settings. You can still edit and preview templates.'}
    </Callout>
  );

  return (
    <SettingsFrame active="emails" title="Customer emails" subtitle="Rewards, offers, welcome notes and e-receipts sent from your business."
      dirty={dirty} maxWidth={current ? 1280 : 960} refreshing={templates.refreshing} onRefresh={reloadAll}>
      {!online ? (
        <Callout tone="warning" icon="cloud-offline-outline" title="You're offline">Changes and previews need a connection.</Callout>
      ) : null}
      {statusBanner}

      {!current ? (
        <Segmented<'templates' | 'log'> value={tab} onChange={setTab}
          options={[{ value: 'templates', label: 'Templates', icon: 'mail-outline' }, { value: 'log', label: 'Delivery log', icon: 'list-outline' }]} />
      ) : null}

      {current ? (
        <TemplateEditor key={current.key} template={current} placeholders={placeholders} canEdit online={online} emailEnabled={enabled}
          defaultTestTo={settings?.email ?? userEmail ?? ''} onDirtyChange={setEditorDirty} onBack={() => void openTemplate(null)}
          onSaved={(t: EmailTemplate) => templates.setData((ts) => (ts ?? []).map((x) => (x.key === t.key ? { ...x, ...t } : x)))} />
      ) : tab === 'log' ? (
        <DeliveryLog templates={list} />
      ) : (
        <>
          <FormSection title="Sending" description="Turn customer emails on or off for the whole business, and choose how they appear in the inbox.">
            {settings ? (
              <>
                <SettingSwitch title="Send emails to customers" value={enabled} disabled={!canSettings || !online || busy !== null}
                  onValueChange={(v) => saveSettings('enabled', { email_enabled: v }, v ? 'Customer emails turned on' : 'Customer emails turned off')}
                  subtitle={enabled ? 'On. Only customers with an email address get them; offers only go to customers who agreed.' : 'Off. No emails are sent to customers, including tests.'} />
                <Hairline />
                <FieldRow>
                  <Input label="Sender name" value={senderName} onChangeText={setSenderName} maxLength={80} editable={canSettings}
                    placeholder={settings.business_name} hint="Shown as “From” in the inbox. Empty uses your business name." />
                  <Input label="Reply-to email" value={replyTo} onChangeText={setReplyTo} keyboardType="email-address" autoCapitalize="none"
                    autoCorrect={false} editable={canSettings} placeholder={settings.email ?? 'you@yourshop.in'} error={replyError}
                    hint="Customer replies go here." />
                </FieldRow>
                {senderDirty && canSettings ? (
                  <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                    <Button title="Discard" variant="secondary" onPress={() => { setSenderName(settings.email_sender_name ?? ''); setReplyTo(settings.email_reply_to ?? ''); }} disabled={busy !== null} />
                    <Button title="Save" icon="checkmark" loading={busy === 'sender'} disabled={busy !== null || !!replyError || !online}
                      onPress={() => saveSettings('sender', { email_sender_name: senderName.trim() || null, email_reply_to: replyTo.trim() || null }, 'Sender details saved')} />
                  </View>
                ) : null}
                {!canSettings ? <Text variant="small" tone="subtle">Only users with settings access can change these.</Text> : null}
              </>
            ) : settingsReq.loading ? <Loading /> : <ErrorState message={settingsReq.error ?? 'Could not load settings.'} onRetry={settingsReq.reload} />}
          </FormSection>

          <View style={{ gap: 12 }}>
            <View style={{ gap: 2 }}>
              <Text variant="h3" accessibilityRole="header">Emails</Text>
              <Text variant="small" tone="muted">Tap an email to change its words and colours. Your business name, address and phone are added automatically.</Text>
            </View>
            {templates.loading && !templates.data ? <Loading label="Loading emails" /> : !templates.data ? (
              <ErrorState message={templates.error ?? 'Could not load email templates.'} onRetry={templates.reload} />
            ) : !list.length ? (
              <Card><EmptyState icon="mail-outline" title="No email templates" message="Templates will appear here once the server provides them." /></Card>
            ) : (
              <View style={{ gap: 10 }}>
                {list.map((t) => (
                  <Card key={t.key} onPress={() => void openTemplate(t.key)} style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                    <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: t.enabled ? colors.primarySoft : colors.surfaceSunken }}>
                      <Ionicons name={TEMPLATE_ICON[t.key] ?? 'mail-outline'} size={22} color={t.enabled ? colors.primarySoftText : colors.textSubtle} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text variant="bodyStrong">{t.label}</Text>
                        {t.customised ? <Badge label="Customised" tone="primary" /> : null}
                        {!t.enabled ? <Badge label="Off" tone="warning" /> : null}
                      </View>
                      <Text variant="small" tone="muted" numberOfLines={isPhone ? 3 : 2}>{t.description}</Text>
                      <Text variant="small" tone="subtle" numberOfLines={1}>Subject: {t.subject}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                  </Card>
                ))}
              </View>
            )}
          </View>
        </>
      )}
      <TopDialogHost />
    </SettingsFrame>
  );
}
