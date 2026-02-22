/**
 * Tests for ThemeManager pure logic
 *
 * Uses tmpDir for config persistence — no real homedir pollution.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { ThemeManager, BUILTIN_THEMES } from '../../src/ui/themes';
import type { ThemeColors } from '../../src/ui/themes';

describe('ThemeManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'theme-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  function createManager(): ThemeManager {
    return new ThemeManager(path.join(tmpDir, 'theme.json'));
  }

  // --------------------------------------------------------------------------
  // Built-in themes
  // --------------------------------------------------------------------------

  describe('built-in themes', () => {
    it('should have at least 5 built-in themes', () => {
      expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(5);
    });

    it('should include dark, light, and high-contrast', () => {
      const ids = BUILTIN_THEMES.map(t => t.id);
      expect(ids).toContain('dark');
      expect(ids).toContain('light');
      expect(ids).toContain('high-contrast');
    });

    it('should have all required color keys in each theme', () => {
      const requiredKeys: (keyof ThemeColors)[] = [
        'primary', 'secondary', 'accent', 'background', 'surface',
        'text', 'textMuted', 'textInverse', 'success', 'warning',
        'error', 'info', 'border', 'divider', 'highlight', 'code', 'link', 'selection',
      ];
      for (const theme of BUILTIN_THEMES) {
        for (const key of requiredKeys) {
          expect(theme.colors[key]).toBeDefined();
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // Theme selection
  // --------------------------------------------------------------------------

  describe('theme selection', () => {
    it('should default to dark theme', () => {
      const mgr = createManager();
      expect(mgr.getTheme().id).toBe('dark');
    });

    it('should switch theme via setTheme()', () => {
      const mgr = createManager();
      expect(mgr.setTheme('light')).toBe(true);
      expect(mgr.getTheme().id).toBe('light');
    });

    it('should return false for unknown theme id', () => {
      const mgr = createManager();
      expect(mgr.setTheme('nonexistent')).toBe(false);
      expect(mgr.getTheme().id).toBe('dark'); // unchanged
    });

    it('should return specific color via getColor()', () => {
      const mgr = createManager();
      const primary = mgr.getColor('primary');
      expect(primary).toBe(BUILTIN_THEMES[0].colors.primary);
    });

    it('should return all colors via getColors()', () => {
      const mgr = createManager();
      const colors = mgr.getColors();
      expect(colors.primary).toBeDefined();
      expect(colors.error).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Custom themes
  // --------------------------------------------------------------------------

  describe('custom themes', () => {
    it('should add and retrieve custom theme', () => {
      const mgr = createManager();
      mgr.addTheme({
        id: 'custom-1',
        name: 'My Theme',
        colors: { ...BUILTIN_THEMES[0].colors, primary: '#ff0000' },
      });

      const theme = mgr.getThemeById('custom-1');
      expect(theme).toBeDefined();
      expect(theme!.name).toBe('My Theme');
      expect(theme!.isBuiltin).toBe(false);
      expect(theme!.colors.primary).toBe('#ff0000');
    });

    it('should remove custom theme', () => {
      const mgr = createManager();
      mgr.addTheme({
        id: 'removable',
        name: 'Removable',
        colors: BUILTIN_THEMES[0].colors,
      });
      expect(mgr.removeTheme('removable')).toBe(true);
      expect(mgr.getThemeById('removable')).toBeUndefined();
    });

    it('should not remove built-in theme', () => {
      const mgr = createManager();
      expect(mgr.removeTheme('dark')).toBe(false);
    });

    it('should reset to default when removing current custom theme', () => {
      const mgr = createManager();
      mgr.addTheme({
        id: 'current-custom',
        name: 'Current',
        colors: BUILTIN_THEMES[0].colors,
      });
      mgr.setTheme('current-custom');
      mgr.removeTheme('current-custom');
      expect(mgr.getTheme().id).toBe('dark');
    });

    it('should return false when removing nonexistent theme', () => {
      const mgr = createManager();
      expect(mgr.removeTheme('nope')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // createFromBase()
  // --------------------------------------------------------------------------

  describe('createFromBase()', () => {
    it('should create theme with overridden colors', () => {
      const mgr = createManager();
      const result = mgr.createFromBase('dark', 'my-dark', 'My Dark', {
        primary: '#ff00ff',
        error: '#00ff00',
      });

      expect(result).not.toBeNull();
      expect(result!.colors.primary).toBe('#ff00ff');
      expect(result!.colors.error).toBe('#00ff00');
      // Inherited from dark
      expect(result!.colors.background).toBe(BUILTIN_THEMES[0].colors.background);
    });

    it('should return null for nonexistent base', () => {
      const mgr = createManager();
      expect(mgr.createFromBase('nope', 'x', 'X', {})).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // getAllThemes()
  // --------------------------------------------------------------------------

  describe('getAllThemes()', () => {
    it('should include built-in and custom themes', () => {
      const mgr = createManager();
      mgr.addTheme({ id: 'extra', name: 'Extra', colors: BUILTIN_THEMES[0].colors });
      const all = mgr.getAllThemes();
      expect(all.length).toBe(BUILTIN_THEMES.length + 1);
    });
  });

  // --------------------------------------------------------------------------
  // formatThemeList() / formatThemePreview()
  // --------------------------------------------------------------------------

  describe('formatting', () => {
    it('should format theme list with markers', () => {
      const mgr = createManager();
      const list = mgr.formatThemeList();
      expect(list).toContain('Available Themes');
      expect(list).toContain('Built-in');
      expect(list).toContain('Dark');
    });

    it('should show custom section when custom themes exist', () => {
      const mgr = createManager();
      mgr.addTheme({ id: 'cust', name: 'Custom Theme', colors: BUILTIN_THEMES[0].colors });
      const list = mgr.formatThemeList();
      expect(list).toContain('Custom:');
      expect(list).toContain('Custom Theme');
    });

    it('should format theme preview', () => {
      const mgr = createManager();
      const preview = mgr.formatThemePreview('dark');
      expect(preview).toContain('Theme: Dark');
      expect(preview).toContain('primary');
    });

    it('should return "not found" for unknown theme preview', () => {
      const mgr = createManager();
      expect(mgr.formatThemePreview('nonexistent')).toBe('Theme not found');
    });
  });

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  describe('persistence', () => {
    it('should persist and reload theme preference', () => {
      const configPath = path.join(tmpDir, 'theme.json');
      const mgr1 = new ThemeManager(configPath);
      mgr1.setTheme('monokai');

      const mgr2 = new ThemeManager(configPath);
      expect(mgr2.getTheme().id).toBe('monokai');
    });

    it('should persist and reload custom themes', () => {
      const configPath = path.join(tmpDir, 'theme.json');
      const mgr1 = new ThemeManager(configPath);
      mgr1.addTheme({ id: 'persist-test', name: 'Persist', colors: BUILTIN_THEMES[0].colors });

      const mgr2 = new ThemeManager(configPath);
      expect(mgr2.getThemeById('persist-test')).toBeDefined();
    });
  });
});
