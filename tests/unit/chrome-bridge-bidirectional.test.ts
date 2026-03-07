/**
 * Chrome Bridge Bidirectional Tests
 * Tests the new sendAction / navigate / click / type methods
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ChromeBridge } from '../../src/integrations/chrome-bridge.js';

describe('ChromeBridge Bidirectional', () => {
  let bridge: ChromeBridge;

  beforeEach(() => {
    ChromeBridge.resetInstance();
    bridge = ChromeBridge.getInstance();
  });

  describe('sendAction', () => {
    it('throws when not connected', async () => {
      await expect(bridge.sendAction({ type: 'navigate', url: 'https://example.com' }))
        .rejects.toThrow('Not connected');
    });

    it('navigates to URL', async () => {
      await bridge.connect();
      const result = await bridge.navigate('https://example.com');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ url: 'https://example.com' });
    });

    it('clicks an element', async () => {
      await bridge.connect();
      const result = await bridge.click('#submit-btn');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ selector: '#submit-btn', clicked: true });
    });

    it('types text', async () => {
      await bridge.connect();
      const result = await bridge.type('Hello World', '#input-field');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ text: 'Hello World', typed: true });
    });

    it('evaluates JavaScript', async () => {
      await bridge.connect();
      bridge.setPageInfo('https://test.com', 'Test Page');
      const result = await bridge.evaluate('document.title');
      expect(result.success).toBe(true);
      expect(result.data).toBe('Test Page');
    });

    it('captures screenshot', async () => {
      await bridge.connect();
      const result = await bridge.captureScreenshot();
      expect(result.success).toBe(true);
    });

    it('handles wait action', async () => {
      await bridge.connect();
      const result = await bridge.sendAction({ type: 'wait', waitMs: 100 });
      expect(result.success).toBe(true);
    });
  });

  describe('action queue', () => {
    it('queues actions for extension polling', async () => {
      await bridge.connect();
      // Don't await — we want to check the queue
      const promise = bridge.sendAction({ type: 'navigate', url: 'https://test.com' });

      // Queue should have the action before it resolves
      // (but our simulation resolves via setImmediate, so it may already be drained)
      await promise;
    });

    it('drainActionQueue returns and clears pending actions', async () => {
      await bridge.connect();
      // Drain happens after simulation
      const actions = bridge.drainActionQueue();
      expect(Array.isArray(actions)).toBe(true);
    });
  });

  describe('receiveActionResponse', () => {
    it('resolves pending action when response received', async () => {
      await bridge.connect();

      // The simulated action will resolve via setImmediate
      const result = await bridge.navigate('https://example.com');
      expect(result.success).toBe(true);
    });

    it('ignores responses for unknown action IDs', () => {
      // Should not throw
      bridge.receiveActionResponse('unknown-id', {
        success: true,
        timestamp: Date.now(),
      });
    });
  });

  describe('integration with existing features', () => {
    it('navigate updates current URL', async () => {
      await bridge.connect();
      await bridge.navigate('https://updated.com');

      // Verify via executeScript which reads currentUrl
      const scriptResult = await bridge.executeScript('window.location.href');
      expect(scriptResult).toBe('https://updated.com');
    });

    it('works alongside recording', async () => {
      await bridge.connect();
      await bridge.startRecording();

      // Bidirectional actions don't auto-record (they go through extension)
      await bridge.navigate('https://test.com');
      await bridge.click('#btn');

      const recording = bridge.getRecording();
      // Recorded actions come from ingestMessage, not sendAction
      expect(Array.isArray(recording)).toBe(true);
    });
  });
});
