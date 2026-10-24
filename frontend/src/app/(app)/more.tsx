import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Badge, Card, ListRow, Screen, StatusPill, Text } from '@/components/ui';
import { initials, useNavBadges, useNavItems } from '@/components/nav/AppNav';
import { splitBottomBar } from '@/components/nav/navItems';
import { useAccessLine } from '@/components/nav/shellStatus';
import { ROLE_LABEL } from '@/features/settings/sections';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useNet } from '@/lib/sync';
import { useOutbox } from '@/store/outbox';
import { signOut } from '@/lib/signOut';
import { useTheme } from '@/theme/ThemeProvider';

/** Phone-only overflow page: the sections that don't fit in the bottom bar, who is signed in and the quiet subscription status. */
export default function MoreScreen() {
  const { colors } = useTheme();
  const session = useAuth((s) => s.session);
  const businessName = useData((s) => s.settings?.business_name) ?? session?.businessName ?? 'Your business';
  const items = useNavItems();
  const badges = useNavBadges();
  const accessLine = useAccessLine();
  const online = useNet((s) => s.online && s.serverReachable);
  const pending = useOutbox((s) => s.queue.length);
  const { more } = splitBottomBar(items);
  const who = session?.fullName ?? session?.email ?? 'Signed in';

  return (
    <Screen title="More">
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="bodyStrong" color={colors.primarySoftText}>{initials(who)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text variant="bodyStrong" numberOfLines={1}>{who}</Text>
          <Text variant="small" tone="muted" numberOfLines={1}>{businessName}{session?.role ? ` · ${ROLE_LABEL[session.role]}` : ''}</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Badge label={`${online ? 'Online' : 'Offline'}${pending ? ` · ${pending} to sync` : ''}`} tone={online ? 'success' : 'warning'}
              icon={online ? 'cloud-done-outline' : 'cloud-offline-outline'} />
            {accessLine ? <StatusPill status={accessLine.status} label={accessLine.label} /> : null}
          </View>
        </View>
      </Card>
      {more.length ? (
        <Card padded={false} style={{ padding: 6 }}>
          {more.map((item) => {
            const count = badges[item.route] ?? 0;
            return (
              <ListRow key={item.route} title={item.label} icon={item.icon} onPress={() => router.navigate(item.href as never)}
                subtitle={count ? (item.route === 'watch' ? `${count} new answer${count === 1 ? '' : 's'} from Tallyko` : `${count} new`) : undefined}
                right={count ? <Badge label={String(count)} tone="danger" /> : undefined} />
            );
          })}
        </Card>
      ) : null}
      <Card padded={false} style={{ padding: 6 }}>
        <ListRow title="Sign out" subtitle={session?.email ?? undefined} icon="log-out-outline" danger onPress={() => void signOut()} />
      </Card>
    </Screen>
  );
}
