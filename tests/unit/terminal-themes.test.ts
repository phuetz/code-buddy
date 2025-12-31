/**
 * Unit tests for ThemeManager (Terminal Themes)
 * Tests theme management, colors, persistence, and custom themes
 */

import * as path from 'path';

// Mock fs-extra
const mockExistsSync = jest.fn();
const mockReadJsonSync = jest.fn();
const mockWriteJsonSync = jest.fn();
const mockEnsureDirSync = jest.fn();

jest.mock('fs-extra', () => ({
  existsSync: mockExistsSync,
  readJsonSync: mockReadJsonSync,
  writeJsonSync: mockWriteJsonSync,
  ensureDirSync: mockEnsureDirSync,
}));

// Mock os module
const mockHomedir = jest.fn().mockReturnValue('/home/testuser');

jest.mock('os', () => ({
  homedir: () => mockHomedir(),
}));

import {
  ThemeManager,
  ThemeColors,
  Theme,
  BUILTIN_THEMES,
  getThemeManager,
  getThemeColors,
  getColor,
} from '../../src/ui/themes';

describe('ThemeManager', () => {
  let manager: ThemeManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe('Constructor', () => {
    it('should create manager with default theme', () => {
      manager = new ThemeManager();

      expect(manager).toBeDefined();
      expect(manager.getTheme().id).toBe('dark');
    });

    it('should create manager with custom config path', () => {
      manager = new ThemeManager('/custom/path/theme.json');

      expect(manager).toBeDefined();
    });

    it('should load all builtin themes', () => {
      manager = new ThemeManager();

      const themes = manager.getAllThemes();

      expect(themes.length).toBe(BUILTIN_THEMES.length);
    });

    it('should load saved preference from file', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonSync.mockReturnValue({
        currentTheme: 'monokai',
        customThemes: [],
      });

      manager = new ThemeManager();

      expect(manager.getTheme().id).toBe('monokai');
    });

    it('should load custom themes from file', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonSync.mockReturnValue({
        currentTheme: 'dark',
        customThemes: [
          {
            id: 'my-theme',
            name: 'My Theme',
            colors: BUILTIN_THEMES[0].colors,
          },
        ],
      });

      manager = new ThemeManager();

      const themes = manager.getAllThemes();
      expect(themes.find((t) => t.id === 'my-theme')).toBeDefined();
    });

    it('should handle corrupt config file gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonSync.mockImplementation(() => {
        throw new Error('JSON parse error');
      });

      manager = new ThemeManager();

      expect(manager.getTheme().id).toBe('dark');
    });

    it('should fallback to default if saved theme not found', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadJsonSync.mockReturnValue({
        currentTheme: 'non-existent-theme',
        customThemes: [],
      });

      manager = new ThemeManager();

      expect(manager.getTheme().id).toBe('dark');
    });
  });

  describe('getTheme', () => {
    beforeEach(() => {
      manager = new ThemeManager();
    });

    it('should return current theme', () => {
      const theme = manager.getTheme();

      expect(theme).toBeDefined();
      expect(theme.id).toBe('dark');
      expect(theme.name).toBe('Dark');
    });
  });

  describe('getColors', () => {
    beforeEach(() => {
      manager = new ThemeManager();
    });

    it('should return theme colors', () => {
      const colors = manager.getColors();

      expect(colors).toBeDefined();
      expect(colors.primary).toBeDefined();
      expect(colors.secondary).toBeDefined();
      expect(colors.background).toBeDefined();
      expect(colors.text).toBeDefined();
    });
  });

  describe('getColor', () => {
    beforeEach(() => {
      manager = new ThemeManager();
    });

    it('should return specific color by key', () => {
      const primaryColor = manager.getColor('primary');
      const errorColor = manager.getColor('error');

      expect(primaryColor).toBe('#61afef');
      expect(errorColor).toBe('#e06c75');
    });

    it('should return all color keys', () => {
      const colorKeys: (keyof ThemeColors)[] = [
        'primary',
        'secondary',
        'accent',
        'background',
        'surface',
        'text',
        'textMuted',
        'textInverse',
        'success',
        'warning',
        'error',
        'info',
        'border',
        'divider',
        'highlight',
        'code',
        'link',
        'selection',
      ];

      for (const key of colorKeys) {
        expect(manager.getColor(key)).toBeDefined();
      }
    });
  });

  describe('setTheme', () => {
    beforeEach(() => {
      manager = new ThemeManager();
    });

    it('should set theme by id', () => {
      const result = manager.setTheme('monokai');

      expect(result).toBe(true);
      expect(manager.getTheme().id).toBe('monokai');
    });

    it('should return false for non-existent theme', () => {
      const result = manager.setTheme('non-existent');

      expect(result).toBe(false);
      expect(manager.getTheme().id).toBe('dark');
    });

    it('should save preference when changing theme', () => {
      manager.setTheme('light');

      expect(mockEnsureDirSync).toHaveBeenCalled();
      expect(mockWriteJsonSync).toHaveBeenCalled();
    });

    it('should set all builtin themes', () => {
      for (const theme of BUILTIN_THEMES) {
        const result = manager.setTheme(theme.id);

        expect(result).toBe(true);
        expect(manager.getTheme().id).toBe(theme.id);
      }
    });
  });

  describe('addTheme', () => {
    beforeEach(() => {
      manager = new ThemeManager();
    });

    it('should add custom theme', () => {
      const customTheme = {
        id: 'my-custom',
        name: 'My Custom Theme',
        colors: { ...BUILTIN_THEMES[0].colors },
      };

      manager.addTheme(customTheme);

      const theme = manager.getThemeById('my-custom');
      expect(theme).toBeDefined();
      expect(theme?.name).toBe('My Custom Theme');
      expect(theme?.isBuiltin).toBe(false);
    });

    it('should save custom themes after adding', () => {
      const customTheme = {
        id: 'my-custom',
        name: 'My Custom Theme',
        colors: { ...BUILTIN_THEMES[0].colors },
      };

      manager.addTheme(customTheme);

      expect(mockWriteJsonSync).toHaveBeenCalled();
    });
  });

  describe('removeTheme', () => {
    beforeEach(() => {
      manager = new ThemeManager();
      manager.addTheme({
        id: 'removable',
        name: 'Removable Theme',
        colors: { ...BUILTIN_THEMES[0].colors },
      });
    });

    it('should remove custom theme', () => {
      const result = manager.removeTheme('removable');

      expect(result).toBe(true);
      expect(manager.getThemeById('removable')).toBeUndefined();
    });

    it('should not remove builtin theme', () => {
      const result = manager.removeTheme('dark');

      expect(result).toBe(false);
      expect(manager.getThemeById('dark')).toBeDefined();
    });

    it('should return false for non-existent theme', () => {
      const result = manager.removeTheme('non-existent');

      expect(result).toBe(false);
    });

    it('should reset to default if removing current theme', () => {
      manager.setTheme('removable');

      manager.removeTheme('removable');

      expect(manager.getTheme().id).toBe('dark');
    });

    it('should save after removing theme', () => {
      jest.clearAllMocks();

      manager.removeTheme('removable');

      expect(mockWriteJsonSync).toHaveBeenCalled();
    });
  });

  describe('getAllThemes', () => {
    beforeEach(() => {
      manager = new ThemeManager();
    });

    it('should return all themes', () => {
      const themes = manager.getAllThemes();

      expect(themes.length).toBe(BUILTIN_THEMES.length);
    });

    it('should include custom themes', () => {
      manager.addTheme({
        id: 'custom-1',
        name: 'Custom 1',
        colors: { ...BUILTIN_THEMES[0].colors },
      });

      const themes = manager.getAllThemes();

      expect(themes.length).toBe(BUILTIN_THEMES.length + 1);
    });
  });

  describe('getThemeById', () => {
    beforeEach(() => {
      manager = new ThemeManager();
    });

    it('should get theme by id', () => {
      const theme = manager.getThemeById('dracula');

      expect(theme).toBeDefined();
      expect(theme?.name).toBe('Dracula');
    });

    it('should return undefined for non-existent theme', () => {
      const theme = manager.getThemeById('non-existent');

      expect(theme).toBeUndefined();
    });
  });

  describe('createFromBase', () => {
    beforeEach(() => {
      manager = new ThemeManager();
    });

    it('should create theme from base with overrides', () => {
      const newTheme = manager.createFromBase('dark', 'my-dark', 'My Dark Theme', {
        primary: '#ff0000',
        secondary: '#00ff00',
      });

      expect(newTheme).not.toBeNull();
      expect(newTheme?.id).toBe('my-dark');
      expect(newTheme?.name).toBe('My Dark Theme');
      expect(newTheme?.colors.primary).toBe('#ff0000');
      expect(newTheme?.colors.secondary).toBe('#00ff00');
      // Original colors should be preserved
      expect(newTheme?.colors.background).toBe('#282c34');
    });

    it('should return null for non-existent base theme', () => {
      const newTheme = manager.createFromBase('non-existent', 'new-id', 'New Theme', {});

      expect(newTheme).toBeNull();
    });

    it('should mark created theme as non-builtin', () => {
      const newTheme = manager.createFromBase('dark', 'derived', 'Derived', {});

      expect(newTheme?.isBuiltin).toBe(false);
    });
  });

  describe('formatThemeList', () => {
    beforeEach(() => {
      manager = new ThemeManager();
    });

    it('should format theme list', () => {
      const formatted = manager.formatThemeList();

      expect(formatted).toContain('Available Themes');
      expect(formatted).toContain('Built-in');
      expect(formatted).toContain('Dark');
      expect(formatted).toContain('Light');
      expect(formatted).toContain('Monokai');
    });

    it('should mark current theme with bullet', () => {
      const formatted = manager.formatThemeList();

      // Current theme should have filled bullet
      expect(formatted).toContain('\u25cf'); // Filled bullet for current theme
    });

    it('should show description for themes with descriptions', () => {
      const formatted = manager.formatThemeList();

      expect(formatted).toContain('Default dark theme');
    });

    it('should show custom section when custom themes exist', () => {
      manager.addTheme({
        id: 'custom',
        name: 'Custom Theme',
        colors: { ...BUILTIN_THEMES[0].colors },
      });

      const formatted = manager.formatThemeList();

      expect(formatted).toContain('Custom');
      expect(formatted).toContain('Custom Theme');
    });
  });

  describe('formatThemePreview', () => {
    beforeEach(() => {
      manager = new ThemeManager();
    });

    it('should format current theme preview', () => {
      const preview = manager.formatThemePreview();

      expect(preview).toContain('Theme: Dark');
      expect(preview).toContain('primary');
      expect(preview).toContain('#61afef');
    });

    it('should format specific theme preview', () => {
      const preview = manager.formatThemePreview('monokai');

      expect(preview).toContain('Theme: Monokai');
    });

    it('should return error for non-existent theme', () => {
      const preview = manager.formatThemePreview('non-existent');

      expect(preview).toBe('Theme not found');
    });

    it('should show all color entries', () => {
      const preview = manager.formatThemePreview();

      expect(preview).toContain('primary');
      expect(preview).toContain('secondary');
      expect(preview).toContain('background');
      expect(preview).toContain('text');
      expect(preview).toContain('error');
      expect(preview).toContain('success');
    });
  });

  describe('Persistence', () => {
    it('should handle save errors gracefully', () => {
      mockWriteJsonSync.mockImplementation(() => {
        throw new Error('Write error');
      });

      manager = new ThemeManager();

      // Should not throw
      manager.setTheme('light');

      expect(manager.getTheme().id).toBe('light');
    });
  });
});

