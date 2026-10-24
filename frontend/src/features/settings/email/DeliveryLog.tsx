/** Delivery log: what was sent to whom, with status counts and the reason for failures. */
import React, { useState } from 'react';
import { View } from 'react-native';
import { emailApi, type EmailLogStatus, type EmailTemplate } from '@/api/email';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Loading, Text, type BadgeTone } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { formatDateTime } from '@/lib/format';
import { useLayout, useTheme } from '@/theme/ThemeProvider';

const STATUS: Record<EmailLogStatus, { label: string; tone: BadgeTone; hint: string }> = {
  sent: { label: 'Sent', tone: 'success', hint: 'Handed to the mail server' },
  queued: { label: 'Queued', tone: 'info', hint: 'Waiting to be sent (usually a few seconds)' },
  failed: { label: 'Failed', tone: 'danger', hint: 'The mail server refused it' },
  skipped: { label: 'Skipped', tone: 'warning', hint: 'Not sent because email is not set up' },
};
const ORDER: EmailLogStatus[] = ['sent', 'queued', 'failed', 'skipped'];

export function DeliveryLog({ templates }: { templates: EmailTemplate[] }) {
  const { colors } = useTheme();
  const { isPhone } = useLayout();
  const [status, setStatus] = useState<EmailLogStatus | null>(null);
  const { data, error, loading, refreshing, reload } = useApi(() => emailApi.logs(status), [status], { intervalMs: 15000 });
  const label = (key: string) => templates.find((t) => t.key === key)?.label ?? key.replace(/_/g, ' ');
  const counts = data?.counts ?? {};
  const total = ORDER.reduce((n, s) => n + (counts[s] ?? 0), 0);

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Chip label="All" count={total} selected={status === null} onPress={() => setStatus(null)} />
        {ORDER.map((s) => (
          <Chip key={s} label={STATUS[s].label} count={counts[s] ?? 0} selected={status === s} onPress={() => setStatus(s)} />
        ))}
        <View style={{ flex: 1 }} />
        <Button title={isPhone ? undefined : 'Refresh'} icon="refresh" variant="ghost" size="sm" onPress={reload} loading={refreshing} accessibilityLabel="Refresh delivery log" />
      </View>

      {loading && !data ? <Loading label="Loading delivery log" /> : !data ? (
        <ErrorState message={error ?? 'Could not load the delivery log.'} onRetry={reload} />
      ) : !data.items.length ? (
        <Card>
          <EmptyState icon="mail-open-outline" title={status ? `No ${STATUS[status].label.toLowerCase()} emails` : 'No emails yet'}
            message={status ? STATUS[status].hint : 'Emails to customers (receipts, rewards, offers) and test emails appear here.'} />
        </Card>
      ) : (
        <Card padded={false}>
          {data.items.map((item, i) => {
            const st = STATUS[item.status] ?? { label: item.status, tone: 'neutral' as BadgeTone, hint: '' };
            return (
              <View key={item.id} style={{ flexDirection: isPhone ? 'column' : 'row', gap: isPhone ? 4 : 12, paddingHorizontal: 16, paddingVertical: 12,
                borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>{item.subject}</Text>
                  <Text variant="small" tone="muted" numberOfLines={1}>{item.to} · {label(item.template)}</Text>
                  {item.error ? <Text variant="small" tone={item.status === 'failed' ? 'danger' : 'warning'} numberOfLines={3}>{item.error}</Text> : null}
                </View>
                <View style={{ alignItems: isPhone ? 'flex-start' : 'flex-end', gap: 4, flexDirection: isPhone ? 'row' : 'column' }}>
                  <Badge label={st.label} tone={st.tone} />
                  <Text variant="caption" tone="subtle">{formatDateTime(item.sent_at ?? item.created_at)}</Text>
                </View>
              </View>
            );
          })}
        </Card>
      )}
      {data && data.items.length >= 100 ? <Text variant="small" tone="subtle">Showing the latest 100.</Text> : null}
    </View>
  );
}
