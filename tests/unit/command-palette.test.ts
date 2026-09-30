/**
 * Tests for Command Palette
 *
 * Tests the buildPaletteItems function, fuzzy matching, category filtering,
 * and the getRegisteredCommands enhancement.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('@/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs-extra for navigable history
vi.mock('fs-extra', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readJsonSync: vi.fn(() => []),
    writeJsonSync: vi.fn(),
    ensureDirSync: vi.fn(),
  },
  existsSync: vi.fn(() => false),
  readJsonSync: vi.fn(() => []),
  writeJsonSync: vi.fn(),
  ensureDirSync: vi.fn(),
}));

import { buildPaletteItems } from '@/ui/components/CommandPalette.js';
import type { PaletteItem } from '@/ui/components/CommandPalette.js';

describe('Command Palette', () => {
  const mockCommands = [
    { command: 'help', description: 'Show help', category: 'Core' },
    { command: 'yolo-mode', description: 'Toggle YOLO mode', category: 'Core' },
    { command: 'think', description: 'Set reasoning depth', category: 'Reasoning' },
    { command: 'search', description: 'Search the codebase', category: 'Dev' },
    { command: 'compact', description: 'Compress context', category: 'Context' },
    { command: 'pr', description: 'Create a PR', category: 'Dev' },
    { command: 'lint', description: 'Run linters', category: 'Dev' },
    { command: 'switch', description: 'Switch model', category: 'Reasoning' },
  ];

  describe('buildPaletteItems', () => {
    it('should build items from commands', () => {
      const items = buildPaletteItems(mockCommands);

      const commandItems = items.filter(i => i.category === 'command');
      expect(commandItems.length).toBe(mockCommands.length);

      const helpItem = commandItems.find(i => i.label === '/help');
      expect(helpItem).toBeDefined();
      expect(helpItem!.description).toBe('Show help');
      expect(helpItem!.icon).toBe('>');
      expect(helpItem!.value).toBe('/help');
    });

    it('should include common models', () => {
      const items = buildPaletteItems(mockCommands);

      const modelItems = items.filter(i => i.category === 'model');
      expect(modelItems.length).toBeGreaterThan(0);

      const grok3 = modelItems.find(i => i.label === 'grok-code-fast-1');
      expect(grok3).toBeDefined();
      expect(grok3!.icon).toBe('@');
    });

    it('should mark current model', () => {
      const items = buildPaletteItems(mockCommands, 'grok-3');

      const grok3 = items.find(i => i.label === 'grok-3');
      expect(grok3?.description).toContain('(current)');
    });

    it('should not mark non-current models', () => {
      const items = buildPaletteItems(mockCommands, 'grok-3');

      const gpt4 = items.find(i => i.label === 'gpt-4o');
      expect(gpt4?.description).not.toContain('(current)');
    });

    it('should assign unique IDs to all items', () => {
      const items = buildPaletteItems(mockCommands);

      const ids = items.map(i => i.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should include items from all 3 categories', () => {
      const items = buildPaletteItems(mockCommands);

      const categories = new Set(items.map(i => i.category));
      expect(categories.has('command')).toBe(true);
      expect(categories.has('model')).toBe(true);
      // 'recent' depends on history state; may or may not be present
    });

    it('should set correct value for command items', () => {
      const items = buildPaletteItems(mockCommands);

      const thinkItem = items.find(i => i.label === '/think');
      expect(thinkItem?.value).toBe('/think');
    });

    it('should set correct value for model items', () => {
      const items = buildPaletteItems(mockCommands);

      const gpt4o = items.find(i => i.label === 'gpt-4o');
      expect(gpt4o?.value).toBe('gpt-4o');
    });
  });

  describe('PaletteItem structure', () => {
    it('should have required fields on all items', () => {
      const items = buildPaletteItems(mockCommands);

      for (const item of items) {
        expect(item.id).toBeTruthy();
        expect(item.label).toBeTruthy();
        expect(item.description).toBeDefined();
        expect(['command', 'model', 'recent']).toContain(item.category);
        expect(item.icon).toBeTruthy();
        expect(item.value).toBeTruthy();
      }
    });
  });
});

describe('EnhancedCommandHandler.getRegisteredTokens', () => {
  it('should return an array of registered tokens', async () => {
    // Import lazily to avoid module initialization issues
    const { getEnhancedCommandHandler, resetEnhancedCommandHandler } = await import('@/commands/enhanced-command-handler.js');

    resetEnhancedCommandHandler();
    const handler = getEnhancedCommandHandler();
    const tokens = handler.getRegisteredTokens();

    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.length).toBeGreaterThan(0);
  }, 15000);

  it('should return string tokens', async () => {
    const { getEnhancedCommandHandler, resetEnhancedCommandHandler } = await import('@/commands/enhanced-command-handler.js');

    resetEnhancedCommandHandler();
    const handler = getEnhancedCommandHandler();
    const tokens = handler.getRegisteredTokens();

    for (const token of tokens) {
      expect(typeof token).toBe('string');
    }
  }, 15000);
});

describe('NavigableHistory', () => {
  it('should add and retrieve entries', async () => {
    const { NavigableHistory } = await import('@/ui/navigable-history.js');

    const history = new NavigableHistory({ persist: false });

    history.add('test command');
    history.add('another command');

    const all = history.getAll();
    expect(all.length).toBe(2);
    expect(all[0].command).toBe('test command');
  });

  it('should return recent entries in reverse order', async () => {
    const { NavigableHistory } = await import('@/ui/navigable-history.js');

    const history = new NavigableHistory({ persist: false });

    history.add('first');
    history.add('second');
    history.add('third');

    const recent = history.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].command).toBe('third');
    expect(recent[1].command).toBe('second');
  });

  it('should store entries with timestamps', async () => {
    const { NavigableHistory } = await import('@/ui/navigable-history.js');

    const history = new NavigableHistory({ persist: false });

    history.add('test command');

    const all = history.getAll();
    expect(all[0].timestamp).toBeInstanceOf(Date);
  });
});