describe('BUILTIN_THEMES', () => {
  it('should have required themes', () => {
    const themeIds = BUILTIN_THEMES.map((t) => t.id);

    expect(themeIds).toContain('dark');
    expect(themeIds).toContain('light');
    expect(themeIds).toContain('high-contrast');
    expect(themeIds).toContain('monokai');
    expect(themeIds).toContain('dracula');
    expect(themeIds).toContain('solarized-dark');
    expect(themeIds).toContain('nord');
  });

  it('should have all required color properties', () => {
    const requiredColors: (keyof ThemeColors)[] = [
      'primary',
      'secondary',
      'accent',
      'background',
      'surface',
      'text',
      'textMuted',
      'textInverse',
      'success',
      'warning',
      'error',
      'info',
      'border',
      'divider',
      'highlight',
      'code',
      'link',
      'selection',
    ];

    for (const theme of BUILTIN_THEMES) {
      for (const color of requiredColors) {
        expect(theme.colors[color]).toBeDefined();
        expect(typeof theme.colors[color]).toBe('string');
        expect(theme.colors[color]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('should mark all builtin themes as builtin', () => {
    for (const theme of BUILTIN_THEMES) {
      expect(theme.isBuiltin).toBe(true);
    }
  });
});

describe('Singleton and Helper Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe('getThemeManager', () => {
    it('should return singleton instance', () => {
      const manager1 = getThemeManager();
      const manager2 = getThemeManager();

      expect(manager1).toBe(manager2);
    });
  });

  describe('getThemeColors', () => {
    it('should return current theme colors', () => {
      const colors = getThemeColors();

      expect(colors).toBeDefined();
      expect(colors.primary).toBeDefined();
    });
  });

  describe('getColor', () => {
    it('should return specific color from current theme', () => {
      const primaryColor = getColor('primary');

      expect(primaryColor).toBeDefined();
      expect(typeof primaryColor).toBe('string');
    });
  });
});
