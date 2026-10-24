import React, { forwardRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, TextInputProps, View, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, touch } from '@/theme/tokens';
import { Text } from './Text';

type IconName = keyof typeof Ionicons.glyphMap;

export interface InputProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  icon?: IconName;
  right?: React.ReactNode;
  prefix?: string;
  containerStyle?: StyleProp<ViewStyle>;
  required?: boolean;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, hint, error, icon, right, prefix, containerStyle, required, secureTextEntry, style, onFocus, onBlur, editable = true, ...rest },
  ref,
) {
  const { colors, radius } = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.focus : colors.border;

  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? (
        <Text variant="smallStrong" tone="muted">
          {label}
          {required ? <Text variant="smallStrong" tone="danger"> *</Text> : null}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          {
            borderColor,
            borderRadius: radius.md,
            backgroundColor: editable ? colors.surface : colors.surfaceSunken,
            minHeight: touch.min + 2,
          },
          focused && Platform.OS === 'web' && ({ boxShadow: `0 0 0 3px ${colors.primarySoft}` } as any),
        ]}
      >
        {icon ? <Ionicons name={icon} size={18} color={colors.textSubtle} style={{ marginLeft: 12 }} /> : null}
        {prefix ? <Text tone="muted" style={{ marginLeft: 12 }}>{prefix}</Text> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          {...rest}
          editable={editable}
          secureTextEntry={secureTextEntry && !revealed}
          placeholderTextColor={colors.textSubtle}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={[
            styles.input,
            { color: colors.text, fontFamily: fonts.regular },
            Platform.OS === 'web' && ({ outlineStyle: 'none' } as any),
            style,
          ]}
        />
        {secureTextEntry ? (
          <Pressable onPress={() => setRevealed((v) => !v)} accessibilityRole="button" accessibilityLabel={revealed ? 'Hide password' : 'Show password'} style={styles.reveal}>
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={19} color={colors.textSubtle} />
          </Pressable>
        ) : null}
        {right}
      </View>
      {error ? <Text variant="small" tone="danger">{error}</Text> : hint ? <Text variant="small" tone="subtle">{hint}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  input: { flex: 1, fontSize: 15, paddingHorizontal: 12, paddingVertical: Platform.OS === 'web' ? 11 : 10, minWidth: 0 },
  reveal: { paddingHorizontal: 12, height: '100%', justifyContent: 'center' },
});
