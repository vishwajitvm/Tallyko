import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { palette } from '@/theme/tokens';
import { Text } from './ui';
import { Logo } from './Logo';

const POINTS: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { icon: 'flash-outline', title: 'Bill in seconds', body: 'Tap, pay, print. GST, UPI and split payments built in.' },
  { icon: 'cloud-offline-outline', title: 'Works offline', body: 'Internet down? Keep billing — everything syncs later.' },
  { icon: 'restaurant-outline', title: 'Tables, kitchen & online orders', body: 'KOTs, Swiggy/Zomato orders and QR menus in one place.' },
  { icon: 'camera-outline', title: 'Menu from a photo', body: 'Snap any printed menu and import items with prices.' },
];

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const { isWide } = useLayout();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { backgroundColor: colors.background, flexDirection: isWide ? 'row' : 'column' }]}>
      {isWide ? (
        <View style={[styles.brand, { backgroundColor: palette.slate900 }]}>
          <Logo inverse size={34} />
          <View style={{ gap: 10, marginTop: 56 }}>
            <Text variant="display" color="#FFFFFF" style={{ maxWidth: 440 }}>The point of sale that keeps your shop running.</Text>
            <Text color="#A9B6C9" style={{ maxWidth: 420 }}>For restaurants, cafés, cloud kitchens and retail stores — on your laptop, tablet or phone.</Text>
          </View>
          <View style={{ gap: 22, marginTop: 44 }}>
            {POINTS.map((p) => (
              <View key={p.title} style={{ flexDirection: 'row', gap: 14, maxWidth: 440 }}>
                <View style={[styles.pointIcon, { backgroundColor: 'rgba(20,184,166,0.14)' }]}>
                  <Ionicons name={p.icon} size={20} color="#5EEAD4" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" color="#F1F5F9">{p.title}</Text>
                  <Text variant="small" color="#94A3B8">{p.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.formWrap, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
            {!isWide ? <Logo size={30} /> : null}
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  brand: { width: '44%', maxWidth: 620, padding: 56, justifyContent: 'center' },
  pointIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  formWrap: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20 },
  form: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: 18 },
});
