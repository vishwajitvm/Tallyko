/**
 * Global navigation shortcuts on desktop web (docs/20_High_Volume_UX.md §1.5):
 *   g then b → Billing, g then o → Orders, g then t → Tables … (see NAV_ITEMS.goKey), "?" → this help, "[" → collapse the sidebar.
 * Ignored while typing in a field, with Ctrl/Alt/Cmd held, and when keys arrive scanner-fast (a barcode scanner "types"
 * whole codes in a few milliseconds, which must never navigate away from the bill).
 */
import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Sheet, ShortcutHint, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import type { NavItem } from './navItems';

const SEQUENCE_MS = 1500;
/** Faster than any person types: a scanner burst */
const SCANNER_GAP_MS = 25;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

/** Pure sequence matcher, unit-tested: feed keys with timestamps, get back the go-key when "g" + key completes. */
export function createGoSequence() {
  let pendingAt = 0;
  let lastAt = 0;
  return (key: string, at: number): string | null => {
    const gap = at - lastAt;
    lastAt = at;
    if (pendingAt && at - pendingAt <= SEQUENCE_MS && key !== 'g') {
      pendingAt = 0;
      return gap < SCANNER_GAP_MS ? null : key;
    }
    pendingAt = key === 'g' && gap >= SCANNER_GAP_MS ? at : 0;
    return null;
  };
}

export function useGoShortcuts({ enabled, onGo, onHelp, onToggleSidebar }: {
  enabled: boolean; onGo: (key: string) => boolean; onHelp: () => void; onToggleSidebar?: () => void;
}) {
  const handlers = useRef({ onGo, onHelp, onToggleSidebar });
  handlers.current = { onGo, onHelp, onToggleSidebar };

  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || typeof window === 'undefined') return undefined;
    const next = createGoSequence();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      // An open dialog (sheet, confirm) owns the keyboard
      if (typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]')) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === '?') {
        e.preventDefault();
        handlers.current.onHelp();
        return;
      }
      if (key === '[' && handlers.current.onToggleSidebar) {
        e.preventDefault();
        handlers.current.onToggleSidebar();
        return;
      }
      if (key.length !== 1) return;
      const go = next(key, e.timeStamp || Date.now());
      if (go && handlers.current.onGo(go)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

const SCREEN_KEYS: { keys: string; label: string }[] = [
  { keys: '/', label: 'Search the list or menu' },
  { keys: 'F2', label: 'Search (billing)' },
  { keys: 'Enter', label: 'Add the highlighted item' },
  { keys: '+', label: 'One more of the last item' },
  { keys: '-', label: 'One less' },
  { keys: 'F9', label: 'Send KOT to the kitchen' },
  { keys: 'F8', label: 'Pay' },
  { keys: 'Ctrl+S', label: 'Save settings' },
  { keys: 'Esc', label: 'Close a panel or menu' },
];

export function ShortcutsSheet({ visible, onClose, items, extra }: {
  visible: boolean; onClose: () => void; items: { label: string; goKey?: string }[]; extra?: { keys: string; label: string }[];
}) {
  const { colors, radius } = useTheme();
  const go = items.filter((i) => i.goKey);
  const row = (keys: React.ReactNode, label: string, k: string) => (
    <View key={k} style={[styles.row, { borderBottomColor: colors.divider }]}>
      <Text variant="small" style={{ flex: 1 }} numberOfLines={1}>{label}</Text>
      <View style={styles.keys}>{keys}</View>
    </View>
  );
  return (
    <Sheet visible={visible} onClose={onClose} title="Keyboard shortcuts" subtitle="Press ? any time to see this list" width={720}>
      <View style={styles.cols}>
        <View style={[styles.col, { borderColor: colors.border, borderRadius: radius.lg }]}>
          <Text variant="caption" tone="subtle" style={styles.head}>GO TO</Text>
          {go.map((i) => row(<><ShortcutHint keys="G" force /><Text variant="caption" tone="subtle">then</Text><ShortcutHint keys={i.goKey!.toUpperCase()} force /></>, i.label, i.label))}
          {row(<ShortcutHint keys="[" force />, 'Collapse or expand the sidebar', 'sidebar')}
        </View>
        <View style={[styles.col, { borderColor: colors.border, borderRadius: radius.lg }]}>
          <Text variant="caption" tone="subtle" style={styles.head}>ON A SCREEN</Text>
          {[...(extra ?? []), ...SCREEN_KEYS].map((s) => row(<ShortcutHint keys={s.keys} force />, s.label, s.keys + s.label))}
        </View>
      </View>
    </Sheet>
  );
}

export function goKeyItems(items: NavItem[]) {
  return items.map((i) => ({ label: i.label, goKey: i.goKey }));
}

const styles = StyleSheet.create({
  cols: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  col: { flexGrow: 1, flexBasis: 300, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  head: { paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36, borderBottomWidth: StyleSheet.hairlineWidth },
  keys: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
