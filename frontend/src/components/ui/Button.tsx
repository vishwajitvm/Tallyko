import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, ViewStyle, StyleProp, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme/ThemeProvider';
import type { ThemeColors } from '@/theme/tokens';
import { touch } from '@/theme/tokens';
import { Text } from './Text';
import { ShortcutHint } from './ShortcutHint';
import { toast } from './toastStore';

/**
 * Button variants (docs/20_High_Volume_UX.md §4):
 * - `primary`  solid brand — the main action.
 * - `success`  solid green — Pay / settle.
 * - `kitchen`  solid amber with dark text — KOT / send to kitchen (never confused with Pay).
 * - `tonal`    soft brand tint — common secondary actions (`soft` is the same look, kept for old screens).
 * - `outline` / `secondary`  bordered neutral.
 * - `ghost`    no chrome — toolbars, icon buttons.
 * - `dangerOutline`  red outline — destructive triggers ("Cancel bill…", "Delete…").
 * - `danger`   solid red — only inside the confirmation step.
 * - `accent`   solid amber (legacy name, same family as `kitchen`).
 */
export type ButtonVariant =
  | 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft' | 'success' | 'accent'
  | 'outline' | 'tonal' | 'kitchen' | 'dangerOutline';
export type ButtonSize = 'sm' | 'md' | 'lg';
type IconName = keyof typeof Ionicons.glyphMap;

export interface ButtonProps {
  title?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Why the button is disabled: shown on hover (web) and on tap / long-press (touch). */
  disabledReason?: string;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
  /** Keyboard shortcut hint, e.g. "F8" or "Ctrl+Enter". Only shown on desktop web. Does not bind the key — use useHotkeys. */
  shortcut?: string;
  /** Count bubble, e.g. "Send 2". Hidden when 0/undefined. */
  badge?: number;
}

interface VariantColors { bg: string; fg: string; border: string; hover: string; bubbleBg: string; bubbleFg: string }

export function buttonPalette(colors: ThemeColors, variant: ButtonVariant): VariantColors {
  const neutralBubble = { bubbleBg: colors.primary, bubbleFg: colors.primaryText };
  switch (variant) {
    case 'primary': return { bg: colors.primary, fg: colors.primaryText, border: colors.primary, hover: colors.primaryHover, bubbleBg: colors.primaryText, bubbleFg: colors.primary };
    case 'success': return { bg: colors.success, fg: colors.onSuccess, border: colors.success, hover: colors.successText, bubbleBg: colors.onSuccess, bubbleFg: colors.success };
    case 'kitchen': return { bg: colors.kitchen, fg: colors.onKitchen, border: colors.kitchen, hover: colors.kitchenHover, bubbleBg: colors.onKitchen, bubbleFg: colors.kitchen };
    case 'accent': return { bg: colors.accent, fg: colors.onAccent, border: colors.accent, hover: colors.kitchenHover, bubbleBg: colors.onAccent, bubbleFg: colors.accent };
    case 'danger': return { bg: colors.danger, fg: colors.onDanger, border: colors.danger, hover: colors.dangerText, bubbleBg: colors.onDanger, bubbleFg: colors.danger };
    case 'dangerOutline': return { bg: 'transparent', fg: colors.dangerText, border: colors.danger, hover: colors.dangerSoft, bubbleBg: colors.danger, bubbleFg: colors.onDanger };
    case 'soft':
    case 'tonal': return { bg: colors.primarySoft, fg: colors.primarySoftText, border: colors.primarySoft, hover: colors.surfaceSunken, ...neutralBubble };
    case 'outline': return { bg: 'transparent', fg: colors.text, border: colors.borderStrong, hover: colors.surfaceSunken, ...neutralBubble };
    case 'ghost': return { bg: 'transparent', fg: colors.textMuted, border: 'transparent', hover: colors.surfaceSunken, ...neutralBubble };
    case 'secondary':
    default: return { bg: colors.surface, fg: colors.text, border: colors.borderStrong, hover: colors.surfaceSunken, ...neutralBubble };
  }
}

const SIZES = {
  sm: { height: 36, padX: 12, icon: 16, text: 'smallStrong' as const },
  md: { height: touch.min, padX: 16, icon: 18, text: 'bodyStrong' as const },
  lg: { height: touch.comfortable + 4, padX: 22, icon: 20, text: 'bodyStrong' as const },
};

