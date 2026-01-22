/**
 * Theme Context for Grok CLI
 * Provides theme and avatar information to all UI components
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { Theme, ThemeColor, ThemeColors, AvatarConfig, AvatarPreset } from '../../themes/theme.js';
import { getThemeManager, ThemeManager } from '../../themes/theme-manager.js';

/**
 * Theme context value interface
 */
interface ThemeContextValue {
  // Current theme
  theme: Theme;
  colors: ThemeColors;
  avatars: AvatarConfig;

  // Theme management
  setTheme: (themeId: string) => boolean;
  getAvailableThemes: () => Theme[];

  // Avatar management
  setAvatarPreset: (presetId: string) => boolean;
  setCustomAvatar: (key: keyof AvatarConfig, value: string) => void;
  clearCustomAvatars: () => void;
  getAvatarPresets: () => AvatarPreset[];

  // Color management
  setCustomColor: (key: keyof ThemeColors, value: ThemeColor) => void;
  clearCustomColors: () => void;

  // Force re-render
  refreshTheme: () => void;
}

/**
 * Create the theme context
 */
const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Theme provider props
 */
interface ThemeProviderProps {
  children: React.ReactNode;
}

/**
 * Theme provider component
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeManager] = useState<ThemeManager>(() => getThemeManager());
  const [refreshKey, setRefreshKey] = useState(0);

  // Force re-render when theme changes
  const refreshTheme = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  // Get current theme data
  const theme = themeManager.getCurrentTheme();
  const colors = themeManager.getColors();
  const avatars = themeManager.getAvatars();

  // Theme management functions
  const setTheme = useCallback((themeId: string): boolean => {
    const result = themeManager.setTheme(themeId);
    if (result) {
      refreshTheme();
    }
    return result;
  }, [themeManager, refreshTheme]);

  const getAvailableThemes = useCallback((): Theme[] => {
    return themeManager.getAvailableThemes();
  }, [themeManager]);

  // Avatar management functions
  const setAvatarPreset = useCallback((presetId: string): boolean => {
    const result = themeManager.applyAvatarPreset(presetId);
    if (result) {
      refreshTheme();
    }
    return result;
  }, [themeManager, refreshTheme]);

  const setCustomAvatar = useCallback((key: keyof AvatarConfig, value: string): void => {
    themeManager.setCustomAvatar(key, value);
    refreshTheme();
  }, [themeManager, refreshTheme]);

  const clearCustomAvatars = useCallback((): void => {
    themeManager.clearCustomAvatars();
    refreshTheme();
  }, [themeManager, refreshTheme]);

  const getAvatarPresets = useCallback((): AvatarPreset[] => {
    return themeManager.getAvatarPresets();
  }, [themeManager]);

  // Color management functions
  const setCustomColor = useCallback((key: keyof ThemeColors, value: ThemeColor): void => {
    themeManager.setCustomColor(key, value);
    refreshTheme();
  }, [themeManager, refreshTheme]);

  const clearCustomColors = useCallback((): void => {
    themeManager.clearCustomColors();
    refreshTheme();
  }, [themeManager, refreshTheme]);

  // Memoize context value to prevent unnecessary re-renders of consumers
  // refreshKey is included to trigger updates when theme changes
  const contextValue = useMemo<ThemeContextValue>(() => ({
    theme,
    colors,
    avatars,
    setTheme,
    getAvailableThemes,
    setAvatarPreset,
    setCustomAvatar,
    clearCustomAvatars,
    getAvatarPresets,
    setCustomColor,
    clearCustomColors,
    refreshTheme,
  }), [
    theme, colors, avatars, refreshKey,
    setTheme, getAvailableThemes, setAvatarPreset,
    setCustomAvatar, clearCustomAvatars, getAvatarPresets,
    setCustomColor, clearCustomColors, refreshTheme
  ]);

  // Note: Removed key={refreshKey} antipattern - it caused entire tree to unmount/remount
  // The useMemo with refreshKey dependency properly triggers re-renders without destroying state
  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access theme context
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

/**
 * Hook to get only colors (for components that only need colors)
 */
export function useThemeColors(): ThemeColors {
  const { colors } = useTheme();
  return colors;
}

/**
 * Hook to get only avatars (for components that only need avatars)
 */
export function useAvatars(): AvatarConfig {
  const { avatars } = useTheme();
  return avatars;
}
