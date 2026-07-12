import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';

const lightColors = {
  primary: '#6C5CE7', // Vibrant purple
  secondary: '#FF7675', // Soft red/pink
  accent: '#00CEC9', // Cyan
  surface: '#FFFFFF',
  surfaceVariant: '#F8F9FA',
  text: '#2D3436',
  textSecondary: '#636E72',
  background: '#F0F3F8',
  border: '#DFE6E9',
  success: '#00B894',
  error: '#D63031',
  warning: '#FDCB6E',
};

const darkColors = {
  primary: '#A29BFE', // Soft purple
  secondary: '#FF9FF3', // Soft pink
  accent: '#81ECEC', // Light cyan
  surface: '#2D3436',
  surfaceVariant: '#353B48',
  text: '#F5F6FA',
  textSecondary: '#B2BEC3',
  background: '#1E272E',
  border: '#485460',
  success: '#55E6C1',
  error: '#FF7675',
  warning: '#FFEAA7',
};

const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

const borderRadius = {
  sm: 8,
  md: 16,
  lg: 24,
  pill: 999,
};

const ThemeContext = createContext({
  colors: lightColors,
  isDark: false,
  toggleTheme: () => {},
  spacing,
  borderRadius,
});

export const ThemeProvider = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [isDark, setIsDark] = useState(systemColorScheme === 'dark');

  useEffect(() => {
    setIsDark(systemColorScheme === 'dark');
  }, [systemColorScheme]);

  const toggleTheme = () => setIsDark(!isDark);

  const colors = isDark ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ colors, isDark, toggleTheme, spacing, borderRadius }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
