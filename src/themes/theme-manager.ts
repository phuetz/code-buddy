/**
 * Theme Manager for Grok CLI
 * Handles loading, saving, and managing themes and avatars
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  Theme,
  ThemeColor,
  ThemeColors,
  AvatarConfig,
  ThemePreferences,
  AvatarPreset,
  AVATAR_PRESETS,
  DEFAULT_AVATARS,
} from './theme.js';
import { BUILTIN_THEMES, DEFAULT_THEME } from './default-themes.js';
import { themeSchema, themePreferencesSchema } from './theme-schema.js';
import { logger } from '../utils/logger.js';

/**
 * Singleton manager for themes and avatars
 */
export class ThemeManager {
  private static instance: ThemeManager;
  private themes: Map<string, Theme> = new Map();
  private currentTheme: Theme = DEFAULT_THEME;
  private customAvatars: Partial<AvatarConfig> = {};
  private customColors: Partial<ThemeColors> = {};
  private themesDir: string;
  private preferencesPath: string;

  private constructor() {
    // Themes directory: ~/.codebuddy/themes/
    this.themesDir = path.join(os.homedir(), '.codebuddy', 'themes');
    // Preferences path: ~/.codebuddy/theme-preferences.json
    this.preferencesPath = path.join(os.homedir(), '.codebuddy', 'theme-preferences.json');

    this.initializeThemes();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }

  /**
   * Initialize themes from built-in and custom sources
   */
  private initializeThemes(): void {
    // Load built-in themes
    for (const theme of BUILTIN_THEMES) {
      this.themes.set(theme.id, theme);
    }

    // Load custom themes from disk
    this.loadCustomThemes();

    // Load preferences and set active theme
    this.loadPreferences();
  }

