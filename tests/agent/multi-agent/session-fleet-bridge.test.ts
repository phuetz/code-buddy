/**
 * Phase (d).4 V0.4.1 — session-fleet-bridge tests.
 *
 * Validates that the bridge subscribes to SessionRegistry events and
 * routes them through broadcastFleetEvent with proper payload shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

const broadcastFleetEventMock = vi.fn();

import {
  enableSessionFleetBridge,
  registerSessionFleetBroadcaster,
} from '../../../src/agent/multi-agent/session-fleet-bridge.js';
import type { SessionRegistry } from '../../../src/agent/multi-agent/session-registry.js';

registerSessionFleetBroadcaster(broadcastFleetEventMock);

/**
 * Lightweight stand-in for SessionRegistry — only needs the EventEmitter
 * surface (on/off) for the bridge to attach.
 */
function makeFakeRegistry(): SessionRegistry {
  return new EventEmitter() as unknown as SessionRegistry;
}

describe('session-fleet-bridge — Phase (d).4 V0.4.1', () => {
  beforeEach(() => {
    broadcastFleetEventMock.mockReset();
    delete process.env.CODEBUDDY_FLEET_STREAM;
  });

  afterEach(() => {
    delete process.env.CODEBUDDY_FLEET_STREAM;
  });

  describe('opt-in gating', () => {
    it('does NOT broadcast when CODEBUDDY_FLEET_STREAM is unset', () => {
      const reg = makeFakeRegistry();
      const handle = enableSessionFleetBridge(reg);

      reg.emit('session:spawn', { id: 'p1', kind: 'main', agentId: 'A' }, { id: 'c1', kind: 'spawn', agentId: 'B' });
      expect(broadcastFleetEventMock).not.toHaveBeenCalled();

      handle.disable();
    });

    it('broadcasts fleet:session:spawn when CODEBUDDY_FLEET_STREAM=1', () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      const reg = makeFakeRegistry();
      const handle = enableSessionFleetBridge(reg);

      reg.emit(
        'session:spawn',
        { id: 'p1', kind: 'main', agentId: 'parent-agent' },
        { id: 'c1', kind: 'spawn', agentId: 'child-agent' },
      );

      expect(broadcastFleetEventMock).toHaveBeenCalledOnce();
      const [type, payload, agentId] = broadcastFleetEventMock.mock.calls[0];
      expect(type).toBe('fleet:session:spawn');
      expect(payload).toMatchObject({
        parentSessionId: 'p1',
        childSessionId: 'c1',
        kind: 'spawn',
        agentId: 'child-agent',
        parentKind: 'main',
      });
      expect(agentId).toBe('c1');

      handle.disable();
    });

    it('broadcasts fleet:session:message with truncated content preview', () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      const reg = makeFakeRegistry();
      const handle = enableSessionFleetBridge(reg);

      const longContent = 'x'.repeat(500);
      reg.emit('session:message', 's1', {
        sessionId: 's1',
        role: 'user',
        content: longContent,
      });

      expect(broadcastFleetEventMock).toHaveBeenCalledOnce();
      const [type, payload] = broadcastFleetEventMock.mock.calls[0];
      expect(type).toBe('fleet:session:message');
      expect(payload).toMatchObject({
        sessionId: 's1',
        role: 'user',
        truncated: true,
      });
      const preview = (payload as { contentPreview: string }).contentPreview;
      expect(preview.length).toBe(200);
      expect(preview).toBe('x'.repeat(200));

      handle.disable();
    });

    it('marks short messages as not truncated', () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      const reg = makeFakeRegistry();
      const handle = enableSessionFleetBridge(reg);

      reg.emit('session:message', 's1', {
        sessionId: 's1',
        role: 'assistant',
        content: 'hello world',
      });

      const payload = broadcastFleetEventMock.mock.calls[0][1] as {
        contentPreview: string;
        truncated: boolean;
      };
      expect(payload.contentPreview).toBe('hello world');
      expect(payload.truncated).toBe(false);

      handle.disable();
    });

    it('redacts the full message before truncating its preview', () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      const reg = makeFakeRegistry();
      const handle = enableSessionFleetBridge(reg);
      const secret = `sk-ant-${'a'.repeat(32)}`;

      reg.emit('session:message', 's1', {
        sessionId: 's1',
        role: 'user',
        content: `${'x'.repeat(180)}${secret}`,
      });

      const payload = broadcastFleetEventMock.mock.calls[0][1] as {
        contentPreview: string;
        truncated: boolean;
      };
      expect(payload.contentPreview).toContain('[REDACTED:env-key]');
      expect(payload.contentPreview).not.toContain(secret.slice(0, 10));
      expect(payload.truncated).toBe(true);

      handle.disable();
    });

    it('handles non-string content gracefully', () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      const reg = makeFakeRegistry();
      const handle = enableSessionFleetBridge(reg);

      reg.emit('session:message', 's1', {
        sessionId: 's1',
        role: 'tool',
        content: { foo: 'bar' } as unknown as string,
      });

      const payload = broadcastFleetEventMock.mock.calls[0][1] as { contentPreview: string };
      expect(payload.contentPreview).toBe('<non-string content>');

      handle.disable();
    });
  });

  describe('lifecycle', () => {
    it('disable() stops broadcasts', () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      const reg = makeFakeRegistry();
      const handle = enableSessionFleetBridge(reg);

      reg.emit('session:spawn', { id: 'p', kind: 'main', agentId: 'a' }, { id: 'c', kind: 'spawn', agentId: 'b' });
      expect(broadcastFleetEventMock).toHaveBeenCalledOnce();

      handle.disable();
      reg.emit('session:spawn', { id: 'p2', kind: 'main', agentId: 'a' }, { id: 'c2', kind: 'spawn', agentId: 'b' });
      // Still 1 — disable removed the listener
      expect(broadcastFleetEventMock).toHaveBeenCalledOnce();
    });

    it('re-enabling on the same registry is idempotent (no double-broadcast)', () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      const reg = makeFakeRegistry();
      enableSessionFleetBridge(reg);
      enableSessionFleetBridge(reg); // second call should be a no-op

      reg.emit('session:spawn', { id: 'p', kind: 'main', agentId: 'a' }, { id: 'c', kind: 'spawn', agentId: 'b' });
      expect(broadcastFleetEventMock).toHaveBeenCalledOnce();
    });

    it('different registries get independent bridges', () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      const reg1 = makeFakeRegistry();
      const reg2 = makeFakeRegistry();
      enableSessionFleetBridge(reg1);
      enableSessionFleetBridge(reg2);

      reg1.emit('session:spawn', { id: 'p1', kind: 'main', agentId: 'a' }, { id: 'c1', kind: 'spawn', agentId: 'b' });
      reg2.emit('session:spawn', { id: 'p2', kind: 'main', agentId: 'a' }, { id: 'c2', kind: 'spawn', agentId: 'b' });

      expect(broadcastFleetEventMock).toHaveBeenCalledTimes(2);
    });

    it('broadcast errors are swallowed (best-effort)', () => {
      process.env.CODEBUDDY_FLEET_STREAM = '1';
      broadcastFleetEventMock.mockImplementationOnce(() => {
        throw new Error('WS server not running');
      });
      const reg = makeFakeRegistry();
      const handle = enableSessionFleetBridge(reg);

      expect(() =>
        reg.emit(
          'session:spawn',
          { id: 'p', kind: 'main', agentId: 'a' },
          { id: 'c', kind: 'spawn', agentId: 'b' },
        ),
      ).not.toThrow();

      handle.disable();
    });
  });
});
