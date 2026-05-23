/**
 * Phase (d).5 V0.4.1 — /fleet slash handler tests.
 *
 * Validates argument parsing, listener lifecycle (start/stop/status),
 * and error paths. The FleetListener class is mocked so tests don't
 * need a live WS server.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fleetListenerMock = vi.hoisted(() => {
  const connectMock = vi.fn(async () => undefined);
  const disconnectMock = vi.fn(async () => undefined);
  const onMock = vi.fn();
  const constructorCalls: Array<{ url: string; apiKey?: string; jwt?: string }> = [];
  // Phase (d).9 — presence telemetry. Default: never seen anything.
  // Tests that need a "seen" value override these via getLastSeenMock.mockReturnValueOnce(...).
  const getLastSeenMock = vi.fn(() => ({
    at: null as number | null,
    reason: null as string | null,
    ageMs: null as number | null,
  }));
  const isStaleMock = vi.fn(() => false);
  // Phase (d).10 — peer compaction telemetry. Default: never compacted.
  const getPeerCompactionStateMock = vi.fn(() => ({
    active: false as boolean,
    startedAt: null as number | null,
    ageMs: null as number | null,
    lastResult: null as null | {
      success?: boolean;
      originalTokens?: number;
      compactedTokens?: number;
      messagesRemoved?: number;
      strategy?: string;
      durationMs?: number;
      completedAt: number;
    },
  }));
  // Phase (d).11 — event history. Default: empty.
  const getEventHistoryMock = vi.fn<
    () => readonly { at: number; type: string; payload: Record<string, unknown>; hostname?: string; agentId?: string }[]
  >(() => []);
  // Phase (d).13 — peer RPC. Default: resolves to { ok: true } so /fleet send tests
  // that don't override see a working request.
  const requestMock = vi.fn<
    (method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<unknown>
  >(async () => ({ ok: true }));
  // Phase (d).23 / V1.3 — peer.tool.invoke wrappers. Default: resolves
  // to a deterministic payload so /fleet tool tests have a baseline.
  const invokeToolMock = vi.fn<
    (
      toolName: string,
      args?: Record<string, unknown>,
      options?: { timeoutMs?: number },
    ) => Promise<{ tool: string; output: string; durationMs: number; truncated?: boolean }>
  >(async (toolName) => ({ tool: toolName, output: 'mocked-output', durationMs: 5 }));
  const invokeToolStreamMock = vi.fn<
    (
      toolName: string,
      args: Record<string, unknown>,
      onChunk: (delta: string) => void,
      options?: { timeoutMs?: number },
    ) => Promise<{ tool: string; output: string; durationMs: number; truncated?: boolean }>
  >(async (toolName, _args, onChunk) => {
    onChunk('chunk-A');
    onChunk('chunk-B');
    return { tool: toolName, output: 'chunk-Achunk-B', durationMs: 8 };
  });

  class FleetListenerStub {
    constructor(opts: { url: string; apiKey?: string; jwt?: string }) {
      constructorCalls.push(opts);
    }
    connect = connectMock;
    disconnect = disconnectMock;
    on = onMock;
    isConnected = () => true;
    isAuthenticated = () => true;
    getReconnectAttempts = () => 0;
    isReconnecting = () => false;
    getLastSeen = getLastSeenMock;
    isStale = isStaleMock;
    getPeerCompactionState = getPeerCompactionStateMock;
    getEventHistory = getEventHistoryMock;
    request = requestMock;
    invokeTool = invokeToolMock;
    invokeToolStream = invokeToolStreamMock;
  }

  return {
    FleetListenerStub,
    connectMock,
    disconnectMock,
    onMock,
    constructorCalls,
    getLastSeenMock,
    isStaleMock,
    getPeerCompactionStateMock,
    getEventHistoryMock,
    requestMock,
    invokeToolMock,
    invokeToolStreamMock,
  };
});

vi.mock('../../src/fleet/fleet-listener.js', () => ({
  FleetListener: fleetListenerMock.FleetListenerStub,
}));

import {
  handleFleet,
  _resetFleetHandlerForTests,
} from '../../src/commands/handlers/fleet-handler.js';

describe('/fleet slash handler — Phase (d).5 V0.4.1', () => {
  beforeEach(() => {
    fleetListenerMock.constructorCalls.length = 0;
    fleetListenerMock.connectMock.mockReset().mockResolvedValue(undefined);
    fleetListenerMock.disconnectMock.mockReset().mockResolvedValue(undefined);
    fleetListenerMock.onMock.mockClear();
    fleetListenerMock.getLastSeenMock
      .mockReset()
      .mockReturnValue({ at: null, reason: null, ageMs: null });
    fleetListenerMock.isStaleMock.mockReset().mockReturnValue(false);
    fleetListenerMock.getPeerCompactionStateMock.mockReset().mockReturnValue({
      active: false,
      startedAt: null,
      ageMs: null,
      lastResult: null,
    });
    fleetListenerMock.getEventHistoryMock.mockReset().mockReturnValue([]);
    fleetListenerMock.requestMock.mockReset().mockResolvedValue({ ok: true });
    fleetListenerMock.invokeToolMock
      .mockReset()
      .mockImplementation(async (toolName) => ({
        tool: toolName,
        output: 'mocked-output',
        durationMs: 5,
      }));
    fleetListenerMock.invokeToolStreamMock
      .mockReset()
      .mockImplementation(async (toolName, _args, onChunk) => {
        onChunk('chunk-A');
        onChunk('chunk-B');
        return { tool: toolName, output: 'chunk-Achunk-B', durationMs: 8 };
      });
    _resetFleetHandlerForTests();
    delete process.env.CODEBUDDY_FLEET_API_KEY;
  });

  afterEach(() => {
    _resetFleetHandlerForTests();
    delete process.env.CODEBUDDY_FLEET_API_KEY;
  });

  describe('help / status / unknown', () => {
    it('returns help when no action given', async () => {
      const r = await handleFleet([]);
      expect(r.entry?.content).toContain('No fleet listeners active');
      expect(r.entry?.content).toContain('/fleet');
    });

    it('returns help when help action given', async () => {
      const r = await handleFleet(['help']);
      expect(r.entry?.content).toContain('Usage: /fleet');
    });

    it('reports no active listener via status when nothing running', async () => {
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('No fleet listeners active');
    });

    it('handles unknown actions gracefully', async () => {
      const r = await handleFleet(['fubar']);
      expect(r.entry?.content).toContain('Unknown fleet action');
    });
  });

  describe('listen action', () => {
    it('rejects without ws-url', async () => {
      const r = await handleFleet(['listen']);
      expect(r.entry?.content).toContain('Usage:');
    });

    it('rejects without apiKey when env not set', async () => {
      const r = await handleFleet(['listen', 'ws://peer:3000/ws']);
      expect(r.entry?.content).toContain('no apiKey provided');
    });

    it('accepts apiKey via --api-key flag', async () => {
      const r = await handleFleet([
        'listen',
        'ws://peer:3000/ws',
        '--api-key',
        'cb_sk_abc',
      ]);
      expect(r.entry?.content).toContain('connected to');
      expect(fleetListenerMock.constructorCalls).toHaveLength(1);
      expect(fleetListenerMock.constructorCalls[0].url).toBe('ws://peer:3000/ws');
      expect(fleetListenerMock.constructorCalls[0].apiKey).toBe('cb_sk_abc');
    });

    it('accepts apiKey via CODEBUDDY_FLEET_API_KEY env', async () => {
      process.env.CODEBUDDY_FLEET_API_KEY = 'cb_sk_envkey';
      const r = await handleFleet(['listen', 'ws://peer:3000/ws']);
      expect(r.entry?.content).toContain('connected to');
      expect(fleetListenerMock.constructorCalls[0].apiKey).toBe('cb_sk_envkey');
    });

    it('--api-key flag takes precedence over env', async () => {
      process.env.CODEBUDDY_FLEET_API_KEY = 'cb_sk_env';
      const r = await handleFleet([
        'listen',
        'ws://peer:3000/ws',
        '--api-key',
        'cb_sk_cli',
      ]);
      expect(r.entry?.content).toContain('connected to');
      expect(fleetListenerMock.constructorCalls[0].apiKey).toBe('cb_sk_cli');
    });

    it('rejects when SAME peer name (or default-derived id) is already active', async () => {
      // Same URL → same default peer id → second listen rejects
      const r1 = await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k1']);
      expect(r1.entry?.content).toContain('connected');
      const r2 = await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k2']);
      expect(r2.entry?.content).toContain('is already active');
    });

    it('Phase (d).12 — accepts a SECOND listener to a different peer (different default id)', async () => {
      const r1 = await handleFleet(['listen', 'ws://peerA:3000/ws', '--api-key', 'k1']);
      expect(r1.entry?.content).toContain('connected');
      // Different host → different default id → accepted
      const r2 = await handleFleet(['listen', 'ws://peerB:3000/ws', '--api-key', 'k2']);
      expect(r2.entry?.content).toContain('connected');
      expect(fleetListenerMock.constructorCalls).toHaveLength(2);
    });

    it('Phase (d).12 — accepts two listeners to the SAME url with explicit --name overrides', async () => {
      const r1 = await handleFleet([
        'listen', 'ws://peer:3000/ws', '--api-key', 'k1', '--name', 'session-a',
      ]);
      expect(r1.entry?.content).toContain('"session-a"');
      const r2 = await handleFleet([
        'listen', 'ws://peer:3000/ws', '--api-key', 'k2', '--name', 'session-b',
      ]);
      expect(r2.entry?.content).toContain('"session-b"');
    });

    it('reports connect error', async () => {
      fleetListenerMock.connectMock.mockRejectedValueOnce(new Error('auth failed'));
      const r = await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'bad']);
      expect(r.entry?.content).toContain('connect failed');
      expect(r.entry?.content).toContain('auth failed');
    });

    it('subscribes to fleet:event + disconnected events', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const events = fleetListenerMock.onMock.mock.calls.map((c) => c[0]);
      expect(events).toContain('fleet:event');
      expect(events).toContain('disconnected');
      expect(events).toContain('error');
    });
  });

  describe('status after listen', () => {
    it('reports active listener with URL + uptime', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('1 active');
      expect(r.entry?.content).toContain('ws://peer:3000/ws');
      expect(r.entry?.content).toContain('Uptime');
    });

    it('Phase (d).12 — multi-peer status shows all active peers stacked', async () => {
      await handleFleet(['listen', 'ws://peerA:3000/ws', '--api-key', 'k1', '--name', 'a']);
      await handleFleet(['listen', 'ws://peerB:3000/ws', '--api-key', 'k2', '--name', 'b']);
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('2 active');
      expect(r.entry?.content).toContain('Peer "a"');
      expect(r.entry?.content).toContain('Peer "b"');
      expect(r.entry?.content).toContain('ws://peerA:3000/ws');
      expect(r.entry?.content).toContain('ws://peerB:3000/ws');
    });

    // Phase (d).9 — presence display in /fleet status.
    it('shows "Last seen: never" when no fleet event has been received yet', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('Last seen: never');
    });

    it('shows last-seen age + reason when the listener has received an event', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.getLastSeenMock.mockReturnValueOnce({
        at: Date.now() - 5_000,
        reason: 'fleet:agent:tool_started',
        ageMs: 5_000,
      });
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('Last seen: 5s ago');
      expect(r.entry?.content).toContain('fleet:agent:tool_started');
      expect(r.entry?.content).not.toContain('⚠ stale');
    });

    it('prefixes the stale warning when isStale() returns true', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.getLastSeenMock.mockReturnValueOnce({
        at: Date.now() - 120_000,
        reason: 'heartbeat',
        ageMs: 120_000,
      });
      fleetListenerMock.isStaleMock.mockReturnValueOnce(true);
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('⚠ stale');
      expect(r.entry?.content).toContain('Last seen: 120s ago');
      expect(r.entry?.content).toContain('heartbeat');
    });

    // Phase (d).10 — peer compaction lines.
    it('shows "⏸ Peer compacting" when peer compaction is active', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.getPeerCompactionStateMock.mockReturnValueOnce({
        active: true,
        startedAt: Date.now() - 8_000,
        ageMs: 8_000,
        lastResult: null,
      });
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('⏸ Peer compacting');
      expect(r.entry?.content).toContain('started 8s ago');
    });

    it('shows "Last compaction" line with strategy + savings when not active', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.getPeerCompactionStateMock.mockReturnValueOnce({
        active: false,
        startedAt: null,
        ageMs: null,
        lastResult: {
          success: true,
          originalTokens: 20_000,
          compactedTokens: 8_000,
          messagesRemoved: 18,
          strategy: 'hybrid',
          durationMs: 1234,
          completedAt: Date.now(),
        },
      });
      const r = await handleFleet(['status']);
      expect(r.entry?.content).toContain('Last compaction: hybrid in 1234ms');
      expect(r.entry?.content).toContain('saved 12000 tokens');
      expect(r.entry?.content).not.toContain('⏸ Peer compacting');
    });

    it('omits the compaction line entirely when no compaction has happened', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      // default mock: active=false, lastResult=null → no line
      const r = await handleFleet(['status']);
      expect(r.entry?.content).not.toContain('Peer compacting');
      expect(r.entry?.content).not.toContain('Last compaction');
    });

    it('prints peer chat-session policy metadata when --with-sessions is enabled', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k', '--name', 'reviewer']);
      fleetListenerMock.requestMock.mockResolvedValueOnce({
        sessions: [
          {
            sessionId: 'sess_review_123456',
            turnCount: 2,
            model: 'gpt-5.1-codex',
            dispatchProfile: 'review',
            toolPolicy: {
              profile: 'review',
              policyProfile: 'minimal',
              defaultAction: 'confirm',
              allowGroups: ['group:fs:read'],
              confirmGroups: ['group:web:fetch'],
              denyGroups: ['group:fs:write', 'group:runtime'],
              summary: 'Review posture.',
            },
            toolset: {
              profile: 'review',
              toolsetId: 'fleet.hermes.review',
              label: 'Hermes-style Fleet review toolset',
              intent: 'Read-first code review.',
              policyProfile: 'minimal',
              defaultAction: 'confirm',
              allowGroups: ['group:fs:read'],
              confirmGroups: ['group:web:fetch'],
              denyGroups: ['group:fs:write', 'group:runtime'],
              allowedTools: ['view_file'],
              confirmTools: ['web_fetch'],
              deniedTools: ['create_file', 'bash'],
              decisions: [],
              summary: 'Review posture.',
              systemPrompt: 'Prioritize defects.',
            },
            toolDecisions: [
              { tool: 'view_file', action: 'allow', groups: ['group:fs:read'], source: 'global', reason: 'read' },
              { tool: 'create_file', action: 'deny', groups: ['group:fs:write'], source: 'global', reason: 'write' },
              { tool: 'bash', action: 'deny', groups: ['group:runtime'], source: 'global', reason: 'runtime' },
            ],
            ageMs: 4_000,
            idleMs: 1_200,
            expiresInMs: 60_000,
          },
        ],
      });

      const r = await handleFleet(['status', '--with-sessions']);
      const out = r.entry?.content ?? '';
      expect(out).toContain('Chat sessions (1):');
      expect(out).toContain('profile review');
      expect(out).toContain('policy minimal / confirm');
      expect(out).toContain('toolset fleet.hermes.review');
      expect(out).toContain('view_file=allow');
      expect(out).toContain('create_file=deny');
      expect(out).toContain('bash=deny');
      expect(fleetListenerMock.requestMock).toHaveBeenCalledWith(
        'peer.chat-session.list',
        {},
        { timeoutMs: 5_000 },
      );
    });
  });

  // ==========================================================================
  // Phase (d).11 — /fleet history slash action
  // ==========================================================================
  describe('history action (Phase (d).11)', () => {
    it('reports no listener when none active', async () => {
      const r = await handleFleet(['history']);
      expect(r.entry?.content).toContain('No fleet listeners active');
    });

    it('reports empty buffer when no events recorded', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['history']);
      expect(r.entry?.content).toContain('No fleet events recorded yet');
    });

    it('renders all events with HH:mm:ss + type when buffer has 3 entries', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      // Use a fixed reference epoch so the HH:mm:ss assertion is stable.
      const t0 = new Date('2026-05-03T10:15:30').getTime();
      fleetListenerMock.getEventHistoryMock.mockReturnValueOnce([
        {
          at: t0,
          type: 'fleet:agent:tool_started',
          payload: { tool: 'view_file', source: { hostname: 'darkstar', agentId: 'abcdef0123' } },
          hostname: 'darkstar',
          agentId: 'abcdef0123',
        },
        {
          at: t0 + 2000,
          type: 'fleet:peer:heartbeat',
          payload: { source: { hostname: 'darkstar' } },
          hostname: 'darkstar',
        },
        {
          at: t0 + 4000,
          type: 'fleet:workflow:start',
          payload: { workflowId: 'wf-x', source: { hostname: 'ministar' } },
          hostname: 'ministar',
        },
      ]);
      const r = await handleFleet(['history']);
      const out = r.entry?.content ?? '';
      expect(out).toContain('Fleet event history for "peer:3000" — last 3 of 3');
      expect(out).toContain('fleet:agent:tool_started');
      expect(out).toContain('tool=view_file');
      expect(out).toContain('[darkstar:abcdef01]');
      expect(out).toContain('fleet:peer:heartbeat');
      expect(out).toContain('(heartbeat)');
      expect(out).toContain('fleet:workflow:start');
      expect(out).toContain('workflowId=wf-x');
      expect(out).toContain('[ministar]');
      // Timestamps formatted HH:mm:ss
      expect(out).toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
    });

    it('respects /fleet history N to limit the rendered count', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const t0 = Date.now();
      fleetListenerMock.getEventHistoryMock.mockReturnValueOnce([
        { at: t0, type: 'fleet:agent:tool_started', payload: { tool: 'a' } },
        { at: t0 + 1, type: 'fleet:agent:tool_started', payload: { tool: 'b' } },
        { at: t0 + 2, type: 'fleet:agent:tool_started', payload: { tool: 'c' } },
        { at: t0 + 3, type: 'fleet:agent:tool_started', payload: { tool: 'd' } },
      ]);
      const r = await handleFleet(['history', '2']);
      const out = r.entry?.content ?? '';
      expect(out).toContain('last 2 of 4');
      expect(out).toContain('tool=c');
      expect(out).toContain('tool=d');
      expect(out).not.toContain('tool=a');
      expect(out).not.toContain('tool=b');
    });

    it('summarizes compacting:complete with strategy + duration', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.getEventHistoryMock.mockReturnValueOnce([
        {
          at: Date.now(),
          type: 'fleet:peer:compacting:complete',
          payload: { strategy: 'hybrid', durationMs: 1234, success: true },
        },
      ]);
      const r = await handleFleet(['history']);
      expect(r.entry?.content).toContain('(compacted: hybrid 1234ms)');
    });

    // V1.2.x — /fleet history --type <glob> + --json

    it('filters history with --type glob (only tool_* events kept)', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const t0 = Date.now();
      fleetListenerMock.getEventHistoryMock.mockReturnValueOnce([
        { at: t0, type: 'fleet:agent:tool_started', payload: { tool: 'view_file' } },
        { at: t0 + 1, type: 'fleet:peer:heartbeat', payload: {} },
        { at: t0 + 2, type: 'fleet:agent:tool_completed', payload: { tool: 'view_file' } },
        { at: t0 + 3, type: 'fleet:workflow:start', payload: { workflowId: 'w1' } },
      ]);
      const r = await handleFleet(['history', '--type', 'fleet:agent:tool*']);
      const out = r.entry?.content ?? '';
      expect(out).toContain('last 2 of 2');
      expect(out).toContain('(filter: "fleet:agent:tool*")');
      expect(out).toContain('fleet:agent:tool_started');
      expect(out).toContain('fleet:agent:tool_completed');
      expect(out).not.toContain('heartbeat');
      expect(out).not.toContain('workflow:start');
    });

    it('says "matching ..." when --type yields zero results', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.getEventHistoryMock.mockReturnValueOnce([
        { at: Date.now(), type: 'fleet:peer:heartbeat', payload: {} },
      ]);
      const r = await handleFleet(['history', '--type', 'fleet:agent:*']);
      expect(r.entry?.content).toContain('matching "fleet:agent:*"');
    });

    it('--json emits a JSON array of event records with peer id annotation', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const t0 = 1_700_000_000_000;
      fleetListenerMock.getEventHistoryMock.mockReturnValueOnce([
        {
          at: t0,
          type: 'fleet:agent:tool_started',
          payload: { tool: 'view_file' },
          hostname: 'darkstar',
          agentId: 'abc',
        },
      ]);
      const r = await handleFleet(['history', '--json']);
      const parsed = JSON.parse(r.entry?.content ?? '[]');
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({
        peer: 'peer:3000',
        at: t0,
        type: 'fleet:agent:tool_started',
        hostname: 'darkstar',
        agentId: 'abc',
      });
      expect(parsed[0].payload.tool).toBe('view_file');
    });

    it('--json with no events returns the empty array', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.getEventHistoryMock.mockReturnValueOnce([]);
      const r = await handleFleet(['history', '--json']);
      expect(r.entry?.content).toBe('[]');
    });

    it('combines --type and --json', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const t0 = Date.now();
      fleetListenerMock.getEventHistoryMock.mockReturnValueOnce([
        { at: t0, type: 'fleet:agent:tool_started', payload: { tool: 'a' } },
        { at: t0 + 1, type: 'fleet:peer:heartbeat', payload: {} },
      ]);
      const r = await handleFleet(['history', '--type', 'fleet:agent:*', '--json']);
      const parsed = JSON.parse(r.entry?.content ?? '[]');
      expect(parsed).toHaveLength(1);
      expect(parsed[0].type).toBe('fleet:agent:tool_started');
    });
  });

  describe('describe action', () => {
    it('reports no listeners when none active', async () => {
      const r = await handleFleet(['describe']);
      expect(r.entry?.content).toContain('No fleet listeners active');
    });

    it('defaults to the only active peer and renders a capability summary', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k', '--name', 'ministar']);
      fleetListenerMock.requestMock.mockResolvedValueOnce({
        hostname: 'ministar-linux',
        pid: 42,
        methods: ['peer.describe', 'peer.chat', 'peer.tool.invoke'],
        apiVersion: 'd.21',
        role: 'hub',
        maxDepth: 3,
        peerChatProvider: {
          provider: 'chatgpt-oauth',
          model: 'gpt-5.1-codex',
          isLocal: false,
        },
        capabilities: {
          egress: 'cloud',
          machineLabel: 'ministar',
          models: [
            {
              id: 'gpt-5.1-codex',
              provider: 'chatgpt-oauth',
              contextWindow: 200_000,
              strengths: ['reasoning'],
            },
          ],
        },
      });

      const r = await handleFleet(['describe']);
      const out = r.entry?.content ?? '';
      expect(out).toContain('Fleet peer "ministar"');
      expect(out).toContain('Hostname:      ministar-linux');
      expect(out).toContain('Peer chat:     chatgpt-oauth / gpt-5.1-codex');
      expect(out).toContain('Capabilities: 1 model(s), egress=cloud');
      expect(out).toContain('Top models:   gpt-5.1-codex');
      expect(fleetListenerMock.requestMock).toHaveBeenCalledWith(
        'peer.describe',
        {},
        { timeoutMs: 5_000 },
      );
    });

    it('--json returns the raw peer.describe payload', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k', '--name', 'ministar']);
      fleetListenerMock.requestMock.mockResolvedValueOnce({
        hostname: 'ministar-linux',
        methods: ['peer.describe'],
      });

      const r = await handleFleet(['describe', 'ministar', '--json']);
      const parsed = JSON.parse(r.entry?.content ?? '{}');
      expect(parsed).toMatchObject({
        hostname: 'ministar-linux',
        methods: ['peer.describe'],
      });
    });

    it('requires a peer name when several listeners are active', async () => {
      await handleFleet(['listen', 'ws://peerA:3000/ws', '--api-key', 'k1', '--name', 'a']);
      await handleFleet(['listen', 'ws://peerB:3000/ws', '--api-key', 'k2', '--name', 'b']);
      const r = await handleFleet(['describe']);
      expect(r.entry?.content).toContain('Multiple fleet listeners active');
      expect(r.entry?.content).toContain('Specify a peer name');
    });

    it('honors --timeout override', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      await handleFleet(['describe', '--timeout', '750']);
      expect(fleetListenerMock.requestMock).toHaveBeenCalledWith(
        'peer.describe',
        {},
        { timeoutMs: 750 },
      );
    });
  });

  describe('stop action', () => {
    it('reports nothing to stop when idle', async () => {
      const r = await handleFleet(['stop']);
      expect(r.entry?.content).toContain('No fleet listeners active to stop.');
    });

    it('disconnects active listener (single peer → no name needed)', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['stop']);
      expect(r.entry?.content).toContain('stopped');
      expect(fleetListenerMock.disconnectMock).toHaveBeenCalled();
    });

    it('clears active state so subsequent listen can re-connect', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k1']);
      await handleFleet(['stop']);
      const r2 = await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k2']);
      expect(r2.entry?.content).toContain('connected');
    });

    it('Phase (d).12 — multiple peers active + no name → demands a name', async () => {
      await handleFleet(['listen', 'ws://peerA:3000/ws', '--api-key', 'k1', '--name', 'a']);
      await handleFleet(['listen', 'ws://peerB:3000/ws', '--api-key', 'k2', '--name', 'b']);
      const r = await handleFleet(['stop']);
      expect(r.entry?.content).toContain('Multiple fleet listeners active');
      expect(fleetListenerMock.disconnectMock).not.toHaveBeenCalled();
    });

    it('Phase (d).12 — stop NAME stops the named peer only', async () => {
      await handleFleet(['listen', 'ws://peerA:3000/ws', '--api-key', 'k1', '--name', 'a']);
      await handleFleet(['listen', 'ws://peerB:3000/ws', '--api-key', 'k2', '--name', 'b']);
      const r = await handleFleet(['stop', 'a']);
      expect(r.entry?.content).toContain('"a" stopped');
      expect(fleetListenerMock.disconnectMock).toHaveBeenCalledTimes(1);
      const status = await handleFleet(['status']);
      expect(status.entry?.content).toContain('1 active');
      expect(status.entry?.content).toContain('Peer "b"');
    });

    it('Phase (d).12 — stop UNKNOWN_NAME reports error with active list', async () => {
      await handleFleet(['listen', 'ws://peerA:3000/ws', '--api-key', 'k1', '--name', 'a']);
      const r = await handleFleet(['stop', 'nonexistent']);
      expect(r.entry?.content).toContain('No fleet peer named "nonexistent"');
      expect(r.entry?.content).toContain('Active peers: a');
    });

    it('Phase (d).12 — stop --all disconnects every peer', async () => {
      await handleFleet(['listen', 'ws://peerA:3000/ws', '--api-key', 'k1', '--name', 'a']);
      await handleFleet(['listen', 'ws://peerB:3000/ws', '--api-key', 'k2', '--name', 'b']);
      const r = await handleFleet(['stop', '--all']);
      expect(r.entry?.content).toContain('stopped 2 listener(s)');
      expect(fleetListenerMock.disconnectMock).toHaveBeenCalledTimes(2);
      const status = await handleFleet(['status']);
      expect(status.entry?.content).toContain('No fleet listeners active');
    });
  });

  // ==========================================================================
  // Phase (d).13 — /fleet send peer.invoke routing
  // ==========================================================================
  describe('send action (Phase (d).13)', () => {
    it('reports no listeners when none active', async () => {
      const r = await handleFleet(['send', 'peer:3000', 'peer.ping']);
      expect(r.entry?.content).toContain('No fleet listeners active');
    });

    it('rejects when peer + method are missing', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['send']);
      expect(r.entry?.content).toContain('Usage:');
    });

    it('rejects when peer name is unknown', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k', '--name', 'a']);
      const r = await handleFleet(['send', 'nonexistent', 'peer.ping']);
      expect(r.entry?.content).toContain('No fleet peer named "nonexistent"');
      expect(r.entry?.content).toContain('Active peers: a');
    });

    it('successful invoke renders OK + duration + JSON payload', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.requestMock.mockResolvedValueOnce({
        pong: true,
        serverTime: 1234567890,
      });
      const r = await handleFleet(['send', 'peer:3000', 'peer.ping']);
      expect(r.entry?.content).toContain('Peer "peer:3000" → peer.ping OK');
      expect(r.entry?.content).toContain('"pong": true');
      expect(r.entry?.content).toContain('"serverTime": 1234567890');
    });

    it('passes the JSON params blob to listener.request', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      await handleFleet([
        'send',
        'peer:3000',
        'peer.echo',
        '{"hello":"world","n":42}',
      ]);
      expect(fleetListenerMock.requestMock).toHaveBeenCalledWith(
        'peer.echo',
        { hello: 'world', n: 42 },
        { timeoutMs: 30_000 },
      );
    });

    it('rejects malformed JSON params', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['send', 'peer:3000', 'peer.echo', '{bad json']);
      expect(r.entry?.content).toContain('invalid JSON params');
      expect(fleetListenerMock.requestMock).not.toHaveBeenCalled();
    });

    it('rejects JSON params that are not an object (array, string, number)', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['send', 'peer:3000', 'peer.echo', '[1,2,3]']);
      expect(r.entry?.content).toContain('params must be a JSON object');
    });

    it('honors --timeout override', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      await handleFleet([
        'send', 'peer:3000', 'peer.ping', '--timeout', '500',
      ]);
      expect(fleetListenerMock.requestMock).toHaveBeenCalledWith(
        'peer.ping',
        {},
        { timeoutMs: 500 },
      );
    });

    it('renders FAILED message on request rejection (preserves the code)', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const err = new Error('peer.invoke METHOD_ERROR: handler exploded');
      fleetListenerMock.requestMock.mockRejectedValueOnce(err);
      const r = await handleFleet(['send', 'peer:3000', 'peer.boom']);
      expect(r.entry?.content).toContain('Peer "peer:3000" → peer.boom FAILED');
      expect(r.entry?.content).toContain('METHOD_ERROR');
    });
  });

  describe('route action', () => {
    it('reports no peers when nothing is connected', async () => {
      const r = await handleFleet(['route', 'think', 'deeply']);
      expect(r.entry?.content).toContain('No fleet peers connected');
    });

    it('renders a human recommendation from peer.describe capabilities', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k', '--name', 'chatgpt']);
      fleetListenerMock.requestMock.mockImplementationOnce(async (method) => {
        expect(method).toBe('peer.describe');
        return {
          capabilities: {
            egress: 'cloud',
            machineLabel: 'ChatGPT Pro laptop',
            models: [
              {
                id: 'gpt-5.1-codex',
                contextWindow: 200_000,
                strengths: ['reasoning', 'thinking', 'code'],
                provider: 'chatgpt-oauth',
              },
            ],
          },
        };
      });

      const r = await handleFleet([
        'route',
        'think',
        'deeply',
        'about',
        'this',
        'architecture',
        '--privacy',
        'public',
      ]);

      const out = r.entry?.content ?? '';
      expect(out).toContain('Fleet route recommendation');
      expect(out).toContain('Primary: chatgpt / gpt-5.1-codex');
      expect(out).toContain('peer_delegate');
      expect(fleetListenerMock.requestMock).toHaveBeenCalledWith(
        'peer.describe',
        {},
        { timeoutMs: 5_000 },
      );
    });

    it('--council marks the route as a consensus council (planning-only)', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k', '--name', 'chatgpt']);
      fleetListenerMock.requestMock.mockImplementationOnce(async () => ({
        capabilities: {
          egress: 'cloud',
          machineLabel: 'ChatGPT Pro laptop',
          models: [
            {
              id: 'gpt-5.1-codex',
              contextWindow: 200_000,
              strengths: ['reasoning', 'thinking', 'code'],
              provider: 'chatgpt-oauth',
            },
          ],
        },
      }));

      const r = await handleFleet(['route', 'compare', 'X', 'vs', 'Y', '--council']);

      const out = r.entry?.content ?? '';
      expect(out).toContain('Fleet route recommendation');
      expect(out).toContain('Council: deterministic agreement score over');
    });

    it('--json emits the structured route payload', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k', '--name', 'local']);
      fleetListenerMock.requestMock.mockImplementationOnce(async () => ({
        capabilities: {
          egress: 'local',
          models: [
            {
              id: 'qwen3.6:35b',
              contextWindow: 32_000,
              strengths: ['reasoning', 'thinking'],
              provider: 'ollama',
            },
          ],
        },
      }));

      const r = await handleFleet(['route', 'private', 'analysis', '--json']);
      const parsed = JSON.parse(r.entry?.content ?? '{}');
      expect(parsed.recommendation).toMatchObject({
        peer: 'local',
        model: 'qwen3.6:35b',
      });
      expect(parsed.nextCall.tool).toBe('peer_delegate');
    });

    it('--delegate routes first, then sends peer.chat to the selected peer/model', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k', '--name', 'chatgpt']);
      fleetListenerMock.requestMock.mockImplementation(async (method, params) => {
        if (method === 'peer.describe') {
          return {
            capabilities: {
              egress: 'cloud',
              models: [
                {
                  id: 'gpt-5.1-codex',
                  contextWindow: 200_000,
                  strengths: ['reasoning', 'thinking'],
                  provider: 'chatgpt-oauth',
                },
              ],
            },
          };
        }
        if (method === 'peer.chat') {
          expect(params).toMatchObject({
            prompt: 'think deeply',
            model: 'gpt-5.1-codex',
          });
          return { text: 'delegated answer', modelRequested: 'gpt-5.1-codex' };
        }
        return { ok: true };
      });

      const r = await handleFleet(['route', 'think', 'deeply', '--delegate']);
      const out = r.entry?.content ?? '';
      expect(out).toContain('Delegated response');
      expect(out).toContain('delegated answer');
      expect(fleetListenerMock.requestMock).toHaveBeenCalledWith(
        'peer.chat',
        { prompt: 'think deeply', model: 'gpt-5.1-codex' },
        { timeoutMs: 60_000 },
      );
    });

    it('--profile review applies profile routing and delegated peer.chat guidance', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k', '--name', 'chatgpt']);
      fleetListenerMock.requestMock.mockImplementation(async (method, params) => {
        if (method === 'peer.describe') {
          return {
            capabilities: {
              egress: 'cloud',
              models: [
                {
                  id: 'fast-small',
                  contextWindow: 32_000,
                  strengths: ['cheap', 'fast'],
                  provider: 'chatgpt-oauth',
                },
                {
                  id: 'reviewer',
                  contextWindow: 200_000,
                  strengths: ['reasoning'],
                  provider: 'chatgpt-oauth',
                },
              ],
            },
          };
        }
        if (method === 'peer.chat') {
          expect(params).toMatchObject({
            prompt: 'review this patch',
            model: 'reviewer',
          });
          expect((params as { systemPrompt: string }).systemPrompt).toContain(
            'Prioritize defects',
          );
          return { text: 'reviewed', modelRequested: 'reviewer' };
        }
        return { ok: true };
      });

      const r = await handleFleet([
        'route',
        'review',
        'this',
        'patch',
        '--profile',
        'review',
        '--delegate',
      ]);
      const out = r.entry?.content ?? '';
      expect(out).toContain('Profile: review');
      expect(out).toContain('Tool policy: minimal / confirm');
      expect(out).toContain('Tool decisions:');
      expect(out).toContain('create_file=deny');
      expect(out).toContain('bash=deny');
      expect(out).toContain('reviewed');
    });

    it('rejects invalid privacy values before contacting peers', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['route', 'hello', '--privacy', 'secret']);
      expect(r.entry?.content).toContain('--privacy must be');
      expect(fleetListenerMock.requestMock).not.toHaveBeenCalled();
    });

    it('rejects invalid dispatch profiles before contacting peers', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['route', 'hello', '--profile', 'chaos']);
      expect(r.entry?.content).toContain('--profile must be one of');
      expect(fleetListenerMock.requestMock).not.toHaveBeenCalled();
    });
  });

  describe('tool action (Phase (d).23 / V1.3)', () => {
    it('reports no listeners when none active', async () => {
      const r = await handleFleet(['tool', 'peer:3000', 'view_file']);
      expect(r.entry?.content).toContain('No fleet listeners active');
    });

    it('rejects when peer + tool name are missing', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['tool']);
      expect(r.entry?.content).toContain('Usage:');
    });

    it('rejects when peer name is unknown', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k', '--name', 'a']);
      const r = await handleFleet(['tool', 'nonexistent', 'view_file']);
      expect(r.entry?.content).toContain('No fleet peer named "nonexistent"');
      expect(r.entry?.content).toContain('Active peers: a');
    });

    it('successful invoke renders OK + duration + output body (non-stream)', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.invokeToolMock.mockResolvedValueOnce({
        tool: 'view_file',
        output: '# README\nhello\n',
        durationMs: 12,
      });
      const r = await handleFleet([
        'tool', 'peer:3000', 'view_file', '{"file_path":"README.md"}',
      ]);
      expect(r.entry?.content).toContain('Peer "peer:3000" → view_file OK');
      expect(r.entry?.content).toContain('# README');
      expect(fleetListenerMock.invokeToolMock).toHaveBeenCalledWith(
        'view_file',
        { file_path: 'README.md' },
        { timeoutMs: 30_000 },
      );
    });

    it('handles tool invocation with no JSON args (defaults to {})', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      await handleFleet(['tool', 'peer:3000', 'list_directory']);
      expect(fleetListenerMock.invokeToolMock).toHaveBeenCalledWith(
        'list_directory',
        {},
        { timeoutMs: 30_000 },
      );
    });

    it('rejects malformed JSON args', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['tool', 'peer:3000', 'view_file', '{bad json']);
      expect(r.entry?.content).toContain('invalid JSON args');
      expect(fleetListenerMock.invokeToolMock).not.toHaveBeenCalled();
    });

    it('rejects JSON args that are not an object', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const r = await handleFleet(['tool', 'peer:3000', 'view_file', '[1,2,3]']);
      expect(r.entry?.content).toContain('args must be a JSON object');
    });

    it('honors --timeout override', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      await handleFleet(['tool', 'peer:3000', 'view_file', '--timeout', '500']);
      expect(fleetListenerMock.invokeToolMock).toHaveBeenCalledWith(
        'view_file',
        {},
        { timeoutMs: 500 },
      );
    });

    it('--stream uses invokeToolStream and renders summary line with byte count', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        const r = await handleFleet([
          'tool', 'peer:3000', 'view_file', '{"file_path":"big.txt"}', '--stream',
        ]);
        expect(fleetListenerMock.invokeToolStreamMock).toHaveBeenCalled();
        expect(writeSpy).toHaveBeenCalledWith('chunk-A');
        expect(writeSpy).toHaveBeenCalledWith('chunk-B');
        // Default mock streams 'chunk-A' + 'chunk-B' = 14 bytes total.
        expect(r.entry?.content).toContain('view_file (stream) OK');
        expect(r.entry?.content).toContain('14 bytes');
      } finally {
        writeSpy.mockRestore();
      }
    });

    it('--stream strips ANSI and unsafe control bytes before live stdout writes', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.invokeToolStreamMock.mockImplementationOnce(async (toolName, _args, onChunk) => {
        onChunk('\x1b[31mred\x1b[0m\x00\nok\t');
        return { tool: toolName, output: 'red\nok\t', durationMs: 8 };
      });
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        await handleFleet([
          'tool', 'peer:3000', 'view_file', '{"file_path":"colors.txt"}', '--stream',
        ]);
        const written = writeSpy.mock.calls.map((call) => String(call[0])).join('');
        expect(written).toContain('red\nok\t');
        expect(written).not.toContain('\x1b');
        expect(written).not.toContain('\x00');
        expect(written).not.toContain('[31m');
      } finally {
        writeSpy.mockRestore();
      }
    });

    it('renders [truncated] tag when payload signals truncation', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      fleetListenerMock.invokeToolMock.mockResolvedValueOnce({
        tool: 'view_file',
        output: 'partial content',
        durationMs: 9,
        truncated: true,
      });
      const r = await handleFleet(['tool', 'peer:3000', 'view_file']);
      expect(r.entry?.content).toContain('[truncated]');
    });

    it('renders FAILED message when invokeTool rejects (preserves the bridge code)', async () => {
      await handleFleet(['listen', 'ws://peer:3000/ws', '--api-key', 'k']);
      const err = new Error('peer.invoke METHOD_ERROR: PATH_OUTSIDE_PEER_WORKSPACE: ...');
      fleetListenerMock.invokeToolMock.mockRejectedValueOnce(err);
      const r = await handleFleet([
        'tool', 'peer:3000', 'view_file', '{"file_path":"/etc/hosts"}',
      ]);
      expect(r.entry?.content).toContain('Peer "peer:3000" → view_file FAILED');
      expect(r.entry?.content).toContain('PATH_OUTSIDE_PEER_WORKSPACE');
    });
  });
});
