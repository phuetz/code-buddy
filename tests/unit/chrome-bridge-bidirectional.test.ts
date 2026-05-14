/**
 * Chrome Bridge Bidirectional Tests
 * Tests the new sendAction / navigate / click / type methods
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  BrowserAction,
  BrowserActionResult,
  ChromeBridge,
} from '../../src/integrations/chrome-bridge.js';

async function sendAndReceive(
  bridge: ChromeBridge,
  send: () => Promise<BrowserActionResult>,
  expectedAction: Partial<BrowserAction>,
  result: Omit<BrowserActionResult, 'timestamp'>,
): Promise<BrowserActionResult> {
  const pendingResult = send();
  const [queuedAction] = bridge.drainActionQueue();

  expect(queuedAction).toBeDefined();
  expect(queuedAction.action).toMatchObject(expectedAction);

  bridge.receiveActionResponse(queuedAction.id, {
    ...result,
    timestamp: Date.now(),
  });

  return pendingResult;
}

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
      const result = await sendAndReceive(
        bridge,
        () => bridge.navigate('https://example.com'),
        { type: 'navigate', url: 'https://example.com' },
        { success: true, data: { url: 'https://example.com' } },
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ url: 'https://example.com' });
    });

    it('clicks an element', async () => {
      await bridge.connect();
      const result = await sendAndReceive(
        bridge,
        () => bridge.click('#submit-btn'),
        { type: 'click', selector: '#submit-btn' },
        { success: true, data: { selector: '#submit-btn', clicked: true } },
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ selector: '#submit-btn', clicked: true });
    });

    it('types text', async () => {
      await bridge.connect();
      const result = await sendAndReceive(
        bridge,
        () => bridge.type('Hello World', '#input-field'),
        { type: 'type', text: 'Hello World', selector: '#input-field' },
        { success: true, data: { text: 'Hello World', typed: true } },
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ text: 'Hello World', typed: true });
    });

    it('evaluates JavaScript', async () => {
      await bridge.connect();
      bridge.setPageInfo('https://test.com', 'Test Page');
      const result = await sendAndReceive(
        bridge,
        () => bridge.evaluate('document.title'),
        { type: 'evaluate', expression: 'document.title' },
        { success: true, data: 'Test Page' },
      );
      expect(result.success).toBe(true);
      expect(result.data).toBe('Test Page');
    });

    it('captures screenshot', async () => {
      await bridge.connect();
      const result = await sendAndReceive(
        bridge,
        () => bridge.captureScreenshot(),
        { type: 'screenshot' },
        { success: true, data: { image: 'base64-png' } },
      );
      expect(result.success).toBe(true);
    });

    it('handles wait action', async () => {
      await bridge.connect();
      const result = await sendAndReceive(
        bridge,
        () => bridge.sendAction({ type: 'wait', waitMs: 100 }),
        { type: 'wait', waitMs: 100 },
        { success: true },
      );
      expect(result.success).toBe(true);
    });

    it('fails when the extension does not answer before timeout', async () => {
      await bridge.connect();
      const result = await bridge.sendAction({ type: 'wait', waitMs: 100, timeout: 1 });

      expect(result).toMatchObject({
        success: false,
        error: 'Action timed out after 1ms',
      });
    });
  });

  describe('action queue', () => {
    it('queues actions for extension polling', async () => {
      await bridge.connect();
      const promise = bridge.sendAction({ type: 'navigate', url: 'https://test.com' });

      const [queuedAction] = bridge.drainActionQueue();
      expect(queuedAction.action).toEqual({ type: 'navigate', url: 'https://test.com' });

      bridge.receiveActionResponse(queuedAction.id, {
        success: true,
        data: { url: 'https://test.com' },
        timestamp: Date.now(),
      });

      await promise;
    });

    it('drainActionQueue returns and clears pending actions', async () => {
      await bridge.connect();
      const promise = bridge.sendAction({ type: 'navigate', url: 'https://test.com' });

      const actions = bridge.drainActionQueue();
      expect(actions).toHaveLength(1);
      expect(bridge.drainActionQueue()).toEqual([]);

      bridge.receiveActionResponse(actions[0].id, {
        success: true,
        timestamp: Date.now(),
      });

      await promise;
    });
  });

  describe('receiveActionResponse', () => {
    it('resolves pending action when response received', async () => {
      await bridge.connect();

      const promise = bridge.navigate('https://example.com');
      const [queuedAction] = bridge.drainActionQueue();

      bridge.receiveActionResponse(queuedAction.id, {
        success: true,
        data: { url: 'https://example.com' },
        timestamp: Date.now(),
      });

      const result = await promise;
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
    it('does not mutate captured URL until Chrome reports new state', async () => {
      await bridge.connect();
      bridge.setPageInfo('https://before.com', 'Before');

      const promise = bridge.navigate('https://updated.com');
      const [queuedAction] = bridge.drainActionQueue();

      bridge.receiveActionResponse(queuedAction.id, {
        success: true,
        data: { url: 'https://updated.com' },
        timestamp: Date.now(),
      });

      await promise;
      const scriptResult = await bridge.executeScript('window.location.href');
      expect(scriptResult).toBe('https://before.com');
    });

    it('works alongside recording', async () => {
      await bridge.connect();
      await bridge.startRecording();

      // Bidirectional actions don't auto-record (they go through extension)
      await sendAndReceive(
        bridge,
        () => bridge.navigate('https://test.com'),
        { type: 'navigate', url: 'https://test.com' },
        { success: true },
      );
      await sendAndReceive(
        bridge,
        () => bridge.click('#btn'),
        { type: 'click', selector: '#btn' },
        { success: true },
      );

      const recording = bridge.getRecording();
      // Recorded actions come from ingestMessage, not sendAction
      expect(Array.isArray(recording)).toBe(true);
    });
  });
});
