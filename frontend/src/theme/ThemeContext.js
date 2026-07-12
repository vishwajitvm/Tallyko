import React, { createContext, useContext, useState, useMemo } from 'react';
import { palettes } from './palettes';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  const [themeName, setThemeName] = useState('light');

  const theme = useMemo(() => ({
    name: themeName,
    colors: palettes[themeName] || palettes.light,
    setTheme: setThemeName,
  }), [themeName]);

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
};
