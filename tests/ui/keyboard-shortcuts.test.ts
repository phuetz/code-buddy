/**
 * Tests for ShortcutManager pure logic
 *
 * Uses tmpDir for config persistence — no React hooks tested.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { ShortcutManager, DEFAULT_SHORTCUTS } from '../../src/ui/keyboard-shortcuts';
import type { KeyBinding, ActionCategory } from '../../src/ui/keyboard-shortcuts';

describe('ShortcutManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shortcut-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  function createManager(): ShortcutManager {
    return new ShortcutManager(path.join(tmpDir, 'shortcuts.json'));
  }

  // --------------------------------------------------------------------------
  // Defaults
  // --------------------------------------------------------------------------

  describe('defaults', () => {
    it('should load all default shortcuts', () => {
      const mgr = createManager();
      const all = mgr.getAllActions();
      expect(all.length).toBe(DEFAULT_SHORTCUTS.length);
    });

    it('should have currentBinding matching defaultBinding initially', () => {
      const mgr = createManager();
      for (const action of mgr.getAllActions()) {
        expect(action.currentBinding.key).toBe(action.defaultBinding.key);
        expect(action.currentBinding.modifiers).toEqual(action.defaultBinding.modifiers);
      }
    });

    it('should cover all 5 categories', () => {
      const categories: ActionCategory[] = ['navigation', 'editing', 'session', 'tools', 'ui'];
      const mgr = createManager();
      for (const cat of categories) {
        expect(mgr.getActionsByCategory(cat).length).toBeGreaterThan(0);
      }
    });
  });

  // --------------------------------------------------------------------------
  // getAction / getActionForKey
  // --------------------------------------------------------------------------

  describe('getAction()', () => {
    it('should return action by id', () => {
      const mgr = createManager();
      const action = mgr.getAction('cancel');
      expect(action).toBeDefined();
      expect(action!.name).toBe('Cancel');
    });

    it('should return undefined for unknown id', () => {
      const mgr = createManager();
      expect(mgr.getAction('nonexistent')).toBeUndefined();
    });
  });

  describe('getActionForKey()', () => {
    it('should find action matching key + modifiers', () => {
      const mgr = createManager();
      // cancel = Ctrl+C
      const action = mgr.getActionForKey('c', ['ctrl']);
      expect(action).toBeDefined();
      expect(action!.id).toBe('cancel');
    });

    it('should return undefined for unbound key', () => {
      const mgr = createManager();
      expect(mgr.getActionForKey('x', ['ctrl', 'alt', 'shift'])).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // setBinding() — conflict detection
  // --------------------------------------------------------------------------

  describe('setBinding()', () => {
    it('should rebind an action', () => {
      const mgr = createManager();
      const newBinding: KeyBinding = { key: 'x', modifiers: ['ctrl'] };
      const result = mgr.setBinding('clear-input', newBinding);
      expect(result.success).toBe(true);
      expect(mgr.getAction('clear-input')!.currentBinding).toEqual(newBinding);
    });

    it('should detect conflict with existing binding', () => {
      const mgr = createManager();
      // Ctrl+C is already bound to 'cancel'
      const result = mgr.setBinding('clear-input', { key: 'c', modifiers: ['ctrl'] });
      expect(result.success).toBe(false);
      expect(result.conflict).toBe('cancel');
    });

    it('should return false for unknown action id', () => {
      const mgr = createManager();
      const result = mgr.setBinding('nonexistent', { key: 'a', modifiers: [] });
      expect(result.success).toBe(false);
    });

    it('should allow rebinding to same key (no self-conflict)', () => {
      const mgr = createManager();
      const action = mgr.getAction('cancel')!;
      const result = mgr.setBinding('cancel', action.currentBinding);
      expect(result.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // resetBinding() / resetAllBindings()
  // --------------------------------------------------------------------------

  describe('resetBinding()', () => {
    it('should restore default binding', () => {
      const mgr = createManager();
      mgr.setBinding('clear-input', { key: 'x', modifiers: ['ctrl'] });
      expect(mgr.resetBinding('clear-input')).toBe(true);

      const action = mgr.getAction('clear-input')!;
      expect(action.currentBinding.key).toBe(action.defaultBinding.key);
    });

    it('should return false for unknown action', () => {
      const mgr = createManager();
      expect(mgr.resetBinding('nonexistent')).toBe(false);
    });
  });

  describe('resetAllBindings()', () => {
    it('should restore all to defaults', () => {
      const mgr = createManager();
      mgr.setBinding('cancel', { key: 'x', modifiers: ['alt'] });
      mgr.setBinding('clear-input', { key: 'y', modifiers: ['alt'] });
      mgr.resetAllBindings();

      for (const action of mgr.getAllActions()) {
        expect(action.currentBinding.key).toBe(action.defaultBinding.key);
      }
    });
  });

  // --------------------------------------------------------------------------
  // setEnabled()
  // --------------------------------------------------------------------------

  describe('setEnabled()', () => {
    it('should disable an action', () => {
      const mgr = createManager();
      expect(mgr.setEnabled('cancel', false)).toBe(true);
      expect(mgr.getAction('cancel')!.enabled).toBe(false);
    });

    it('should return false for unknown action', () => {
      const mgr = createManager();
      expect(mgr.setEnabled('nonexistent', true)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // formatBinding()
  // --------------------------------------------------------------------------

  describe('formatBinding()', () => {
    it('should format simple key', () => {
      const mgr = createManager();
      expect(mgr.formatBinding({ key: 'a', modifiers: [] })).toBe('A');
    });

    it('should format Ctrl+key', () => {
      const mgr = createManager();
      expect(mgr.formatBinding({ key: 'c', modifiers: ['ctrl'] })).toBe('Ctrl+C');
    });

    it('should format multi-modifier binding', () => {
      const mgr = createManager();
      const result = mgr.formatBinding({ key: 'n', modifiers: ['ctrl', 'shift'] });
      expect(result).toBe('Ctrl+Shift+N');
    });

    it('should format special keys with symbols', () => {
      const mgr = createManager();
      expect(mgr.formatBinding({ key: 'ArrowUp', modifiers: [] })).toContain('↑');
      expect(mgr.formatBinding({ key: 'Enter', modifiers: [] })).toContain('↵');
      expect(mgr.formatBinding({ key: 'Backspace', modifiers: [] })).toContain('⌫');
      expect(mgr.formatBinding({ key: 'Tab', modifiers: [] })).toBe('Tab');
      expect(mgr.formatBinding({ key: ' ', modifiers: [] })).toBe('Space');
    });

    it('should format meta as Cmd', () => {
      const mgr = createManager();
      expect(mgr.formatBinding({ key: 'a', modifiers: ['meta'] })).toBe('Cmd+A');
    });
  });

  // --------------------------------------------------------------------------
  // formatShortcutsList()
  // --------------------------------------------------------------------------

  describe('formatShortcutsList()', () => {
    it('should contain all category headers', () => {
      const mgr = createManager();
      const list = mgr.formatShortcutsList();
      expect(list).toContain('NAVIGATION');
      expect(list).toContain('EDITING');
      expect(list).toContain('SESSION');
      expect(list).toContain('TOOLS');
      expect(list).toContain('UI');
    });

    it('should show disabled status', () => {
      const mgr = createManager();
      mgr.setEnabled('cancel', false);
      const list = mgr.formatShortcutsList();
      expect(list).toContain('(disabled)');
    });
  });

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  describe('persistence', () => {
    it('should persist and reload custom bindings', () => {
      const configPath = path.join(tmpDir, 'shortcuts.json');
      const mgr1 = new ShortcutManager(configPath);
      mgr1.setBinding('cancel', { key: 'x', modifiers: ['alt'] });

      const mgr2 = new ShortcutManager(configPath);
      expect(mgr2.getAction('cancel')!.currentBinding.key).toBe('x');
    });

    it('should persist and reload disabled actions', () => {
      const configPath = path.join(tmpDir, 'shortcuts.json');
      const mgr1 = new ShortcutManager(configPath);
      mgr1.setEnabled('exit', false);

      const mgr2 = new ShortcutManager(configPath);
      expect(mgr2.getAction('exit')!.enabled).toBe(false);
    });
  });
});
