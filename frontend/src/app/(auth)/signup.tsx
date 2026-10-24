import React, { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { AuthLayout } from '@/components/AuthLayout';
import { ServerField } from '@/components/ServerField';
import { Button, Input, Text } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { errorMessage } from '@/api/client';
import { useTheme } from '@/theme/ThemeProvider';
import type { BusinessType } from '@/api/types';

const TYPES: { value: BusinessType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'restaurant', label: 'Restaurant', icon: 'restaurant-outline' },
  { value: 'cafe', label: 'Café / QSR', icon: 'cafe-outline' },
  { value: 'cloud_kitchen', label: 'Cloud kitchen', icon: 'bicycle-outline' },
  { value: 'retail', label: 'Retail store', icon: 'storefront-outline' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupScreen() {
  const { colors, radius } = useTheme();
  const register = useAuth((s) => s.register);
  const [form, setForm] = useState({ vendor_name: '', owner_name: '', email: '', phone: '', password: '' });
  const [type, setType] = useState<BusinessType>('restaurant');
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.vendor_name.trim().length < 2) e.vendor_name = 'Enter your business name';
    if (!EMAIL_RE.test(form.email.trim())) e.email = 'Enter a valid email address';
    const digits = form.phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) e.phone = 'Enter a valid mobile number';
    if (form.password.length < 8) e.password = 'Use at least 8 characters';
    if (!agreed) e.agreed = 'Please accept the privacy policy to continue';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true);
    setServerError(null);
    try {
      await register({
        vendor_name: form.vendor_name.trim(), owner_name: form.owner_name.trim() || undefined, email: form.email.trim().toLowerCase(),
        phone: form.phone.replace(/[^\d+]/g, ''), password: form.password, business_type: type,
      });
      router.replace('/');
    } catch (e) {
      setServerError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <View style={{ gap: 6 }}>
        <Text variant="h1">Create your business</Text>
        <Text tone="muted">Free to start. Set up your menu in minutes.</Text>
      </View>

      <View style={{ gap: 8 }}>
        <Text variant="smallStrong" tone="muted">What do you run?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TYPES.map((t) => {
            const active = t.value === type;
            return (
              <Pressable key={t.value} onPress={() => setType(t.value)} accessibilityRole="radio" accessibilityState={{ checked: active }}
                style={[{ flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderWidth: 1.5, borderRadius: radius.md,
                  borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primarySoft : colors.surface },
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}>
                <Ionicons name={t.icon} size={18} color={active ? colors.primary : colors.textMuted} />
                <Text variant="smallStrong" color={active ? colors.primarySoftText : colors.text}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Input label="Business name" required value={form.vendor_name} onChangeText={set('vendor_name')} error={errors.vendor_name} placeholder="e.g. Sharma Dhaba" icon="business-outline" />
      <Input label="Your name" value={form.owner_name} onChangeText={set('owner_name')} placeholder="Owner name" icon="person-outline" autoComplete="name" />
      <Input label="Email" required value={form.email} onChangeText={set('email')} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" icon="mail-outline" />
      <Input label="Mobile number" required value={form.phone} onChangeText={set('phone')} error={errors.phone} keyboardType="phone-pad" autoComplete="tel" prefix="+91" placeholder="98765 43210" />
      <Input label="Password" required value={form.password} onChangeText={set('password')} error={errors.password} secureTextEntry autoComplete="new-password" hint="At least 8 characters" icon="lock-closed-outline" />

      <Pressable onPress={() => setAgreed((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={22} color={agreed ? colors.primary : colors.textSubtle} />
        <Text variant="small" tone="muted" style={{ flex: 1 }}>
          I agree to the <Link href="/privacy"><Text variant="small" tone="primary">privacy policy</Text></Link> and confirm I'm allowed to store my customers' contact details for billing and loyalty.
        </Text>
      </Pressable>
      {errors.agreed ? <Text variant="small" tone="danger">{errors.agreed}</Text> : null}
      {serverError ? (
        <View style={{ backgroundColor: colors.dangerSoft, padding: 12, borderRadius: 10 }}>
          <Text variant="small" tone="danger">{serverError}</Text>
        </View>
      ) : null}

      <Button title="Create account" size="lg" onPress={submit} loading={busy} full />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
        <Text tone="muted">Already have an account?</Text>
        <Link href="/login"><Text tone="primary" variant="bodyStrong">Sign in</Text></Link>
      </View>
      <ServerField />
    </AuthLayout>
  );
}
