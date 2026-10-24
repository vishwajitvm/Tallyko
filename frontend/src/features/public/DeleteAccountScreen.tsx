import React, { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { Button, Card, Input, Text } from '@/components/ui';
import { authApi } from '@/api/endpoints';
import { errorMessage } from '@/api/client';
import type { AuthResponse, Role } from '@/api/types';
import { useAuth } from '@/store/auth';
import { PublicPage, Notice } from './PublicPage';
import { Rich } from './RichText';
import { deleteAccountWithToken } from './accountApi';

const SUPPORT_EMAIL = '[[support@your-domain]]';
const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', waiter: 'Waiter', kitchen: 'Kitchen staff' };

type Step = 'signin' | 'confirm' | 'done';

export default function DeleteAccountScreen() {
  const { colors, radius } = useTheme();
  const [step, setStep] = useState<Step>('signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ identifier?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<AuthResponse | null>(null);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<{ businessClosed: boolean } | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const signIn = async () => {
    const next: typeof errors = {};
    if (identifier.trim().length < 3) next.identifier = 'Enter the email or phone number you sign in with.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    if (next.identifier || next.password) return;
    setBusy(true);
    try {
      const auth = await authApi.login(identifier.trim(), password);
      setAccount(auth);
      setTyped('');
      setStep('confirm');
    } catch (e) {
      setErrors({ form: errorMessage(e, 'Could not sign in. Check your details and try again.') });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!account || typed.trim().toUpperCase() !== 'DELETE') return;
    setBusy(true);
    setErrors({});
    try {
      const r = await deleteAccountWithToken(account.access_token, password);
      // If this browser is signed in to the same account, sign it out too.
      const session = useAuth.getState().session;
      if (session && (session.userId === account.user?.id || (session.tenantId === account.tenant_id && r.business_closed))) {
        await useAuth.getState().logout();
      }
      setPassword('');
      setAccount(null);
      setResult({ businessClosed: !!r.business_closed });
      setStep('done');
    } catch (e) {
      setErrors({ form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setAccount(null);
    setPassword('');
    setTyped('');
    setErrors({});
    setStep('signin');
  };

  const isOwner = account?.role === 'owner';
  const business = account?.business_name || 'your business';

  return (
    <PublicPage title="Delete your account · Tallyko" maxWidth={640}>
      <View style={{ gap: 8 }}>
        <Text variant="caption" tone="primary" style={{ textTransform: 'uppercase' }}>Account</Text>
        <Text variant="display" accessibilityRole="header">Delete your Tallyko account</Text>
        <Text tone="muted" style={{ lineHeight: 24 }}>
          You can delete your account at any time. Signed in to the app? The quickest way is in the app itself.
        </Text>
      </View>

      <Card style={{ marginTop: 20, gap: 12 }}>
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="phone-portrait-outline" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">In the app</Text>
            <Text tone="muted">Open <Text variant="bodyStrong">Settings → Account → Delete account</Text>, enter your password and confirm.</Text>
          </View>
        </View>
        <View style={[styles.row, { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 12 }]}>
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="globe-outline" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">On this page</Text>
            <Text tone="muted">Sign in below, review what will be deleted, and confirm.</Text>
          </View>
        </View>
      </Card>

      {step === 'signin' ? (
        <Card style={{ marginTop: 16, gap: 14 }}>
          <View style={{ gap: 2 }}>
            <Text variant="h2">Step 1 · Confirm it's you</Text>
            <Text variant="small" tone="muted">We'll show you exactly what happens before anything is deleted.</Text>
          </View>
          <Input label="Email or phone" value={identifier} onChangeText={(v) => { setIdentifier(v); setErrors((e) => ({ ...e, identifier: undefined, form: undefined })); }}
            autoCapitalize="none" autoCorrect={false} autoComplete="username" keyboardType="email-address" icon="person-outline"
            error={errors.identifier} returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} textContentType="username" />
          <Input ref={passwordRef} label="Password" value={password} onChangeText={(v) => { setPassword(v); setErrors((e) => ({ ...e, password: undefined, form: undefined })); }}
            secureTextEntry autoComplete="current-password" icon="lock-closed-outline" error={errors.password} returnKeyType="go"
            onSubmitEditing={signIn} textContentType="password" />
          {errors.form ? <Notice tone="danger">{errors.form}</Notice> : null}
          <Button title="Continue" size="lg" onPress={signIn} loading={busy} full iconRight="arrow-forward" />
        </Card>
      ) : null}

      {step === 'confirm' && account ? (
        <Card style={{ marginTop: 16, gap: 16, borderColor: colors.danger }}>
          <View style={{ gap: 2 }}>
            <Text variant="h2">Step 2 · Review and confirm</Text>
            <Text variant="small" tone="muted">This cannot be undone.</Text>
          </View>
          <View style={[styles.accountBox, { backgroundColor: colors.surfaceSunken, borderRadius: radius.md }]}>
            <Ionicons name="person-circle-outline" size={32} color={colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" numberOfLines={1}>{account.user?.full_name || account.user?.email || identifier}</Text>
              <Text variant="small" tone="muted" numberOfLines={1}>
                {account.role ? (ROLE_LABEL[account.role] ?? account.role) : (account.platform_role === "support" ? "Tallyko support" : "Tallyko admin")}{account.business_name ? ` · ${account.business_name}` : ''}
              </Text>
            </View>
          </View>

          {isOwner ? (
            <Notice tone="danger" title={`This closes ${business}`}>
              <View style={{ gap: 6 }}>
                <Text variant="small" color={colors.dangerText}>• Your login and every staff login for this business are disabled.</Text>
                <Text variant="small" color={colors.dangerText}>• Your name, email and phone number are erased, and so are your customers' names and phone numbers.</Text>
                <Text variant="small" color={colors.dangerText}>• Invoices and sales records are kept, without personal details, for as long as tax law requires.</Text>
                <Text variant="small" color={colors.dangerText}>• Your online store and QR ordering pages stop working.</Text>
              </View>
            </Notice>
          ) : (
            <Notice tone="warning" title="Only your login is deleted">
              <View style={{ gap: 6 }}>
                <Text variant="small" color={colors.warningText}>• Your name, email, phone number and password are erased and you can no longer sign in.</Text>
                <Text variant="small" color={colors.warningText}>• {business} and its records are not affected. Bills you created stay in its records as required by tax law.</Text>
              </View>
            </Notice>
          )}

          <Input label='Type DELETE to confirm' value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false}
            placeholder="DELETE" onSubmitEditing={remove} />
          {errors.form ? <Notice tone="danger">{errors.form}</Notice> : null}
          <View style={styles.actions}>
            <Button title="Cancel" variant="secondary" onPress={cancel} disabled={busy} style={{ flex: 1 }} />
            <Button title={isOwner ? 'Close business & delete' : 'Delete my account'} variant="danger" icon="trash-outline" onPress={remove}
              loading={busy} disabled={typed.trim().toUpperCase() !== 'DELETE'} style={{ flex: 1.4 }} />
          </View>
        </Card>
      ) : null}

      {step === 'done' ? (
        <Card style={{ marginTop: 16, gap: 14, alignItems: 'center', paddingVertical: 32 }}>
          <View style={[styles.doneIcon, { backgroundColor: colors.successSoft }]}>
            <Ionicons name="checkmark" size={30} color={colors.success} />
          </View>
          <Text variant="h2" align="center">Your account has been deleted</Text>
          <Text tone="muted" align="center" style={{ maxWidth: 440 }}>
            {result?.businessClosed
              ? 'The business has been closed and all its logins disabled. Records that tax law requires us to keep are retained without personal details.'
              : 'Your login has been removed. The business you worked for keeps its own records.'}
          </Text>
          <Button title="Done" variant="secondary" onPress={() => router.replace('/')} />
        </Card>
      ) : null}

      <View style={{ marginTop: 24, gap: 12 }}>
        <Text variant="h3">Can't sign in?</Text>
        <Rich>{`Email ${SUPPORT_EMAIL} from the email address on your account and ask us to delete it. We may ask a question to confirm it's your account, and we'll confirm once it's done — usually within 7 days.`}</Rich>
        <Rich>{'Read more about what we keep and why in our {{/privacy|privacy policy}}.'}</Rich>
      </View>
    </PublicPage>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  accountBox: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  doneIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
});