export function Button({
  title, onPress, onLongPress, variant = 'primary', size = 'md', icon, iconRight, loading, disabled, disabledReason, full, style,
  accessibilityLabel, testID, shortcut, badge,
}: ButtonProps) {
  const { colors, radius } = useTheme();
  const p = buttonPalette(colors, variant);
  const s = SIZES[size];
  const off = !!disabled && !loading;
  const inactive = !!disabled || !!loading;
  // Disabled = neutral grey fill + faded text: unmistakable, whatever the variant.
  const fg = off ? colors.disabledText : p.fg;
  const bg = off ? (variant === 'ghost' ? 'transparent' : colors.disabledBg) : p.bg;
  const border = off ? (variant === 'ghost' ? 'transparent' : colors.disabledBorder) : p.border;
  const ref = useRef<View>(null);

  // Native tooltip on web for the disabled reason.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node?.setAttribute) return;
    if (off && disabledReason) node.setAttribute('title', disabledReason);
    else node.removeAttribute('title');
  }, [off, disabledReason]);

  const explain = () => { if (disabledReason) toast.info(disabledReason); };
  const iconOnly = !title;
  const showBadge = !!badge && badge > 0;
  const badgeText = badge && badge > 99 ? '99+' : String(badge ?? '');

  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (title && showBadge ? `${title} (${badgeText})` : title)}
      accessibilityHint={off ? disabledReason : undefined}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      // A disabled button with a reason stays tappable so the tap can explain why.
      disabled={inactive && !(off && disabledReason)}
      onPress={off ? explain : onPress}
      onLongPress={off ? explain : onLongPress}
      style={({ pressed, hovered }: any) => [
        styles.base,
        {
          minHeight: s.height,
          paddingHorizontal: iconOnly ? 0 : s.padX,
          width: iconOnly ? s.height : undefined,
          borderRadius: radius.md,
          backgroundColor: !inactive && (pressed || hovered) ? p.hover : bg,
          borderColor: border,
          opacity: loading ? 0.85 : 1,
        },
        full && styles.full,
        Platform.OS === 'web' && ({ cursor: inactive ? 'not-allowed' : 'pointer', transitionDuration: '120ms', userSelect: 'none' } as any),
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={p.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={s.icon} color={fg} /> : null}
          {title ? (
            <Text variant={s.text} color={fg} numberOfLines={1} style={styles.title}>
              {title}
            </Text>
          ) : null}
          {showBadge && !iconOnly ? (
            <View style={[styles.inlineBubble, { backgroundColor: off ? colors.disabledBorder : p.bubbleBg }]}>
              <Text variant="caption" color={off ? colors.disabledText : p.bubbleFg} style={styles.bubbleText}>{badgeText}</Text>
            </View>
          ) : null}
          {iconRight ? <Ionicons name={iconRight} size={s.icon} color={fg} /> : null}
          {shortcut && !iconOnly && !off ? <ShortcutHint keys={shortcut} color={fg} /> : null}
        </View>
      )}
      {showBadge && iconOnly ? (
        <View style={[styles.cornerBubble, { backgroundColor: colors.bubble, borderColor: colors.surface }]}>
          <Text variant="caption" color={colors.onBubble} style={styles.bubbleText}>{badgeText}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, variant = 'ghost', size = 'md', accessibilityLabel, disabled, disabledReason, style, badge, loading, testID }: {
  icon: IconName; onPress?: () => void; variant?: ButtonVariant; size?: ButtonSize; accessibilityLabel: string; disabled?: boolean;
  disabledReason?: string; style?: StyleProp<ViewStyle>; badge?: number; loading?: boolean; testID?: string;
}) {
  return (
    <View>
      <Button icon={icon} onPress={onPress} variant={variant} size={size} accessibilityLabel={accessibilityLabel} disabled={disabled}
        disabledReason={disabledReason} style={style} badge={badge} loading={loading} testID={testID} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
  title: { flexShrink: 1 },
  full: { alignSelf: 'stretch' },
  inlineBubble: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  cornerBubble: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  bubbleText: { fontSize: 11, lineHeight: 14, letterSpacing: 0, fontVariant: ['tabular-nums'] },
});
