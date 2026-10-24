import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Redirect, Tabs, type Href } from 'expo-router';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useBadges } from '@/store/badges';
import { useAccess } from '@/store/access';
import { startSync } from '@/lib/sync';
import { AppNav } from '@/components/nav/AppNav';
import { SubscriptionBanner } from '@/components/SubscriptionBanner';
import { useSubscription } from '@/store/subscription';

export default function AppLayout() {
  const { colors } = useTheme();
  const { isWide } = useLayout();
  const status = useAuth((s) => s.status);
  const tenantId = useAuth((s) => s.session?.tenantId);
  const isPlatform = useAuth((s) => s.session?.accountType === 'platform');
  const locked = useSubscription((s) => s.locked);

  useEffect(() => {
    if (status !== 'signedIn' || !tenantId || isPlatform) return undefined;
    // Never show a previous business's cached data after switching accounts
    if (useData.getState().tenantId && useData.getState().tenantId !== tenantId) useData.getState().reset();
    const stopSync = startSync();
    void useAccess.getState().refresh();
    void useBadges.getState().refresh();
    const badgeTimer = setInterval(() => void useBadges.getState().refresh(), 20_000);
    // Role or plan changes made by the owner / Tallyko reach open devices within a few minutes
    const accessTimer = setInterval(() => void useAccess.getState().refresh(), 180_000);
    // Subscription state for the banner (days left); a lapse also shows up as 402 on the next call
    const checkSubscription = () => void useSubscription.getState().refresh().catch(() => {});
    checkSubscription();
    const subscriptionTimer = setInterval(checkSubscription, 30 * 60_000);
    return () => {
      stopSync();
      clearInterval(badgeTimer);
      clearInterval(accessTimer);
      clearInterval(subscriptionTimer);
    };
  }, [status, tenantId, isPlatform]);

  if (status !== 'signedIn') return <Redirect href="/login" />;
  if (isPlatform) return <Redirect href="/admin" />;
  // Subscription ended: only the renewal page. Offline bills stay in the outbox and sync after renewal.
  if (locked) return <Redirect href={'/subscription' as Href} />;

  return (
    <Tabs
      tabBar={(props) => (isWide ? <AppNav state={props.state} /> : <View><SubscriptionBanner placement="bottom" /><AppNav state={props.state} /></View>)}
      screenLayout={({ children }) => (isWide ? <View style={{ flex: 1 }}><SubscriptionBanner placement="top" />{children}</View> : children)}
      screenOptions={{
        headerShown: false,
        tabBarPosition: isWide ? 'left' : 'bottom',
        sceneStyle: { backgroundColor: colors.background },
        lazy: true,
      }}
    >
      <Tabs.Screen name="pos" options={{ title: 'Billing' }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders' }} />
      <Tabs.Screen name="tables" options={{ title: 'Tables' }} />
      <Tabs.Screen name="online" options={{ title: 'Online orders' }} />
      <Tabs.Screen name="kitchen" options={{ title: 'Kitchen' }} />
      <Tabs.Screen name="menu" options={{ title: 'Menu & items' }} />
      <Tabs.Screen name="inventory" options={{ title: 'Inventory' }} />
      <Tabs.Screen name="customers" options={{ title: 'Customers' }} />
      <Tabs.Screen name="offers" options={{ title: 'Offers & rewards' }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports' }} />
      <Tabs.Screen name="watch" options={{ title: "Owner's watch" }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      <Tabs.Screen name="more" options={{ title: 'More', href: null }} />
    </Tabs>
  );
}
