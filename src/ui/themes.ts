/**
 * Customizable Theme System
 *
 * Provides terminal color themes:
 * - Built-in themes (dark, light, high-contrast)
 * - Custom theme support
 * - Theme persistence
 * - Live theme switching
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export interface ThemeColors {
  // Primary colors
  primary: string;
  secondary: string;
  accent: string;

  // Background colors
  background: string;
  surface: string;

  // Text colors
  text: string;
  textMuted: string;
  textInverse: string;

  // Status colors
  success: string;
  warning: string;
  error: string;
  info: string;

  // UI elements
  border: string;
  divider: string;
  highlight: string;

  // Special elements
  code: string;
  link: string;
  selection: string;
}

export interface Theme {
  id: string;
  name: string;
  description?: string;
  author?: string;
  colors: ThemeColors;
  isBuiltin?: boolean;
}

/**
 * Built-in themes
 */
export const BUILTIN_THEMES: Theme[] = [
  {
    id: 'dark',
    name: 'Dark',
    description: 'Default dark theme',
    isBuiltin: true,
    colors: {
      primary: '#61afef',
      secondary: '#c678dd',
      accent: '#98c379',
      background: '#282c34',
      surface: '#21252b',
      text: '#abb2bf',
      textMuted: '#5c6370',
      textInverse: '#282c34',
      success: '#98c379',
      warning: '#e5c07b',
      error: '#e06c75',
      info: '#61afef',
      border: '#3e4451',
      divider: '#3e4451',
      highlight: '#2c323c',
      code: '#e5c07b',
      link: '#61afef',
      selection: '#3e4451',
    },
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Light theme for bright environments',
    isBuiltin: true,
    colors: {
      primary: '#4078f2',
      secondary: '#a626a4',
      accent: '#50a14f',
      background: '#fafafa',
      surface: '#ffffff',
      text: '#383a42',
      textMuted: '#a0a1a7',
      textInverse: '#fafafa',
      success: '#50a14f',
      warning: '#c18401',
      error: '#e45649',
      info: '#4078f2',
      border: '#d3d4d6',
      divider: '#e5e5e6',
      highlight: '#f0f0f0',
      code: '#986801',
      link: '#4078f2',
      selection: '#d7d7d8',
    },
  },
  {
    id: 'high-contrast',
    name: 'High Contrast',
    description: 'High contrast theme for accessibility',
    isBuiltin: true,
    colors: {
      primary: '#00ffff',
      secondary: '#ff00ff',
      accent: '#00ff00',
      background: '#000000',
      surface: '#1a1a1a',
      text: '#ffffff',
      textMuted: '#cccccc',
      textInverse: '#000000',
      success: '#00ff00',
      warning: '#ffff00',
      error: '#ff0000',
      info: '#00ffff',
      border: '#ffffff',
      divider: '#666666',
      highlight: '#333333',
      code: '#ffff00',
      link: '#00ffff',
      selection: '#444444',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai',
    description: 'Classic Monokai color scheme',
    isBuiltin: true,
    colors: {
      primary: '#66d9ef',
      secondary: '#ae81ff',
      accent: '#a6e22e',
      background: '#272822',
      surface: '#1e1f1c',
      text: '#f8f8f2',
      textMuted: '#75715e',
      textInverse: '#272822',
      success: '#a6e22e',
      warning: '#e6db74',
      error: '#f92672',
      info: '#66d9ef',
      border: '#49483e',
      divider: '#3e3d32',
      highlight: '#3e3d32',
      code: '#e6db74',
      link: '#66d9ef',
      selection: '#49483e',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    description: 'Popular Dracula theme',
    isBuiltin: true,
    colors: {
      primary: '#8be9fd',
      secondary: '#bd93f9',
      accent: '#50fa7b',
      background: '#282a36',
      surface: '#21222c',
      text: '#f8f8f2',
      textMuted: '#6272a4',
      textInverse: '#282a36',
      success: '#50fa7b',
      warning: '#f1fa8c',
      error: '#ff5555',
      info: '#8be9fd',
      border: '#44475a',
      divider: '#44475a',
      highlight: '#44475a',
      code: '#f1fa8c',
      link: '#8be9fd',
      selection: '#44475a',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    description: 'Solarized dark color scheme',
    isBuiltin: true,
    colors: {
      primary: '#268bd2',
      secondary: '#6c71c4',
      accent: '#859900',
      background: '#002b36',
      surface: '#073642',
      text: '#839496',
      textMuted: '#586e75',
      textInverse: '#002b36',
      success: '#859900',
      warning: '#b58900',
      error: '#dc322f',
      info: '#268bd2',
      border: '#073642',
      divider: '#073642',
      highlight: '#073642',
      code: '#b58900',
      link: '#268bd2',
      selection: '#073642',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Arctic-inspired color palette',
    isBuiltin: true,
    colors: {
      primary: '#88c0d0',
      secondary: '#b48ead',
      accent: '#a3be8c',
      background: '#2e3440',
      surface: '#3b4252',
      text: '#eceff4',
      textMuted: '#4c566a',
      textInverse: '#2e3440',
      success: '#a3be8c',
      warning: '#ebcb8b',
      error: '#bf616a',
      info: '#88c0d0',
      border: '#4c566a',
      divider: '#434c5e',
      highlight: '#434c5e',
      code: '#ebcb8b',
      link: '#88c0d0',
      selection: '#434c5e',
    },
  },
];

/**
 * Theme Manager
 */
export class ThemeManager {
  private themes: Map<string, Theme> = new Map();
  private currentTheme: Theme;
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(os.homedir(), '.codebuddy', 'theme.json');

    // Load built-in themes
    for (const theme of BUILTIN_THEMES) {
      this.themes.set(theme.id, theme);
    }

    // Set default theme
    this.currentTheme = BUILTIN_THEMES[0];

    // Load saved preference
    this.loadPreference();
  }

  /**
   * Get current theme
   */
  getTheme(): Theme {
    return this.currentTheme;
  }

  /**
   * Get theme colors
   */
  getColors(): ThemeColors {
    return this.currentTheme.colors;
  }

  /**
   * Get color by key
   */
  getColor(key: keyof ThemeColors): string {
    return this.currentTheme.colors[key];
  }

  /**
   * Set active theme
   */
  setTheme(themeId: string): boolean {
    const theme = this.themes.get(themeId);
    if (!theme) return false;

    this.currentTheme = theme;
    this.savePreference();
    return true;
  }

  /**
   * Add custom theme
   */
  addTheme(theme: Omit<Theme, 'isBuiltin'>): void {
    this.themes.set(theme.id, { ...theme, isBuiltin: false });
    this.saveCustomThemes();
  }

  /**
   * Remove custom theme
   */
  removeTheme(themeId: string): boolean {
    const theme = this.themes.get(themeId);
    if (!theme || theme.isBuiltin) return false;

    this.themes.delete(themeId);

    // Reset to default if removed current
    if (this.currentTheme.id === themeId) {
      this.currentTheme = BUILTIN_THEMES[0];
    }

    this.saveCustomThemes();
    return true;
  }

  /**
   * Get all available themes
   */
  getAllThemes(): Theme[] {
    return Array.from(this.themes.values());
  }

  /**
   * Get theme by ID
   */
  getThemeById(id: string): Theme | undefined {
    return this.themes.get(id);
  }

  /**
   * Create theme from base
   */
  createFromBase(baseId: string, newId: string, name: string, overrides: Partial<ThemeColors>): Theme | null {
    const base = this.themes.get(baseId);
    if (!base) return null;

    const newTheme: Theme = {
      id: newId,
      name,
      colors: { ...base.colors, ...overrides },
      isBuiltin: false,
    };

    this.addTheme(newTheme);
    return newTheme;
  }

  /**
   * Format theme list for display
   */
  formatThemeList(): string {
    const lines: string[] = [
      'Available Themes:',
      '',
    ];

    const builtin = this.getAllThemes().filter(t => t.isBuiltin);
    const custom = this.getAllThemes().filter(t => !t.isBuiltin);

    lines.push('Built-in:');
    for (const theme of builtin) {
      const marker = theme.id === this.currentTheme.id ? '●' : '○';
      lines.push(`  ${marker} ${theme.name} (${theme.id})`);
      if (theme.description) {
        lines.push(`    ${theme.description}`);
      }
    }

    if (custom.length > 0) {
      lines.push('');
      lines.push('Custom:');
      for (const theme of custom) {
        const marker = theme.id === this.currentTheme.id ? '●' : '○';
        lines.push(`  ${marker} ${theme.name} (${theme.id})`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Preview theme colors
   */
  formatThemePreview(themeId?: string): string {
    const theme = themeId ? this.themes.get(themeId) : this.currentTheme;
    if (!theme) return 'Theme not found';

    const { colors } = theme;
    const lines: string[] = [
      `Theme: ${theme.name}`,
      '─────────────────────',
      '',
    ];

    const colorEntries = Object.entries(colors) as [keyof ThemeColors, string][];
    for (const [key, value] of colorEntries) {
      lines.push(`  ${key.padEnd(15)} ${value}`);
    }

    return lines.join('\n');
  }

  /**
   * Load theme preference from file
   */
  private loadPreference(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readJsonSync(this.configPath);

        // Load custom themes
        if (data.customThemes && Array.isArray(data.customThemes)) {
          for (const theme of data.customThemes) {
            this.themes.set(theme.id, { ...theme, isBuiltin: false });
          }
        }

        // Set current theme
        if (data.currentTheme && this.themes.has(data.currentTheme)) {
          this.currentTheme = this.themes.get(data.currentTheme)!;
        }
      }
    } catch {
      // Ignore load errors, use defaults
    }
  }

  /**
   * Save current preference
   */
  private savePreference(): void {
    try {
      fs.ensureDirSync(path.dirname(this.configPath));

      const data = {
        currentTheme: this.currentTheme.id,
        customThemes: this.getAllThemes().filter(t => !t.isBuiltin),
      };

      fs.writeJsonSync(this.configPath, data, { spaces: 2 });
    } catch {
      // Ignore save errors
    }
  }

  /**
   * Save custom themes only
   */
  private saveCustomThemes(): void {
    this.savePreference();
  }
}

// Singleton instance
let themeManager: ThemeManager | null = null;

/**
 * Get or create theme manager
 */
export function getThemeManager(): ThemeManager {
  if (!themeManager) {
    themeManager = new ThemeManager();
  }
  return themeManager;
}

/**
 * Get current theme colors
 */
export function getThemeColors(): ThemeColors {
  return getThemeManager().getColors();
}

/**
 * Get specific color from current theme
 */
export function getColor(key: keyof ThemeColors): string {
  return getThemeManager().getColor(key);
}

export default ThemeManager;
