import React, { createContext, useContext, useState } from 'react';

const defaultColors = {
  primary: '#007AFF',
  secondary: '#5856D6',
  surface: '#ffffff',
  text: '#000000',
  background: '#f2f2f7',
};

const ThemeContext = createContext({
  colors: defaultColors,
  isDark: false,
  toggleTheme: () => {},
});

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(false);

  const toggleTheme = () => setIsDark(!isDark);

  const colors = isDark
    ? {
        primary: '#0A84FF',
        secondary: '#5E5CE6',
        surface: '#1c1c1e',
        text: '#ffffff',
        background: '#000000',
      }
    : defaultColors;

  return (
    <ThemeContext.Provider value={{ colors, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
