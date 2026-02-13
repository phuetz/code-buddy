/**
 * Tests for BrowserManager ref counter fix
 *
 * Verifies:
 * - getNextRef() returns incrementing values
 * - takeSnapshot() no longer resets ref counter
 */

import { BrowserManager } from '../../src/browser-automation/browser-manager.js';

// Mock playwright to avoid requiring actual browser
jest.mock('playwright', () => ({}), { virtual: true });
jest.mock('playwright-core', () => ({}), { virtual: true });

describe('BrowserManager ref counter', () => {
  describe('getNextRef', () => {
    it('should return incrementing ref numbers', () => {
      const manager = new BrowserManager();

      expect(manager.getNextRef()).toBe(1);
      expect(manager.getNextRef()).toBe(2);
      expect(manager.getNextRef()).toBe(3);
    });

    it('should continue incrementing without reset', () => {
      const manager = new BrowserManager();

      // Consume some refs
      for (let i = 0; i < 5; i++) {
        manager.getNextRef();
      }

      // Next should be 6, not 1
      expect(manager.getNextRef()).toBe(6);
    });
  });

  describe('takeSnapshot ref continuity', () => {
    it('should not contain this.nextRef = 1 in takeSnapshot', async () => {
      // Verify the code fix by reading the source
      const fs = await import('fs');
      const source = fs.readFileSync(
        require.resolve('../../src/browser-automation/browser-manager.ts'),
        'utf-8'
      );

      // Find the takeSnapshot method
      // eslint-disable-next-line no-regex-spaces
      const snapshotMatch = source.match(/async takeSnapshot[\s\S]*?{[\s\S]*?(?=\n  (?:async|private|public|\*))/);
      if (snapshotMatch) {
        // Verify it does NOT contain the ref reset
        expect(snapshotMatch[0]).not.toContain('this.nextRef = 1');
        // Verify it has the comment about not resetting
        expect(snapshotMatch[0]).toContain("Don't reset nextRef");
      }
    });
  });
});
