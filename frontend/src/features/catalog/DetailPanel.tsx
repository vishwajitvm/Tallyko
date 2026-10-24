/**
 * Detail / editor surface for the back-office screens (docs/20_High_Volume_UX.md §3 "Detail"):
 * - tablet and desktop: an inline side panel next to the list, so the list stays visible and usable;
 * - phone: a full-screen page (Modal) with a sticky header and footer.
 *
 * The shared UI kit has no split view yet; this lives here and is used by Menu, Customers and Offers.
 * Put it as the last child of a row (`<View style={{ flex: 1, flexDirection: 'row' }}>{list}{panel}</View>`).
 */
import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { IconButton, Text, useHotkeys } from '@/components/ui';

export type PanelPresentation = 'panel' | 'screen';

/** Side panel width for a container width: wide enough for a form, never more than ~45% of the screen. */
export function panelWidth(windowWidth: number): number {
  if (windowWidth >= 1700) return 520;
  if (windowWidth >= 1300) return 460;
  if (windowWidth >= 1100) return 420;
  return 380;
}

/** Panel on tablet/desktop, full screen on phones. */
export function usePanelPresentation(): PanelPresentation {
  const { isPhone } = useLayout();
  return isPhone ? 'screen' : 'panel';
}

export function DetailPanel({
  title, subtitle, onClose, children, footer, headerRight, dismissable = true, width, scroll = true, testID,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerRight?: React.ReactNode;
  dismissable?: boolean;
  /** Panel width override (tablet/desktop). */
  width?: number;
  /** false: children manage their own scrolling (e.g. a list). */
  scroll?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const { isPhone, width: windowWidth } = useLayout();
  const insets = useSafeAreaInsets();

  // Esc closes the panel on desktop web (the screen's own Esc handler may ask about unsaved changes first)
  useHotkeys({ Escape: () => { if (dismissable) onClose(); } }, [dismissable, onClose], { enabled: !isPhone });

  const header = (
    <View style={[styles.header, { borderBottomColor: colors.divider, paddingTop: isPhone ? insets.top + 8 : 12 }]}>
      <IconButton icon={isPhone ? 'arrow-back' : 'close'} accessibilityLabel="Close" onPress={onClose} disabled={!dismissable} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="h3" numberOfLines={1}>{title}</Text>
        {subtitle ? <Text variant="small" tone="muted" numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {headerRight}
    </View>
  );
  const body = scroll ? (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">{children}</ScrollView>
  ) : (
    <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
  );
  const foot = footer ? (
    <View style={[styles.footer, { borderTopColor: colors.divider, paddingBottom: isPhone ? Math.max(12, insets.bottom) : 12 }]}>{footer}</View>
  ) : null;

  if (isPhone) {
    return (
      <Modal visible animationType="slide" onRequestClose={dismissable ? onClose : undefined} statusBarTranslucent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.surface }} testID={testID}>
          {header}
          {body}
          {foot}
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  return (
    <View
      testID={testID}
      accessibilityLabel={title}
      style={[styles.panel, { width: width ?? panelWidth(windowWidth), backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {header}
      {body}
      {foot}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 14, overflow: 'hidden', alignSelf: 'stretch', minHeight: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingBottom: 10, borderBottomWidth: 1 },
  body: { padding: 16, gap: 18 },
  footer: { paddingHorizontal: 14, paddingTop: 12, borderTopWidth: 1 },
});
