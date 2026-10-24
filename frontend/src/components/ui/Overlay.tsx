/**
 * Modal sheet (bottom sheet on phones, centred dialog on tablets/desktop), toasts and confirm dialogs.
 * Toasts and confirms are driven by small global stores so any code (even non-React) can call them.
 */
import React, { useEffect } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';
import { Button, IconButton } from './Button';
import { Input } from './Input';
import { toast, useToasts, type ToastTone } from './toastStore';

export { toast };

export function Sheet({ visible, onClose, title, subtitle, children, footer, width = 560, scroll = true, dismissable = true }: {
  visible: boolean; onClose: () => void; title?: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode;
  width?: number; scroll?: boolean; dismissable?: boolean;
}) {
  const { colors, radius, shadow } = useTheme();
  const { isPhone, height } = useLayout();
  const insets = useSafeAreaInsets();
  const Body = scroll ? ScrollView : View;

  return (
    <Modal visible={visible} transparent animationType={isPhone ? 'slide' : 'fade'} onRequestClose={dismissable ? onClose : undefined} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.backdrop, { backgroundColor: colors.overlay, justifyContent: isPhone ? 'flex-end' : 'center' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissable ? onClose : undefined} accessibilityLabel="Close" />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            shadow(3),
            {
              backgroundColor: colors.surface,
              maxHeight: isPhone ? height * 0.92 : height * 0.88,
              width: isPhone ? '100%' : Math.min(width, 980),
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              borderBottomLeftRadius: isPhone ? 0 : radius.xl,
              borderBottomRightRadius: isPhone ? 0 : radius.xl,
              paddingBottom: isPhone ? insets.bottom : 0,
            },
          ]}
        >
          {title ? (
            <View style={[styles.header, { borderBottomColor: colors.divider }]}>
              <View style={{ flex: 1 }}>
                <Text variant="h2">{title}</Text>
                {subtitle ? <Text variant="small" tone="muted">{subtitle}</Text> : null}
              </View>
              {dismissable ? <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} /> : null}
            </View>
          ) : null}
          <Body style={scroll ? undefined : { flexShrink: 1 }} contentContainerStyle={scroll ? styles.body : undefined} keyboardShouldPersistTaps="handled">
            {scroll ? children : <View style={[styles.body, { flexShrink: 1 }]}>{children}</View>}
          </Body>
          {footer ? <View style={[styles.footer, { borderTopColor: colors.divider }]}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// --- Toasts ---

export function ToastHost() {
  const items = useToasts((s) => s.items);
  const { colors, radius, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  if (!items.length) return null;
  const icon: Record<ToastTone, keyof typeof Ionicons.glyphMap> = { success: 'checkmark-circle', error: 'alert-circle', info: 'information-circle', warning: 'warning' };
  const tint: Record<ToastTone, string> = { success: colors.success, error: colors.danger, info: colors.info, warning: colors.warning };
  return (
    <View pointerEvents="box-none" style={[styles.toastWrap, { bottom: insets.bottom + 24 }]}>
      {items.map((t) => (
        <View key={t.id} accessibilityLiveRegion="polite" accessibilityRole="alert"
          style={[styles.toast, shadow(3), { backgroundColor: colors.text, borderRadius: radius.md }]}>
          <Ionicons name={icon[t.tone]} size={20} color={tint[t.tone]} />
          <Text variant="smallStrong" color={colors.surface} style={{ flexShrink: 1 }}>{t.message}</Text>
          {t.action ? (
            <Pressable
              onPress={() => { toast.dismiss(t.id); t.action?.onPress(); }}
              accessibilityRole="button" accessibilityLabel={t.action.label} hitSlop={8}
              style={({ pressed }) => [styles.toastAction, { borderRadius: radius.sm, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text variant="smallStrong" color={colors.primary}>{t.action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

// --- Confirm / prompt dialogs ---

interface DialogState {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  danger: boolean;
  prompt?: { placeholder?: string; label?: string; minLength?: number; secure?: boolean };
  resolve?: (value: string | boolean | null) => void;
}
const useDialog = create<DialogState>(() => ({ open: false, title: '', confirmLabel: 'Confirm', danger: false }));

export function confirm(opts: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    useDialog.setState({ open: true, title: opts.title, message: opts.message, confirmLabel: opts.confirmLabel ?? 'Confirm', danger: !!opts.danger, prompt: undefined,
      resolve: (v) => resolve(v === true) });
  });
}

export function prompt(opts: { title: string; message?: string; confirmLabel?: string; danger?: boolean; label?: string; placeholder?: string; minLength?: number; secure?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    useDialog.setState({ open: true, title: opts.title, message: opts.message, confirmLabel: opts.confirmLabel ?? 'Save', danger: !!opts.danger,
      prompt: { label: opts.label, placeholder: opts.placeholder, minLength: opts.minLength ?? 1, secure: opts.secure },
      resolve: (v) => resolve(typeof v === 'string' ? v : null) });
  });
}

export function DialogHost() {
  const state = useDialog();
  const [value, setValue] = React.useState('');
  useEffect(() => { if (state.open) setValue(''); }, [state.open]);
  const close = (result: string | boolean | null) => {
    state.resolve?.(result);
    useDialog.setState({ open: false, resolve: undefined });
  };
  const valid = !state.prompt || value.trim().length >= (state.prompt.minLength ?? 1);
  return (
    <Sheet visible={state.open} onClose={() => close(null)} title={state.title} width={440}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Cancel" variant="secondary" onPress={() => close(null)} />
          <Button title={state.confirmLabel} variant={state.danger ? 'danger' : 'primary'} disabled={!valid}
            onPress={() => close(state.prompt ? value.trim() : true)} />
        </View>
      }>
      {state.message ? <Text tone="muted">{state.message}</Text> : null}
      {state.prompt ? (
        <Input autoFocus label={state.prompt.label} placeholder={state.prompt.placeholder} value={value} onChangeText={setValue}
          secureTextEntry={state.prompt.secure} onSubmitEditing={() => valid && close(value.trim())} />
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center' },
  sheet: { overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  body: { padding: 20, gap: 14 },
  footer: { paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1 },
  toastWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', gap: 8, zIndex: 1000 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, maxWidth: 520 },
  toastAction: { marginLeft: 6, paddingHorizontal: 10, paddingVertical: 6, minHeight: 32, justifyContent: 'center' },
});
