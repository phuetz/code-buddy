/**
 * Session Pruning Tests
 */

import {
  PruningManager,
  getPruningManager,
  resetPruningManager,
  DEFAULT_PRUNING_CONFIG,
  type PrunableItem,
  type PruningRule,
  type PruningResult,
} from '../../src/session-pruning/index.js';

describe('Session Pruning', () => {
  let manager: PruningManager;

  beforeEach(() => {
    resetPruningManager();
    manager = new PruningManager({
      enabled: true,
      rules: [],
      checkIntervalMs: 1000,
      minPruneIntervalMs: 100,
      dryRun: false,
    });
  });

  afterEach(() => {
    manager.stop();
    resetPruningManager();
  });

  // Helper to create test items
  function createItem(overrides: Partial<PrunableItem> = {}): PrunableItem {
    return {
      id: `item-${Math.random().toString(36).slice(2)}`,
      sessionId: 'session-1',
      type: 'message',
      createdAt: new Date(),
      sizeBytes: 100,
      tokens: 50,
      ...overrides,
    };
  }

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const defaultManager = new PruningManager();
      const config = defaultManager.getConfig();

      expect(config.enabled).toBe(DEFAULT_PRUNING_CONFIG.enabled);
      expect(config.rules.length).toBeGreaterThan(0);
    });

    it('should update configuration', () => {
      manager.updateConfig({ enabled: false });
      expect(manager.getConfig().enabled).toBe(false);
    });

    it('should add rules', () => {
      const rule: PruningRule = {
        id: 'test-rule',
        name: 'Test Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'age', maxAgeMs: 1000 }],
        action: { type: 'delete' },
      };

      manager.addRule(rule);
      expect(manager.getConfig().rules).toContainEqual(rule);
    });

    it('should update existing rules', () => {
      const rule: PruningRule = {
        id: 'test-rule',
        name: 'Test Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'age', maxAgeMs: 1000 }],
        action: { type: 'delete' },
      };

      manager.addRule(rule);
      manager.addRule({ ...rule, priority: 200 });

      const rules = manager.getConfig().rules;
      expect(rules.filter(r => r.id === 'test-rule').length).toBe(1);
      expect(rules.find(r => r.id === 'test-rule')?.priority).toBe(200);
    });

    it('should remove rules', () => {
      const rule: PruningRule = {
        id: 'test-rule',
        name: 'Test Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'age', maxAgeMs: 1000 }],
        action: { type: 'delete' },
      };

      manager.addRule(rule);
      expect(manager.removeRule('test-rule')).toBe(true);
      expect(manager.getConfig().rules.find(r => r.id === 'test-rule')).toBeUndefined();
    });

    it('should enable/disable rules', () => {
      const rule: PruningRule = {
        id: 'test-rule',
        name: 'Test Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'age', maxAgeMs: 1000 }],
        action: { type: 'delete' },
      };

      manager.addRule(rule);
      manager.setRuleEnabled('test-rule', false);

      expect(manager.getConfig().rules.find(r => r.id === 'test-rule')?.enabled).toBe(false);
    });
  });

  describe('Session Configuration', () => {
    it('should set session-specific config', () => {
      manager.setSessionConfig('session-1', { exempt: true });

      const stats = manager.getStats();
      // Session config is internal, verified through pruning behavior
    });

    it('should remove session config', () => {
      manager.setSessionConfig('session-1', { exempt: true });
      expect(manager.removeSessionConfig('session-1')).toBe(true);
    });
  });

  describe('Item Management', () => {
    it('should add and retrieve items', () => {
      const item = createItem();
      manager.addItem(item);

      expect(manager.getItem(item.id)).toEqual(item);
    });

    it('should get all items', () => {
      const item1 = createItem();
      const item2 = createItem();

      manager.addItem(item1);
      manager.addItem(item2);

      expect(manager.getAllItems()).toHaveLength(2);
    });

    it('should get items by session', () => {
      const item1 = createItem({ sessionId: 'session-1' });
      const item2 = createItem({ sessionId: 'session-2' });

      manager.addItem(item1);
      manager.addItem(item2);

      expect(manager.getSessionItems('session-1')).toHaveLength(1);
    });

    it('should remove items', () => {
      const item = createItem();
      manager.addItem(item);

      expect(manager.removeItem(item.id)).toBe(true);
      expect(manager.getItem(item.id)).toBeUndefined();
    });

    it('should clear all items', () => {
      manager.addItem(createItem());
      manager.addItem(createItem());

      manager.clearItems();
      expect(manager.getAllItems()).toHaveLength(0);
    });
  });

  describe('Pruning - Age Condition', () => {
    it('should prune old items', async () => {
      const rule: PruningRule = {
        id: 'age-rule',
        name: 'Age Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'age', maxAgeMs: 1000 }],
        action: { type: 'delete' },
      };
      manager.addRule(rule);

      // Old item
      manager.addItem(createItem({
        createdAt: new Date(Date.now() - 2000),
      }));

      // New item
      manager.addItem(createItem({
        createdAt: new Date(),
      }));

      const result = await manager.prune();

      expect(result.success).toBe(true);
      expect(result.prunedItems.length).toBe(1);
      expect(manager.getAllItems().length).toBe(1);
    });
  });

  describe('Pruning - Size Condition', () => {
    it('should prune large items', async () => {
      const rule: PruningRule = {
        id: 'size-rule',
        name: 'Size Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'size', maxBytes: 500 }],
        action: { type: 'delete' },
      };
      manager.addRule(rule);

      manager.addItem(createItem({ sizeBytes: 1000 }));
      manager.addItem(createItem({ sizeBytes: 100 }));

      const result = await manager.prune();

      expect(result.prunedItems.length).toBe(1);
      expect(manager.getAllItems().length).toBe(1);
    });
  });

  describe('Pruning - Token Condition', () => {
    it('should prune items exceeding token limit', async () => {
      const rule: PruningRule = {
        id: 'token-rule',
        name: 'Token Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'tokens', maxTokens: 100 }],
        action: { type: 'delete' },
      };
      manager.addRule(rule);

      manager.addItem(createItem({ tokens: 200 }));
      manager.addItem(createItem({ tokens: 50 }));

      const result = await manager.prune();

      expect(result.prunedItems.length).toBe(1);
    });
  });

  describe('Pruning - Type Condition', () => {
    it('should prune items by type (include)', async () => {
      const rule: PruningRule = {
        id: 'type-rule',
        name: 'Type Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'type', messageTypes: ['checkpoint'], include: true }],
        action: { type: 'delete' },
      };
      manager.addRule(rule);

      manager.addItem(createItem({ type: 'checkpoint' }));
      manager.addItem(createItem({ type: 'message' }));

      const result = await manager.prune();

      expect(result.prunedItems.length).toBe(1);
      expect(result.prunedItems[0].item.type).toBe('checkpoint');
    });

    it('should prune items by type (exclude)', async () => {
      const rule: PruningRule = {
        id: 'type-rule',
        name: 'Type Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'type', messageTypes: ['message'], include: false }],
        action: { type: 'delete' },
      };
      manager.addRule(rule);

      manager.addItem(createItem({ type: 'checkpoint' }));
      manager.addItem(createItem({ type: 'message' }));

      const result = await manager.prune();

      expect(result.prunedItems.length).toBe(1);
      expect(result.prunedItems[0].item.type).toBe('checkpoint');
    });
  });

  describe('Pruning Actions', () => {
    it('should delete items', async () => {
      const rule: PruningRule = {
        id: 'delete-rule',
        name: 'Delete Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'age', maxAgeMs: 1 }],
        action: { type: 'delete' },
      };
      manager.addRule(rule);

      const item = createItem({ createdAt: new Date(Date.now() - 100) });
      manager.addItem(item);

      await manager.prune();

      expect(manager.getItem(item.id)).toBeUndefined();
    });

    it('should archive items', async () => {
      const rule: PruningRule = {
        id: 'archive-rule',
        name: 'Archive Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'age', maxAgeMs: 1 }],
        action: { type: 'archive', destination: 'archive-folder' },
      };
      manager.addRule(rule);

      const item = createItem({ createdAt: new Date(Date.now() - 100) });
      manager.addItem(item);

      await manager.prune();

      expect(manager.getItem(item.id)).toBeUndefined();
      expect(manager.getArchivedItems().length).toBe(1);
    });

    it('should summarize items', async () => {
      const rule: PruningRule = {
        id: 'summarize-rule',
        name: 'Summarize Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'size', maxBytes: 50 }],
        action: { type: 'summarize', targetTokens: 25 },
      };
      manager.addRule(rule);

      const item = createItem({
        sizeBytes: 100,
        tokens: 100,
        content: 'This is a long content that should be summarized to a shorter version.',
      });
      manager.addItem(item);

      await manager.prune();

      const prunedItem = manager.getItem(item.id);
      expect(prunedItem?.content).toContain('[summarized]');
    });

    it('should compact items', async () => {
      const rule: PruningRule = {
        id: 'compact-rule',
        name: 'Compact Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'size', maxBytes: 50 }],
        action: { type: 'compact', ratio: 0.5 },
      };
      manager.addRule(rule);

      const item = createItem({
        sizeBytes: 100,
        tokens: 100,
        content: 'This is content that should be compacted.',
      });
      manager.addItem(item);

      await manager.prune();

      const compactedItem = manager.getItem(item.id);
      expect(compactedItem?.tokens).toBe(50);
    });
  });

  describe('Session Exemption', () => {
    it('should skip exempt sessions', async () => {
      const rule: PruningRule = {
        id: 'delete-rule',
        name: 'Delete Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'age', maxAgeMs: 1 }],
        action: { type: 'delete' },
      };
      manager.addRule(rule);
      manager.setSessionConfig('session-1', { exempt: true });

      const item = createItem({ createdAt: new Date(Date.now() - 100) });
      manager.addItem(item);

      const result = await manager.prune();

      expect(result.skippedItems.length).toBe(1);
      expect(manager.getItem(item.id)).toBeDefined();
    });

    it('should force prune exempt sessions', async () => {
      const rule: PruningRule = {
        id: 'delete-rule',
        name: 'Delete Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'age', maxAgeMs: 1 }],
        action: { type: 'delete' },
      };
      manager.addRule(rule);
      manager.setSessionConfig('session-1', { exempt: true });

      const item = createItem({ createdAt: new Date(Date.now() - 100) });
      manager.addItem(item);

      const result = await manager.prune({ force: true });

      expect(result.prunedItems.length).toBe(1);
    });
  });

  describe('Dry Run', () => {
    it('should not modify items in dry run mode', async () => {
      manager.updateConfig({ dryRun: true });

      const rule: PruningRule = {
        id: 'delete-rule',
        name: 'Delete Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'age', maxAgeMs: 1 }],
        action: { type: 'delete' },
      };
      manager.addRule(rule);

      const item = createItem({ createdAt: new Date(Date.now() - 100) });
      manager.addItem(item);

      const result = await manager.prune();

      expect(result.prunedItems.length).toBe(1);
      expect(result.prunedItems[0].reason).toContain('dry run');
      expect(manager.getItem(item.id)).toBeDefined(); // Still exists
    });
  });

  describe('Events', () => {
    it('should emit events during pruning', async () => {
      const events: string[] = [];

      manager.on('start', () => events.push('start'));
      manager.on('progress', () => events.push('progress'));
      manager.on('item-pruned', () => events.push('item-pruned'));
      manager.on('complete', () => events.push('complete'));

      const rule: PruningRule = {
        id: 'delete-rule',
        name: 'Delete Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'age', maxAgeMs: 1 }],
        action: { type: 'delete' },
      };
      manager.addRule(rule);

      manager.addItem(createItem({ createdAt: new Date(Date.now() - 100) }));

      await manager.prune();

      expect(events).toContain('start');
      expect(events).toContain('progress');
      expect(events).toContain('item-pruned');
      expect(events).toContain('complete');
    });
  });

  describe('Statistics', () => {
    it('should calculate statistics', () => {
      manager.addItem(createItem({ sizeBytes: 100, tokens: 50 }));
      manager.addItem(createItem({ sizeBytes: 200, tokens: 100, sessionId: 'session-2' }));

      const stats = manager.getStats();

      expect(stats.globalStats.totalItems).toBe(2);
      expect(stats.globalStats.totalBytes).toBe(300);
      expect(stats.globalStats.totalTokens).toBe(150);
      expect(stats.globalStats.totalSessions).toBe(2);
    });

    it('should return pruning result stats', async () => {
      const rule: PruningRule = {
        id: 'delete-rule',
        name: 'Delete Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'age', maxAgeMs: 1 }],
        action: { type: 'delete' },
      };
      manager.addRule(rule);

      manager.addItem(createItem({
        createdAt: new Date(Date.now() - 100),
        sizeBytes: 500,
        tokens: 200,
      }));

      const result = await manager.prune();

      expect(result.stats.scannedCount).toBe(1);
      expect(result.stats.prunedCount).toBe(1);
      expect(result.stats.freedBytes).toBe(500);
      expect(result.stats.freedTokens).toBe(200);
      expect(result.stats.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Custom Evaluators', () => {
    it('should use custom condition evaluators', async () => {
      manager.registerEvaluator('isImportant', (item) => {
        return item.metadata?.important === true;
      });

      const rule: PruningRule = {
        id: 'custom-rule',
        name: 'Custom Rule',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'custom', fn: 'isImportant' }],
        action: { type: 'delete' },
      };
      manager.addRule(rule);

      manager.addItem(createItem({ metadata: { important: true } }));
      manager.addItem(createItem({ metadata: { important: false } }));

      const result = await manager.prune();

      expect(result.prunedItems.length).toBe(1);
    });
  });

  describe('Rule Priority', () => {
    it('should apply rules in priority order', async () => {
      const lowPriorityRule: PruningRule = {
        id: 'low-priority',
        name: 'Low Priority',
        priority: 10,
        enabled: true,
        conditions: [{ type: 'age', maxAgeMs: 1 }],
        action: { type: 'archive' },
      };

      const highPriorityRule: PruningRule = {
        id: 'high-priority',
        name: 'High Priority',
        priority: 100,
        enabled: true,
        conditions: [{ type: 'age', maxAgeMs: 1 }],
        action: { type: 'delete' },
      };

      manager.addRule(lowPriorityRule);
      manager.addRule(highPriorityRule);

      manager.addItem(createItem({ createdAt: new Date(Date.now() - 100) }));

      const result = await manager.prune();

      // High priority rule (delete) should be applied
      expect(result.prunedItems[0].action).toBe('delete');
    });
  });
});

describe('Singleton', () => {
  beforeEach(() => {
    resetPruningManager();
  });

  afterEach(() => {
    resetPruningManager();
  });

  it('should return same instance', () => {
    const manager1 = getPruningManager();
    const manager2 = getPruningManager();

    expect(manager1).toBe(manager2);
  });

  it('should reset instance', () => {
    const manager1 = getPruningManager();
    resetPruningManager();
    const manager2 = getPruningManager();

    expect(manager1).not.toBe(manager2);
  });
});
