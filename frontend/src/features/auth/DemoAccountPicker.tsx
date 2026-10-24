import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Badge, Text, type BadgeTone } from '@/components/ui';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, ROLE_LABEL, demoLoginsEnabled, type DemoAccount, type DemoRole } from './demoAccounts';

const ROLE_TONE: Record<DemoRole, BadgeTone> = { super_admin: 'danger', support: 'info', owner: 'primary', manager: 'info', cashier: 'success', waiter: 'accent', kitchen: 'danger' };
const ROLE_ICON: Record<DemoRole, keyof typeof Ionicons.glyphMap> = {
  super_admin: 'shield-checkmark-outline', support: 'headset-outline',
  owner: 'briefcase-outline', manager: 'ribbon-outline', cashier: 'cash-outline', waiter: 'restaurant-outline', kitchen: 'flame-outline',
};

/** Development-only dropdown that fills the login form with a seeded demo account. */
export function DemoAccountPicker({ onPick, disabled }: { onPick: (email: string, password: string) => void; disabled?: boolean }) {
  const { colors, radius } = useTheme();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<DemoAccount | null>(null);
  if (!demoLoginsEnabled()) return null;

  const choose = (account: DemoAccount) => {
    setPicked(account);
    setOpen(false);
    onPick(account.email, DEMO_PASSWORD);
  };

  return (
    <View style={{ gap: 6, zIndex: 10 }}>
      <Text variant="smallStrong" tone="muted">Demo account</Text>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        disabled={disabled}
        accessibilityRole="combobox"
        accessibilityLabel="Choose a demo account"
        accessibilityState={{ expanded: open }}
        style={[styles.trigger, { borderColor: open ? colors.focus : colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
          Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
      >
        <Ionicons name={picked ? ROLE_ICON[picked.role] : 'people-outline'} size={18} color={colors.textSubtle} />
        <View style={{ flex: 1, minWidth: 0 }}>
          {picked ? (
            <Text variant="bodyStrong" numberOfLines={1}>{picked.name} · {ROLE_LABEL[picked.role]}</Text>
          ) : (
            <Text tone="subtle" numberOfLines={1}>Use a demo account…</Text>
          )}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSubtle} />
      </Pressable>

      {open ? (
        <ScrollView style={[styles.menu, { borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface }]}
          nestedScrollEnabled keyboardShouldPersistTaps="handled" accessibilityRole="menu">
          {DEMO_ACCOUNTS.map((account, index) => {
            const firstOfRole = index === 0 || DEMO_ACCOUNTS[index - 1].role !== account.role;
            return (
              <View key={account.email}>
                {firstOfRole ? (
                  <View style={[styles.group, { backgroundColor: colors.surfaceAlt, borderTopColor: colors.divider, borderTopWidth: index === 0 ? 0 : 1 }]}>
                    <Text variant="caption" tone="subtle">{ROLE_LABEL[account.role].toUpperCase()}</Text>
                  </View>
                ) : null}
                <Pressable
                  onPress={() => choose(account)}
                  accessibilityRole="menuitem"
                  accessibilityLabel={`${account.name}, ${ROLE_LABEL[account.role]}, ${account.business}`}
                  style={({ hovered, pressed }: any) => [styles.option, (hovered || pressed) && { backgroundColor: colors.surfaceSunken },
                    Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="smallStrong" numberOfLines={1}>{account.name}</Text>
                    <Text variant="small" tone="muted" numberOfLines={1}>{account.email}</Text>
                    <Text variant="caption" tone="subtle" numberOfLines={1}>{account.business} · {account.note}</Text>
                  </View>
                  <Badge label={ROLE_LABEL[account.role]} tone={ROLE_TONE[account.role]} icon={ROLE_ICON[account.role]} />
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      ) : null}
      <Text variant="small" tone="subtle">
        Demo only. All demo accounts use the password <Text variant="smallStrong" tone="muted">{DEMO_PASSWORD}</Text>. Run the demo seed first if sign-in fails.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingHorizontal: 12, borderWidth: 1 },
  menu: { borderWidth: 1, overflow: 'hidden', maxHeight: 420 },
  group: { paddingHorizontal: 12, paddingVertical: 6 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 56 },
});
