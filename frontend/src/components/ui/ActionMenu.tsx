/**
 * Anchored action menu (docs/20_High_Volume_UX.md §1.2, §5): a popover next to the trigger on
 * tablet/desktop/web, a bottom sheet within thumb reach on phones.
 *
 *   <ActionMenu
 *     items={[{ key: 'move', label: 'Move table', icon: 'swap-horizontal', shortcut: 'M', onPress: move },
 *             { key: 'cancel', label: 'Cancel bill…', icon: 'close-circle-outline', danger: true, onPress: cancel }]}
 *     trigger={(open) => <Button title="More" icon="ellipsis-horizontal" variant="outline" onPress={open} />}
 *   />
 */
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleProp, StyleSheet, View, ViewStyle, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { useHotkeys } from '@/hooks/useHotkeys';
import { Text } from './Text';
import { Button, IconButton } from './Button';
import { ShortcutHint } from './ShortcutHint';
import { computePopoverPosition, nextEnabledIndex, type PopoverPosition, type Rect } from './popover';

type IconName = keyof typeof Ionicons.glyphMap;

export interface ActionMenuItem {
  /** Stable key; defaults to the label. */
  key?: string;
  label: string;
  icon?: IconName;
  description?: string;
  /** Hint only (desktop web); bind the key with useHotkeys where it applies. */
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Shown under the label when disabled, so people know why. */
  disabledReason?: string;
  /** Shows a check mark (sort/filter menus). */
  selected?: boolean;
  /** Items with a different `group` than the previous item get a divider above them. */
  group?: string;
  hidden?: boolean;
  onPress: () => void;
}

export interface ActionMenuHandle { open: () => void; close: () => void }

