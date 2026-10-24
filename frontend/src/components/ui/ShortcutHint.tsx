import React, { useEffect, useState } from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useLayout, useTheme } from '@/theme/ThemeProvider';
import { formatShortcut } from '@/hooks/useHotkeys';
import { Text } from './Text';

function hasFinePointer(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/** True on web with a mouse/trackpad and a tablet-or-wider window: the only place keyboard hints make sense. */
export function useShowShortcuts(): boolean {
  const { isWide } = useLayout();
  const [fine, setFine] = useState(hasFinePointer);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setFine(mq.matches);
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return Platform.OS === 'web' && isWide && fine;
}

/**
 * Small keyboard-key hint ("F8", "Ctrl+↵", "/"). Renders nothing on phones, tablets and native apps.
 * `color` sets the text/border colour (e.g. the button's foreground); otherwise it uses muted text.
 */
export function ShortcutHint({ keys, color, style, force }: { keys: string; color?: string; style?: StyleProp<ViewStyle>; force?: boolean }) {
  const { colors, radius } = useTheme();
  const show = useShowShortcuts();
  if (!show && !force) return null;
  const c = color ?? colors.textSubtle;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.kbd, { borderColor: c, borderRadius: radius.sm }, style]}
    >
      <Text variant="caption" color={c} numberOfLines={1} style={styles.text}>{formatShortcut(keys)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  kbd: { borderWidth: 1, paddingHorizontal: 5, minWidth: 20, height: 18, alignItems: 'center', justifyContent: 'center', opacity: 0.8 },
  text: { fontSize: 11, lineHeight: 14, letterSpacing: 0 },
});
