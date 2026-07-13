// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  eventToBinding,
  getShortcutBinding,
  importShortcuts,
  matchesShortcut,
  resetShortcuts,
  saveShortcutBinding,
} from '../src/renderer/utils/shortcut-registry';

describe('shortcut registry', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses defaults and applies a persisted override to real keyboard matching', () => {
    expect(getShortcutBinding('commandPalette')).toBe('Mod+K');
    saveShortcutBinding('commandPalette', 'Mod+Shift+J');
    expect(matchesShortcut('commandPalette', new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matchesShortcut('commandPalette', new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))).toBe(false);
    resetShortcuts();
    expect(getShortcutBinding('commandPalette')).toBe('Mod+K');
  });

  it('captures and imports shareable bindings while ignoring unknown actions', () => {
    expect(eventToBinding(new KeyboardEvent('keydown', { key: 'p', metaKey: true, altKey: true }))).toBe('Mod+Alt+P');
    importShortcuts({ settings: 'Mod+Alt+,', malicious: 'Mod+X' });
    expect(getShortcutBinding('settings')).toBe('Mod+Alt+,');
    expect(localStorage.getItem('cowork.shortcuts.v1')).not.toContain('malicious');
  });
});