export interface ActionMenuProps {
  items: ActionMenuItem[];
  /** Render the trigger; call `open()` from its onPress. Defaults to a "⋯" icon button. */
  trigger?: (open: () => void, state: { visible: boolean }) => React.ReactNode;
  /** Accessibility label of the default trigger and title of the phone sheet. */
  title?: string;
  /** Horizontal alignment of the popover relative to the trigger (flips automatically when it doesn't fit). */
  align?: 'start' | 'end';
  /** Preferred side (flips automatically). */
  placement?: 'bottom' | 'top';
  /** Popover width (desktop/tablet). */
  width?: number;
  /** auto = sheet on phones, popover elsewhere. */
  mode?: 'auto' | 'popover' | 'sheet';
  onOpenChange?: (visible: boolean) => void;
  /** Imperative handle: `menuRef.current?.open()` from a long-press, right-click or shortcut. */
  menuRef?: React.Ref<ActionMenuHandle>;
  /** Style of the wrapper around the trigger (it is measured to anchor the popover). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const ROW = 44;
const ROW_DESC = 58;
const SHEET_ROW = 52;
const SHEET_ROW_DESC = 64;
const DIVIDER = 9;
const PAD = 6;

function rowHasSubtitle(item: ActionMenuItem) {
  return !!item.description || (!!item.disabled && !!item.disabledReason);
}

/** Exact popover content height (rows are fixed height, so no measuring pass is needed). */
export function estimateMenuHeight(items: ActionMenuItem[]): number {
  let h = PAD * 2;
  items.forEach((item, i) => {
    if (i > 0 && item.group !== items[i - 1].group) h += DIVIDER;
    h += rowHasSubtitle(item) ? ROW_DESC : ROW;
  });
  return h;
}

export function ActionMenu({
  items, trigger, title, align = 'start', placement = 'bottom', width = 260, mode = 'auto', onOpenChange, menuRef, style, testID,
}: ActionMenuProps) {
  const { colors, radius, shadow } = useTheme();
  const { isPhone } = useLayout();
  const viewport = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const anchorRef = useRef<View>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const [visible, setVisible] = useState(false);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [active, setActive] = useState(-1);

  const shown = useMemo(() => items.filter((i) => !i.hidden), [items]);
  const asSheet = mode === 'sheet' || (mode === 'auto' && isPhone);

  const setOpen = useCallback((v: boolean) => {
    setVisible(v);
    onOpenChange?.(v);
  }, [onOpenChange]);

  const open = useCallback(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') lastFocus.current = document.activeElement as HTMLElement | null;
    setActive(-1);
    const node = anchorRef.current;
    if (!node || asSheet) { setAnchor(null); setOpen(true); return; }
    node.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, width: w, height: h });
      setOpen(true);
    });
  }, [asSheet, setOpen]);

  const runPending = useCallback(() => {
    const fn = pending.current;
    pending.current = null;
    fn?.();
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    if (Platform.OS === 'web') {
      const el = lastFocus.current;
      lastFocus.current = null;
      setTimeout(() => el?.focus?.(), 0);
    }
    // iOS cannot present a new modal (e.g. a Sheet) while this one is still dismissing: wait for it.
    setTimeout(runPending, Platform.OS === 'ios' ? 350 : 0);
  }, [setOpen, runPending]);

  useImperativeHandle(menuRef, () => ({ open, close }), [open, close]);

  const choose = useCallback((item: ActionMenuItem) => {
    if (item.disabled) return;
    pending.current = item.onPress;
    close();
  }, [close]);

  // Close if the window is resized or rotated: the anchor position is stale.
  useEffect(() => { if (visible && !asSheet) close(); }, [viewport.width, viewport.height]); // eslint-disable-line react-hooks/exhaustive-deps

  const disabledFlags = useMemo(() => shown.map((i) => !!i.disabled), [shown]);
  useHotkeys({
    ArrowDown: { handler: () => setActive((a) => nextEnabledIndex(disabledFlags, a, 1)), global: true, repeat: true },
    ArrowUp: { handler: () => setActive((a) => nextEnabledIndex(disabledFlags, a, -1)), global: true, repeat: true },
    Home: { handler: () => setActive(nextEnabledIndex(disabledFlags, -1, 1)), global: true },
    End: { handler: () => setActive(nextEnabledIndex(disabledFlags, -1, -1)), global: true },
    'Enter|Space': { handler: () => { if (active >= 0 && shown[active]) choose(shown[active]); else return false; }, global: true },
    Escape: { handler: () => close(), global: true },
    Tab: { handler: () => { close(); return false; }, global: true },
  }, [], { enabled: visible, capture: true });

  const position: PopoverPosition | null = useMemo(() => {
    if (!anchor) return null;
    return computePopoverPosition({
      anchor, menu: { width, height: estimateMenuHeight(shown) + 2 /* border */ }, viewport: { width: viewport.width, height: viewport.height },
      placement, align,
    });
  }, [anchor, width, shown, viewport.width, viewport.height, placement, align]);

  const renderRows = (sheet: boolean) => shown.map((item, index) => {
    const key = item.key ?? item.label;
    const sub = item.disabled && item.disabledReason ? item.disabledReason : item.description;
    const height = sheet ? (sub ? SHEET_ROW_DESC : SHEET_ROW) : (sub ? ROW_DESC : ROW);
    const fg = item.disabled ? colors.disabledText : item.danger ? colors.dangerText : colors.text;
    const iconColor = item.disabled ? colors.disabledText : item.danger ? colors.danger : colors.textMuted;
    const divider = index > 0 && item.group !== shown[index - 1].group;
    return (
      <React.Fragment key={key}>
        {divider ? <View style={[styles.divider, { backgroundColor: colors.divider }]} /> : null}
        <Pressable
          accessibilityRole="menuitem"
          accessibilityLabel={item.label}
          accessibilityHint={sub}
          accessibilityState={{ disabled: !!item.disabled, selected: !!item.selected }}
          disabled={item.disabled}
          onPress={() => choose(item)}
          onHoverIn={() => !item.disabled && setActive(index)}
          style={({ pressed }) => [
            styles.row,
            { height, borderRadius: sheet ? radius.md : radius.sm, paddingHorizontal: sheet ? 14 : 10 },
            (pressed || index === active) && !item.disabled
              ? { backgroundColor: item.danger ? colors.dangerSoft : colors.surfaceSunken } : null,
            Platform.OS === 'web' && ({ cursor: item.disabled ? 'not-allowed' : 'pointer', outlineStyle: 'none' } as any),
          ]}
        >
          {item.icon ? <Ionicons name={item.icon} size={sheet ? 20 : 18} color={iconColor} /> : null}
          <View style={styles.rowText}>
            <Text variant={sheet ? 'bodyStrong' : 'smallStrong'} color={fg} numberOfLines={1}>{item.label}</Text>
            {sub ? <Text variant="caption" color={item.disabled ? colors.disabledText : colors.textMuted} numberOfLines={1}>{sub}</Text> : null}
          </View>
          {item.selected ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
          {item.shortcut && !sheet ? <ShortcutHint keys={item.shortcut} /> : null}
        </Pressable>
      </React.Fragment>
    );
  });

  const triggerNode = trigger
    ? trigger(open, { visible })
    : <IconButton icon="ellipsis-horizontal" accessibilityLabel={title ?? 'More actions'} onPress={open} />;

  return (
    <>
      <View ref={anchorRef} collapsable={false} style={style} testID={testID}>
        {triggerNode}
      </View>
      {visible ? (
        <Modal
          visible
          transparent
          animationType={asSheet ? 'slide' : 'none'}
          onRequestClose={close}
          statusBarTranslucent
          navigationBarTranslucent
        >
          {asSheet ? (
            <View style={[styles.sheetBackdrop, { backgroundColor: colors.overlay }]}>
              <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close menu" />
              <View
                accessibilityRole="menu"
                accessibilityViewIsModal
                style={[styles.sheet, shadow(3), {
                  backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
                  paddingBottom: insets.bottom + 8, maxHeight: viewport.height * 0.8,
                }]}
              >
                <View style={[styles.grabber, { backgroundColor: colors.borderStrong }]} />
                {title ? <Text variant="h3" style={styles.sheetTitle} numberOfLines={1}>{title}</Text> : null}
                <ScrollView contentContainerStyle={styles.sheetBody} bounces={false}>{renderRows(true)}</ScrollView>
                <View style={styles.sheetFooter}>
                  <Button title="Cancel" variant="secondary" onPress={close} full />
                </View>
              </View>
            </View>
          ) : (
            <View style={StyleSheet.absoluteFill}>
              <Pressable
                style={[StyleSheet.absoluteFill, Platform.OS === 'web' && ({ cursor: 'default' } as any)]}
                onPress={close}
                accessibilityLabel="Close menu"
              />
              {position ? (
                <View
                  accessibilityRole="menu"
                  style={[styles.popover, shadow(3), {
                    left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight,
                    backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md,
                  }]}
                >
                  <ScrollView contentContainerStyle={{ padding: PAD }} bounces={false}>{renderRows(false)}</ScrollView>
                </View>
              ) : null}
            </View>
          )}
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { flex: 1, minWidth: 0 },
  divider: { height: 1, marginVertical: 4, marginHorizontal: 4 },
  popover: { position: 'absolute', borderWidth: 1, overflow: 'hidden' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { width: '100%', overflow: 'hidden' },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 8, marginBottom: 4 },
  sheetTitle: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 4 },
  sheetBody: { paddingHorizontal: 8, paddingVertical: 4 },
  sheetFooter: { paddingHorizontal: 16, paddingTop: 8 },
});