  /**
   * Ensure directory exists
   */
  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Load custom themes from ~/.codebuddy/themes/
   */
  private loadCustomThemes(): void {
    try {
      if (!fs.existsSync(this.themesDir)) {
        return;
      }

      const files = fs.readdirSync(this.themesDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(this.themesDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(content);

            // Validate theme structure with Zod
            const validationResult = themeSchema.safeParse(parsed);
            if (validationResult.success) {
              const theme = validationResult.data as Theme;
              theme.isBuiltin = false;
              this.themes.set(theme.id, theme);
            } else {
              logger.warn(`Invalid theme in ${file}: ${validationResult.error.issues.map((e: { message: string; path: PropertyKey[] }) => e.message).join(', ')}`, { source: 'ThemeManager' });
            }
          } catch (error) {
            if (error instanceof SyntaxError) {
              logger.warn(`Invalid JSON in theme file ${file}`, { source: 'ThemeManager' });
            } else {
              logger.warn(`Failed to load theme from ${file}`, { source: 'ThemeManager' });
            }
          }
        }
      }
    } catch (_error) {
      // Silently ignore if themes directory doesn't exist
    }
  }

  /**
   * Load theme preferences from disk
   */
  private loadPreferences(): void {
    try {
      if (!fs.existsSync(this.preferencesPath)) {
        return;
      }

      const content = fs.readFileSync(this.preferencesPath, 'utf-8');
      const parsed = JSON.parse(content);

      // Validate preferences structure with Zod
      const validationResult = themePreferencesSchema.safeParse(parsed);
      if (!validationResult.success) {
        logger.warn(`Invalid theme preferences: ${validationResult.error.issues.map((e: { message: string; path: PropertyKey[] }) => e.message).join(', ')}`, { source: 'ThemeManager' });
        return;
      }

      const preferences = validationResult.data as ThemePreferences;

      // Set active theme
      if (preferences.activeTheme && this.themes.has(preferences.activeTheme)) {
        this.currentTheme = this.themes.get(preferences.activeTheme)!;
      }

      // Set custom avatars
      if (preferences.customAvatars) {
        this.customAvatars = preferences.customAvatars;
      }

      // Set custom colors
      if (preferences.customColors) {
        this.customColors = preferences.customColors;
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.warn('Invalid JSON in theme preferences file', { source: 'ThemeManager' });
      }
      // Silently ignore other errors, use defaults
    }
  }

  /**
   * Save theme preferences to disk
   */
  private savePreferences(): void {
    try {
      this.ensureDirectoryExists(path.dirname(this.preferencesPath));

      const preferences: ThemePreferences = {
        activeTheme: this.currentTheme.id,
        customAvatars: Object.keys(this.customAvatars).length > 0 ? this.customAvatars : undefined,
        customColors: Object.keys(this.customColors).length > 0 ? this.customColors : undefined,
      };

      fs.writeFileSync(this.preferencesPath, JSON.stringify(preferences, null, 2));
    } catch (_error) {
      logger.warn('Failed to save theme preferences', { source: 'ThemeManager' });
    }
  }

  /**
   * Get all available themes
   */
  public getAvailableThemes(): Theme[] {
    return Array.from(this.themes.values());
  }

  /**
   * Get the current active theme
   */
  public getCurrentTheme(): Theme {
    return this.currentTheme;
  }

  /**
   * Get effective colors (theme colors with custom overrides)
   */
  public getColors(): ThemeColors {
    return {
      ...this.currentTheme.colors,
      ...this.customColors,
    };
  }

  /**
   * Get effective avatars (theme avatars with custom overrides)
   */
  public getAvatars(): AvatarConfig {
    return {
      ...this.currentTheme.avatars,
      ...this.customAvatars,
    };
  }

  /**
   * Set the active theme by ID
   */
  public setTheme(themeId: string): boolean {
    const theme = this.themes.get(themeId);
    if (!theme) {
      return false;
    }

    this.currentTheme = theme;
    this.savePreferences();
    return true;
  }

  /**
   * Get a theme by ID
   */
  public getTheme(themeId: string): Theme | undefined {
    return this.themes.get(themeId);
  }

  /**
   * Set custom avatar overrides
   */
  public setCustomAvatars(avatars: Partial<AvatarConfig>): void {
    this.customAvatars = avatars;
    this.savePreferences();
  }

  /**
   * Set a single custom avatar
   */
  public setCustomAvatar(key: keyof AvatarConfig, value: string): void {
    this.customAvatars[key] = value;
    this.savePreferences();
  }

  /**
   * Clear custom avatar overrides
   */
  public clearCustomAvatars(): void {
    this.customAvatars = {};
    this.savePreferences();
  }

  /**
   * Set custom color overrides
   */
  public setCustomColors(colors: Partial<ThemeColors>): void {
    this.customColors = colors;
    this.savePreferences();
  }

  /**
   * Set a single custom color
   */
  public setCustomColor(key: keyof ThemeColors, value: ThemeColor): void {
    this.customColors = { ...this.customColors, [key]: value };
    this.savePreferences();
  }

  /**
   * Clear custom color overrides
   */
  public clearCustomColors(): void {
    this.customColors = {};
    this.savePreferences();
  }

  /**
   * Apply an avatar preset
   */
  public applyAvatarPreset(presetId: string): boolean {
    const preset = AVATAR_PRESETS.find(p => p.id === presetId);
    if (!preset) {
      return false;
    }

    this.customAvatars = { ...preset.avatars };
    this.savePreferences();
    return true;
  }

  /**
   * Get all available avatar presets
   */
  public getAvatarPresets(): AvatarPreset[] {
    return AVATAR_PRESETS;
  }

  /**
   * Create a new custom theme
   */
  public createCustomTheme(
    id: string,
    name: string,
    description: string,
    colors: ThemeColors,
    avatars?: AvatarConfig
  ): Theme {
    const theme: Theme = {
      id,
      name,
      description,
      colors,
      avatars: avatars || DEFAULT_AVATARS,
      isBuiltin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.themes.set(id, theme);
    this.saveCustomTheme(theme);
    return theme;
  }

  /**
   * Save a custom theme to disk
   */
  private saveCustomTheme(theme: Theme): void {
    try {
      this.ensureDirectoryExists(this.themesDir);
      const filePath = path.join(this.themesDir, `${theme.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(theme, null, 2));
    } catch (_error) {
      logger.warn(`Failed to save custom theme: ${theme.id}`, { source: 'ThemeManager' });
    }
  }

  /**
   * Delete a custom theme
   */
  public deleteCustomTheme(themeId: string): boolean {
    const theme = this.themes.get(themeId);
    if (!theme || theme.isBuiltin) {
      return false;
    }

    this.themes.delete(themeId);

    // If the deleted theme was active, switch to default
    if (this.currentTheme.id === themeId) {
      this.currentTheme = DEFAULT_THEME;
      this.savePreferences();
    }

    // Delete from disk
    try {
      const filePath = path.join(this.themesDir, `${themeId}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (_error) {
      logger.warn(`Failed to delete theme file: ${themeId}`, { source: 'ThemeManager' });
    }

    return true;
  }

  /**
   * Clone an existing theme with a new ID and name
   */
  public cloneTheme(sourceThemeId: string, newId: string, newName: string): Theme | null {
    const sourceTheme = this.themes.get(sourceThemeId);
    if (!sourceTheme) {
      return null;
    }

    return this.createCustomTheme(
      newId,
      newName,
      `Custom theme based on ${sourceTheme.name}`,
      { ...sourceTheme.colors },
      { ...sourceTheme.avatars }
    );
  }

  /**
   * Export theme to JSON string
   */
  public exportTheme(themeId: string): string | null {
    const theme = this.themes.get(themeId);
    if (!theme) {
      return null;
    }

    return JSON.stringify(theme, null, 2);
  }

  /**
   * Import theme from JSON string
   */
  public importTheme(jsonString: string): Theme | null {
    try {
      const parsed = JSON.parse(jsonString);

      // Validate theme structure with Zod
      const validationResult = themeSchema.safeParse(parsed);
      if (!validationResult.success) {
        logger.warn('Invalid theme:', { source: 'ThemeManager', errors: validationResult.error.issues.map((e: { message: string; path: PropertyKey[] }) => `${e.path.join('.')}: ${e.message}`).join(', ') });
        return null;
      }

      const theme = validationResult.data as Theme;

      // Ensure it's marked as custom
      theme.isBuiltin = false;
      theme.createdAt = new Date();
      theme.updatedAt = new Date();

      this.themes.set(theme.id, theme);
      this.saveCustomTheme(theme);
      return theme;
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.warn('Invalid JSON in imported theme', { source: 'ThemeManager' });
      } else {
        logger.warn('Failed to import theme:', { source: 'ThemeManager', error });
      }
      return null;
    }
  }

  /**
   * Get theme preview text for display
   */
  public getThemePreview(themeId: string): string {
    const theme = this.themes.get(themeId);
    if (!theme) {
      return 'Theme not found';
    }

    return `${theme.name}: ${theme.description}`;
  }
}

/**
 * Convenience function to get the singleton instance
 */
export function getThemeManager(): ThemeManager {
  return ThemeManager.getInstance();
}
