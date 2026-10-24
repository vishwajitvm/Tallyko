import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './ui/Text';

/** Tallyko mark: a receipt with a tick, in brand teal. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityLabel="Tallyko">
      <Rect width="32" height="32" rx="9" fill="#0F766E" />
      <Path d="M10 7.5h12a1.5 1.5 0 0 1 1.5 1.5v15.2l-2.25-1.4-2.25 1.4-2.25-1.4-2.25 1.4-2.25-1.4-2.25 1.4V9A1.5 1.5 0 0 1 10 7.5Z" fill="#FFFFFF" />
      <Path d="m12.4 15.6 2.6 2.6 5-5.2" stroke="#0F766E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function Logo({ size = 30, inverse = false }: { size?: number; inverse?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <LogoMark size={size} />
      <Text variant="h2" color={inverse ? '#FFFFFF' : colors.text} style={{ fontSize: size * 0.7, lineHeight: size * 0.9 }}>Tallyko</Text>
    </View>
  );
}
