/**
 * Phase (d).1 V0.4.1 — fleet-bridge.ts unit tests.
 *
 * Validates the broadcastFleetEvent helper, source identification, and
 * scope-filtered routing through `broadcast()`. The underlying broadcast
 * function is mocked so tests don't need a live WS server.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const broadcastMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/server/websocket/handler.js', () => ({
  broadcast: broadcastMock,
}));

import {
  broadcastFleetEvent,
  setFleetEventSource,
  _resetFleetEventSourceForTests,
  FLEET_EVENT_TYPES,
} from '../../src/server/websocket/fleet-bridge.js';

describe('fleet-bridge — Phase (d).1 V0.4.1', () => {
  beforeEach(() => {
    broadcastMock.mockReset();
    _resetFleetEventSourceForTests();
    delete process.env.CODEBUDDY_FLEET_HOSTNAME;
  });

  describe('broadcastFleetEvent', () => {
    it('routes to broadcast() with fleet:listen scope filter', () => {
      broadcastFleetEvent('fleet:agent:tool_started', { tool: 'view_file' });

      expect(broadcastMock).toHaveBeenCalledOnce();
      const [msg, scope] = broadcastMock.mock.calls[0];
      expect(scope).toBe('fleet:listen');
      expect((msg as { type: string }).type).toBe('fleet:agent:tool_started');
    });

    it('attaches source { hostname } from os.hostname() by default', () => {
      broadcastFleetEvent('fleet:agent:tool_completed', { tool: 'edit_file' });
      const msg = broadcastMock.mock.calls[0][0] as { payload: { source: { hostname: string } } };
      expect(msg.payload.source.hostname).toBeTruthy();
      expect(typeof msg.payload.source.hostname).toBe('string');
    });

    it('honors CODEBUDDY_FLEET_HOSTNAME env override', () => {
      process.env.CODEBUDDY_FLEET_HOSTNAME = 'gpuNode-test';
      broadcastFleetEvent('fleet:workflow:event', { kind: 'task_started' });
      const msg = broadcastMock.mock.calls[0][0] as { payload: { source: { hostname: string } } };
      expect(msg.payload.source.hostname).toBe('gpuNode-test');
    });

    it('attaches optional agentId when provided', () => {
      broadcastFleetEvent('fleet:workflow:event', { x: 1 }, 'wf-abc-123');
      const msg = broadcastMock.mock.calls[0][0] as { payload: { source: { agentId?: string } } };
      expect(msg.payload.source.agentId).toBe('wf-abc-123');
    });

    it('omits agentId from source when not provided', () => {
      broadcastFleetEvent('fleet:agent:tool_started', { tool: 'x' });
      const msg = broadcastMock.mock.calls[0][0] as { payload: { source: Record<string, unknown> } };
      expect(msg.payload.source.agentId).toBeUndefined();
    });

    it('preserves payload fields verbatim alongside source + timestamp', () => {
      broadcastFleetEvent('fleet:agent:reasoning', {
        chain: ['step1', 'step2'],
        confidence: 0.85,
      });
      const msg = broadcastMock.mock.calls[0][0] as {
        payload: { chain?: unknown; confidence?: number; source: unknown };
        timestamp: string;
      };
      expect(msg.payload.chain).toEqual(['step1', 'step2']);
      expect(msg.payload.confidence).toBe(0.85);
      expect(msg.payload.source).toBeDefined();
      expect(msg.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('swallows broadcast errors (best-effort, never throws)', () => {
      broadcastMock.mockImplementationOnce(() => {
        throw new Error('WS server not running');
      });
      expect(() => broadcastFleetEvent('fleet:agent:tool_error', { tool: 'x' })).not.toThrow();
    });

    it('caches source after first call (does not re-resolve hostname every emit)', () => {
      broadcastFleetEvent('fleet:agent:tool_started', { x: 1 });
      const msg1 = broadcastMock.mock.calls[0][0] as { payload: { source: { hostname: string } } };
      const cachedHost = msg1.payload.source.hostname;

      // Change env after first call — should NOT affect cached source
      process.env.CODEBUDDY_FLEET_HOSTNAME = 'changed-mid-flight';
      broadcastFleetEvent('fleet:agent:tool_completed', { x: 2 });
      const msg2 = broadcastMock.mock.calls[1][0] as { payload: { source: { hostname: string } } };
      expect(msg2.payload.source.hostname).toBe(cachedHost);
    });

    it('setFleetEventSource overrides the cached source', () => {
      setFleetEventSource({ hostname: 'manual-override', agentId: 'tag-1' });
      broadcastFleetEvent('fleet:session:spawn', { kind: 'sub-agent' });
      const msg = broadcastMock.mock.calls[0][0] as { payload: { source: { hostname: string; agentId?: string } } };
      expect(msg.payload.source.hostname).toBe('manual-override');
      // agentId on the cached source is preserved when no per-emit agentId is given
      expect(msg.payload.source.agentId).toBe('tag-1');
    });

    it('per-emit agentId overrides cached source.agentId', () => {
      setFleetEventSource({ hostname: 'host-a', agentId: 'cached-id' });
      broadcastFleetEvent('fleet:workflow:event', { x: 1 }, 'per-emit-id');
      const msg = broadcastMock.mock.calls[0][0] as { payload: { source: { agentId: string } } };
      expect(msg.payload.source.agentId).toBe('per-emit-id');
    });
  });

  describe('FLEET_EVENT_TYPES contract', () => {
    it('exports all expected event types', () => {
      expect(FLEET_EVENT_TYPES).toContain('fleet:agent:tool_started');
      expect(FLEET_EVENT_TYPES).toContain('fleet:agent:tool_completed');
      expect(FLEET_EVENT_TYPES).toContain('fleet:agent:tool_error');
      expect(FLEET_EVENT_TYPES).toContain('fleet:agent:reasoning');
      expect(FLEET_EVENT_TYPES).toContain('fleet:workflow:event');
      expect(FLEET_EVENT_TYPES).toContain('fleet:workflow:start');
      expect(FLEET_EVENT_TYPES).toContain('fleet:workflow:complete');
      expect(FLEET_EVENT_TYPES).toContain('fleet:session:spawn');
      expect(FLEET_EVENT_TYPES).toContain('fleet:session:message');
    });

    it('all event types are namespaced under fleet:', () => {
      for (const t of FLEET_EVENT_TYPES) {
        expect(t.startsWith('fleet:')).toBe(true);
      }
    });
  });

  describe('scope filter contract', () => {
    it('always filters via fleet:listen scope, never broader', () => {
      for (const eventType of FLEET_EVENT_TYPES) {
        broadcastMock.mockClear();
        broadcastFleetEvent(eventType, {});
        expect(broadcastMock).toHaveBeenCalledOnce();
        expect(broadcastMock.mock.calls[0][1]).toBe('fleet:listen');
      }
    });
  });
});
