import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

/** Checkbox with a 44 px hit area. `indeterminate` shows a dash (e.g. "some rows selected"). */
export function Checkbox({ checked, indeterminate, onChange, label, disabled, accessibilityLabel, size = 20, style }: {
  checked: boolean; indeterminate?: boolean; onChange?: (next: boolean) => void; label?: string; disabled?: boolean;
  accessibilityLabel?: string; size?: number; style?: StyleProp<ViewStyle>;
}) {
  const { colors, radius } = useTheme();
  const on = checked || !!indeterminate;
  const fill = disabled ? colors.disabledBg : on ? colors.primary : colors.surface;
  const border = disabled ? colors.disabledBorder : on ? colors.primary : colors.borderStrong;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: indeterminate ? 'mixed' : checked, disabled: !!disabled }}
      disabled={disabled || !onChange}
      onPress={() => onChange?.(indeterminate ? true : !checked)}
      hitSlop={8}
      style={[styles.wrap, Platform.OS === 'web' && ({ cursor: disabled ? 'not-allowed' : 'pointer' } as any), style]}
    >
      <View style={[styles.box, { width: size, height: size, borderRadius: radius.sm - 1, backgroundColor: fill, borderColor: border }]}>
        {indeterminate ? <Ionicons name="remove" size={size - 4} color={colors.primaryText} />
          : checked ? <Ionicons name="checkmark" size={size - 4} color={disabled ? colors.disabledText : colors.primaryText} /> : null}
      </View>
      {label ? <Text variant="small" color={disabled ? colors.disabledText : colors.text}>{label}</Text> : null}
    </Pressable>
  );
}

/** Grey placeholder block that pulses while content loads. Give it a fixed size to avoid layout shift. */
export function Skeleton({ width = '100%', height = 14, radius: r, style }: {
  width?: number | `${number}%`; height?: number; radius?: number; style?: StyleProp<ViewStyle>;
}) {
  const { colors, radius } = useTheme();
  const opacity = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(opacity, { toValue: 0.55, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ width, height, borderRadius: r ?? radius.sm, backgroundColor: colors.skeleton, opacity }, style]} />;
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  box: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
