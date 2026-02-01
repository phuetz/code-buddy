/**
 * Allowlist Store Tests
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { AllowlistStore, resetAllowlistStore } from '../../../src/security/bash-allowlist/allowlist-store.js';

describe('AllowlistStore', () => {
  let store: AllowlistStore;
  let tempDir: string;

  beforeEach(async () => {
    // Create temp directory for test config
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allowlist-test-'));
    resetAllowlistStore();
    store = new AllowlistStore(tempDir);
    await store.initialize();
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(store.isInitialized()).toBe(true);
    });

    it('should have default patterns', () => {
      const patterns = store.getAllPatterns();
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should include system safe patterns', () => {
      const patterns = store.getPatternsByDecision('allow');
      const npmPattern = patterns.find(p => p.pattern.includes('npm'));
      expect(npmPattern).toBeDefined();
    });

    it('should include system deny patterns', () => {
      const patterns = store.getPatternsByDecision('deny');
      expect(patterns.length).toBeGreaterThan(0);
    });
  });

  describe('pattern operations', () => {
    describe('addPattern', () => {
      it('should add a new pattern', () => {
        const pattern = store.addPattern('yarn *', 'glob', 'allow', {
          description: 'Allow yarn commands',
        });

        expect(pattern.id).toBeDefined();
        expect(pattern.pattern).toBe('yarn *');
        expect(pattern.decision).toBe('allow');
        expect(pattern.source).toBe('user');
      });

      it('should update existing pattern', () => {
        store.addPattern('custom-cmd', 'exact', 'allow');
        const updated = store.addPattern('custom-cmd', 'exact', 'deny');

        expect(updated.decision).toBe('deny');
        // Should not duplicate
        const all = store.getAllPatterns().filter(p => p.pattern === 'custom-cmd');
        expect(all.length).toBe(1);
      });

      it('should throw on invalid pattern', () => {
        expect(() => store.addPattern('', 'glob', 'allow')).toThrow();
      });
    });

    describe('removePattern', () => {
      it('should remove user patterns', () => {
        const pattern = store.addPattern('test-remove', 'exact', 'allow');
        const removed = store.removePattern(pattern.id);

        expect(removed).toBe(true);
        expect(store.getPattern(pattern.id)).toBeUndefined();
      });

      it('should disable system patterns instead of removing', () => {
        const systemPattern = store.getAllPatterns().find(p => p.source === 'system');
        if (systemPattern) {
          const removed = store.removePattern(systemPattern.id);
          expect(removed).toBe(true);
          expect(store.getPattern(systemPattern.id)?.enabled).toBe(false);
        }
      });

      it('should return false for non-existent patterns', () => {
        expect(store.removePattern('non-existent')).toBe(false);
      });
    });

    describe('updatePattern', () => {
      it('should update pattern properties', () => {
        const pattern = store.addPattern('update-test', 'exact', 'allow');
        const updated = store.updatePattern(pattern.id, {
          description: 'Updated description',
          enabled: false,
        });

        expect(updated?.description).toBe('Updated description');
        expect(updated?.enabled).toBe(false);
      });
    });
  });

  describe('checkCommand', () => {
    it('should match allow patterns', () => {
      store.addPattern('check-allow', 'exact', 'allow');
      const result = store.checkCommand('check-allow');

      expect(result.matched).toBe(true);
      expect(result.decision).toBe('allow');
    });

    it('should match deny patterns', () => {
      store.addPattern('check-deny', 'exact', 'deny');
      const result = store.checkCommand('check-deny');

      expect(result.matched).toBe(true);
      expect(result.decision).toBe('deny');
    });

    it('should return prompt for unmatched commands', () => {
      const result = store.checkCommand('unmatched-command-xyz');

      expect(result.matched).toBe(false);
      expect(result.decision).toBe('prompt');
    });

    it('should increment use count on match', () => {
      const pattern = store.addPattern('use-count-test', 'exact', 'allow');
      expect(pattern.useCount).toBe(0);

      store.checkCommand('use-count-test');
      const updated = store.getPattern(pattern.id);
      expect(updated?.useCount).toBe(1);
    });

    it('should update lastUsedAt on match', () => {
      const pattern = store.addPattern('last-used-test', 'exact', 'allow');
      expect(pattern.lastUsedAt).toBeUndefined();

      store.checkCommand('last-used-test');
      const updated = store.getPattern(pattern.id);
      expect(updated?.lastUsedAt).toBeDefined();
    });
  });

  describe('statistics', () => {
    it('should track total checks', () => {
      const initialStats = store.getStats();
      store.checkCommand('stat-test-1');
      store.checkCommand('stat-test-2');

      const stats = store.getStats();
      expect(stats.totalChecks).toBe(initialStats.totalChecks + 2);
    });

    it('should track allowed commands', () => {
      store.addPattern('stat-allow', 'exact', 'allow');
      const initial = store.getStats().allowed;

      store.checkCommand('stat-allow');

      expect(store.getStats().allowed).toBe(initial + 1);
    });

    it('should track denied commands', () => {
      store.addPattern('stat-deny', 'exact', 'deny');
      const initial = store.getStats().denied;

      store.checkCommand('stat-deny');

      expect(store.getStats().denied).toBe(initial + 1);
    });

    it('should reset statistics', () => {
      store.checkCommand('any-command');
      store.resetStats();

      const stats = store.getStats();
      expect(stats.totalChecks).toBe(0);
    });
  });

  describe('persistence', () => {
    it('should persist patterns to file', () => {
      store.addPattern('persist-test', 'exact', 'allow');

      const configPath = path.join(tempDir, 'exec-approvals.json');
      expect(fs.existsSync(configPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const found = content.patterns.find((p: { pattern: string }) => p.pattern === 'persist-test');
      expect(found).toBeDefined();
    });

    it('should load patterns from file on reinitialize', async () => {
      store.addPattern('reload-test', 'exact', 'allow');

      // Create new store instance
      const newStore = new AllowlistStore(tempDir);
      await newStore.initialize();

      const pattern = newStore.getAllPatterns().find(p => p.pattern === 'reload-test');
      expect(pattern).toBeDefined();
    });
  });

  describe('import/export', () => {
    it('should export patterns to JSON', () => {
      store.addPattern('export-test', 'exact', 'allow', { tags: ['test'] });

      const exported = store.exportPatterns({ tagsFilter: ['test'] });
      const data = JSON.parse(exported);

      expect(data.patterns.length).toBeGreaterThan(0);
      expect(data.patterns[0].pattern).toBe('export-test');
    });

    it('should import patterns from JSON', () => {
      const json = JSON.stringify({
        version: 1,
        patterns: [{
          pattern: 'import-test',
          type: 'exact',
          decision: 'allow',
          description: 'Imported pattern',
        }],
      });

      const result = store.importPatterns(json);
      expect(result.imported).toBe(1);

      const pattern = store.getAllPatterns().find(p => p.pattern === 'import-test');
      expect(pattern).toBeDefined();
      expect(pattern?.source).toBe('import');
    });
  });

  describe('clearUserPatterns', () => {
    it('should remove user patterns but keep system patterns', () => {
      store.addPattern('user-pattern', 'exact', 'allow');

      const systemCount = store.getAllPatterns().filter(p => p.source === 'system').length;
      store.clearUserPatterns();

      const remaining = store.getAllPatterns();
      expect(remaining.every(p => p.source === 'system')).toBe(true);
      expect(remaining.length).toBe(systemCount);
    });
  });
});
