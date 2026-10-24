/**
 * Minimal inline markup for long-form public pages:
 *   [[Placeholder]]        → highlighted "fill this in" marker
 *   {{/path|link text}}    → in-app link
 *   **bold**               → strong text
 */
import React from 'react';
import { View } from 'react-native';
import { Link, type Href } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from '@/components/ui';

const TOKEN = /(\[\[[^\]]+\]\]|\{\{[^}]+\}\}|\*\*[^*]+\*\*)/g;

export function Rich({ children, variant = 'body', tone = 'muted' }: { children: string; variant?: 'body' | 'small'; tone?: 'muted' | 'default' }) {
  const { colors } = useTheme();
  const parts = children.split(TOKEN).filter(Boolean);
  return (
    <Text variant={variant} tone={tone} style={{ lineHeight: variant === 'body' ? 25 : 20 }}>
      {parts.map((part, i) => {
        if (part.startsWith('[[')) {
          return (
            <Text key={i} variant={variant === 'body' ? 'bodyStrong' : 'smallStrong'} color={colors.accentText}
              style={{ backgroundColor: colors.accentSoft, borderRadius: 4 }} accessibilityLabel={`Placeholder: ${part.slice(2, -2)}`}>
              {` ${part.slice(2, -2)} `}
            </Text>
          );
        }
        if (part.startsWith('{{')) {
          const [href, label] = part.slice(2, -2).split('|');
          return (
            <Link key={i} href={href as Href} accessibilityRole="link">
              <Text variant={variant === 'body' ? 'bodyStrong' : 'smallStrong'} tone="primary" style={{ textDecorationLine: 'underline' }}>{label ?? href}</Text>
            </Link>
          );
        }
        if (part.startsWith('**')) {
          return <Text key={i} variant={variant === 'body' ? 'bodyStrong' : 'smallStrong'} tone="default">{part.slice(2, -2)}</Text>;
        }
        return part;
      })}
    </Text>
  );
}

export function Bullets({ items }: { items: string[] }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 8 }} accessibilityRole="list">
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10, paddingLeft: 4 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary, marginTop: 10 }} />
          <View style={{ flex: 1 }}><Rich>{item}</Rich></View>
        </View>
      ))}
    </View>
  );
}
