import React, { createContext, useContext, useMemo } from 'react';
import { Platform, useColorScheme, useWindowDimensions, ViewStyle } from 'react-native';
import { breakpoints, darkColors, lightColors, radius, space, type ThemeColors } from './tokens';
import { usePrefs } from '@/store/prefs';

export interface Theme {
  dark: boolean;
  colors: ThemeColors;
  space: typeof space;
  radius: typeof radius;
  shadow: (level?: 1 | 2 | 3) => ViewStyle;
}

const ThemeContext = createContext<Theme | null>(null);

function makeShadow(colors: ThemeColors, dark: boolean) {
  return (level: 1 | 2 | 3 = 1): ViewStyle => {
    const opacity = dark ? [0, 0.35, 0.45, 0.55][level] : [0, 0.05, 0.08, 0.14][level];
    const blur = [0, 3, 10, 24][level];
    if (Platform.OS === 'web') {
      return { boxShadow: `0 ${Math.ceil(blur / 3)}px ${blur}px rgba(${dark ? '0,0,0' : '15,23,42'},${opacity})` } as ViewStyle;
    }
    return {
      shadowColor: colors.shadow,
      shadowOpacity: opacity,
      shadowRadius: blur / 2,
      shadowOffset: { width: 0, height: Math.ceil(blur / 4) },
      elevation: level * 2,
    };
  };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const preference = usePrefs((s) => s.theme);
  const dark = preference === 'system' ? system === 'dark' : preference === 'dark';
  const value = useMemo<Theme>(() => {
    const colors = dark ? darkColors : lightColors;
    return { dark, colors, space, radius, shadow: makeShadow(colors, dark) };
  }, [dark]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside ThemeProvider');
  return theme;
}

/** Responsive helpers: phones get bottom tabs and stacked panes, tablets/desktops get sidebar + split panes. */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isPhone: width < breakpoints.tablet,
    isTablet: width >= breakpoints.tablet && width < breakpoints.desktop,
    isDesktop: width >= breakpoints.desktop,
    isWide: width >= breakpoints.tablet,
  };
}
