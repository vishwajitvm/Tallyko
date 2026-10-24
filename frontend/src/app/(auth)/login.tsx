/**
 * Sign in. Built for shift change at a busy counter: the people who signed in on this device are one tap away
 * (email filled, cursor in the password), the last email is pre-filled, Enter signs in. The demo-account picker is
 * development-only and sits below the form so it never pushes the real fields down.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { AuthLayout } from '@/components/AuthLayout';
import { ServerField } from '@/components/ServerField';
import { DemoAccountPicker } from '@/features/auth/DemoAccountPicker';
import { demoLoginsEnabled } from '@/features/auth/demoAccounts';
import { useRecentLogins, type RecentLogin } from '@/features/auth/recentLogins';
import { Button, Input, Text } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { errorMessage } from '@/api/client';
import { useTheme } from '@/theme/ThemeProvider';

function initials(r: RecentLogin) {
  const src = r.name || r.email.replace(/@.*/, '');
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export default function LoginScreen() {
  const { colors, radius } = useTheme();
  const login = useAuth((s) => s.login);
  /** Set when the server ended the session (signed out by Tallyko / another device, or the session expired) */
  const signOutReason = useAuth((s) => s.signOutReason);
  const recent = useRecentLogins((s) => s.recent);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const prefilled = useRef(false);

  // Last person on this device: email filled in, straight to the password
  useEffect(() => {
    if (prefilled.current || !recent.length) return;
    prefilled.current = true;
    setEmail((e) => e || recent[0]!.email);
    setTimeout(() => passwordRef.current?.focus(), 50);
  }, [recent]);

  const pick = (r: RecentLogin) => {
    setEmail(r.email);
    setPassword('');
    setError(null);
    setTimeout(() => passwordRef.current?.focus(), 0);
  };

  const submit = async () => {
    if (!email.trim() || !password) {
      setError(email.trim() ? 'Enter your password.' : 'Enter your email or phone number and password.');
      if (email.trim()) passwordRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      const s = useAuth.getState().session;
      useRecentLogins.getState().remember({ email: email.trim(), name: s?.fullName ?? null, business: s?.businessName ?? null });
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <View style={{ gap: 6 }}>
        <Text variant="h1">Welcome back</Text>
        <Text tone="muted">{recent.length ? 'Tap your name, then enter your password.' : 'Sign in to your business.'}</Text>
      </View>
      {signOutReason ? (
        <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 10, backgroundColor: colors.warningSoft, padding: 12, borderRadius: radius.md }}>
          <Ionicons name="information-circle" size={18} color={colors.warningText} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="smallStrong" color={colors.warningText}>{signOutReason.title}</Text>
            <Text variant="small">{signOutReason.message}</Text>
          </View>
        </View>
      ) : null}

      {recent.length ? (
        <View style={{ gap: 6 }} accessibilityRole="list" accessibilityLabel="Recent on this device">
          <Text variant="smallStrong" tone="muted">Recent on this device</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {recent.map((r) => {
              const selected = r.email.toLowerCase() === email.trim().toLowerCase();
              return (
                <View key={r.email} style={[{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.pill,
                  borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.surface, maxWidth: '100%' }]}>
                  <Pressable onPress={() => pick(r)} accessibilityRole="button" accessibilityLabel={`Sign in as ${r.name ?? r.email}`}
                    style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 4, minHeight: 44, flexShrink: 1 },
                      Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                    <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.primary : colors.surfaceSunken }}>
                      <Text variant="caption" color={selected ? colors.primaryText : colors.textMuted}>{initials(r)}</Text>
                    </View>
                    <View style={{ flexShrink: 1, minWidth: 0 }}>
                      <Text variant="smallStrong" numberOfLines={1}>{r.name ?? r.email}</Text>
                      {r.name ? <Text variant="caption" tone="subtle" numberOfLines={1}>{r.email}</Text> : null}
                    </View>
                  </Pressable>
                  <Pressable onPress={() => useRecentLogins.getState().forget(r.email)} accessibilityRole="button" accessibilityLabel={`Forget ${r.email} on this device`}
                    hitSlop={6} style={[{ width: 34, height: 44, alignItems: 'center', justifyContent: 'center' }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                    <Ionicons name="close" size={14} color={colors.textSubtle} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <Input label="Email or phone" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="username"
        keyboardType="email-address" icon="person-outline" returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} textContentType="username" />
      <Input ref={passwordRef} label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password"
        icon="lock-closed-outline" returnKeyType="go" onSubmitEditing={submit} textContentType="password" />
      {error ? (
        <View accessibilityRole="alert" style={{ backgroundColor: colors.dangerSoft, padding: 12, borderRadius: radius.md }}>
          <Text variant="small" tone="danger">{error}</Text>
        </View>
      ) : null}
      <Button title="Sign in" size="lg" onPress={submit} loading={busy} full shortcut="Enter" />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Text tone="muted">New to Tallyko?</Text>
        <Link href="/signup"><Text tone="primary" variant="bodyStrong">Create a free account</Text></Link>
      </View>
      {demoLoginsEnabled() ? <DemoAccountPicker disabled={busy} onPick={(e, p) => { setEmail(e); setPassword(p); setError(null); }} /> : null}
      <ServerField />
      <Text variant="small" tone="subtle" align="center">
        Staff accounts are created by the shop owner in Settings → Staff.{'  '}
        <Link href="/privacy"><Text variant="small" tone="primary">Privacy policy</Text></Link>
      </Text>
    </AuthLayout>
  );
}
