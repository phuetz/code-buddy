/**
 * route_peer tool tests.
 *
 * Verifies the LLM-facing wrapper around Fleet TaskRouter without real
 * WebSocket traffic. The registry contains stub listeners whose
 * peer.describe responses advertise synthetic provider capabilities.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { executeRoutePeer } from '../../src/tools/route-peer-tool.js';
import {
  resetActiveCustomAgentRuntime,
  setActiveCustomAgentRuntime,
} from '../../src/agent/custom/custom-agent-runtime.js';
import {
  getFleetRegistry,
  _resetFleetRegistryForTests,
  type ActiveListenerEntry,
  type FleetListenerPublicAPI,
} from '../../src/fleet/fleet-registry.js';
import type { PeerCapability } from '../../src/fleet/types.js';

function makeStubListener(
  capability: PeerCapability | null,
  error?: Error,
): FleetListenerPublicAPI {
  return {
    disconnect: async () => undefined,
    getReconnectAttempts: () => 0,
    isReconnecting: () => false,
    request: async (method) => {
      expect(method).toBe('peer.describe');
      if (error) throw error;
      return { capabilities: capability };
    },
    getLastSeen: () => ({ at: Date.now(), reason: 'test', ageMs: 10 }),
    isStale: () => false,
    getPeerCompactionState: () => ({
      active: false,
      startedAt: null,
      ageMs: null,
      lastResult: null,
    }),
    getEventHistory: () => [],
  };
}

function registerPeer(id: string, capability: PeerCapability | null, error?: Error): void {
  const entry: ActiveListenerEntry = {
    id,
    url: `ws://example/${id}`,
    startedAt: new Date(),
    eventCount: 0,
    autoReconnect: false,
    maxAttempts: 5,
    listener: makeStubListener(capability, error),
  };
  getFleetRegistry().register(entry);
}

function capability(partial: Partial<PeerCapability>): PeerCapability {
  return {
    models: [],
    egress: 'local',
    machineLabel: 'test',
    ...partial,
  };
}

describe('route_peer tool', () => {
  beforeEach(() => {
    _resetFleetRegistryForTests();
    resetActiveCustomAgentRuntime();
  });

  it('errors when no peers are connected', async () => {
    const result = await executeRoutePeer({ prompt: 'analyze this architecture' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No fleet peers connected');
  });

  it('rejects unknown dispatchProfile values before peer discovery', async () => {
    registerPeer(
      'review-box',
      capability({
        models: [
          {
            id: 'reviewer',
            contextWindow: 32_000,
            strengths: ['reasoning'],
            provider: 'ollama',
          },
        ],
      }),
    );

    const result = await executeRoutePeer({
      prompt: 'quick patch review',
      dispatchProfile: 'chaos',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('dispatchProfile must be one of');
  });

  it('routes reasoning-heavy public tasks to the strongest ChatGPT OAuth peer', async () => {
    registerPeer(
      'chatgpt-pro',
      capability({
        egress: 'cloud',
        models: [
          {
            id: 'gpt-5.1-codex',
            contextWindow: 200_000,
            strengths: ['reasoning', 'thinking', 'code'],
            provider: 'chatgpt-oauth',
          },
        ],
      }),
    );
    registerPeer(
      'ollama-box',
      capability({
        egress: 'local',
        models: [
          {
            id: 'qwen3.6:35b',
            contextWindow: 32_000,
            strengths: ['reasoning'],
            provider: 'ollama',
          },
        ],
      }),
    );

    const result = await executeRoutePeer({
      prompt: 'think deeply and analyze this multi-agent architecture',
      privacyTag: 'public',
    });

    expect(result.success).toBe(true);
    const data = result.data as {
      recommendation: { peer: string; model: string; provider: string };
      nextCall: { tool: string; args: { peer: string; model: string; provider: string } };
    };
    expect(data.recommendation).toMatchObject({
      peer: 'chatgpt-pro',
      model: 'gpt-5.1-codex',
      provider: 'chatgpt-oauth',
    });
    expect(data.nextCall).toEqual({
      tool: 'peer_delegate',
      args: {
        peer: 'chatgpt-pro',
        prompt: 'think deeply and analyze this multi-agent architecture',
        model: 'gpt-5.1-codex',
        provider: 'chatgpt-oauth',
      },
    });
  });

  it('propagates dispatchProfile into routing and the suggested peer_delegate call', async () => {
    registerPeer(
      'review-box',
      capability({
        models: [
          {
            id: 'fast-small',
            contextWindow: 32_000,
            strengths: ['cheap', 'fast'],
            provider: 'ollama',
          },
          {
            id: 'reviewer',
            contextWindow: 32_000,
            strengths: ['reasoning'],
            provider: 'ollama',
          },
        ],
      }),
    );

    const result = await executeRoutePeer({
      prompt: 'quick patch review',
      dispatchProfile: 'review',
    });

    expect(result.success).toBe(true);
    const data = result.data as {
      recommendation: { model: string };
      dispatchProfile: string;
      toolPolicy: { policyProfile: string; denyGroups: string[] };
      toolDecisions: Array<{ tool: string; action: string; matchedGroup?: string }>;
      toolset: { toolsetId: string; deniedTools: string[] };
      nextCall: { args: { dispatchProfile?: string } };
      rationale: string;
    };
    expect(data.recommendation.model).toBe('reviewer');
    expect(data.dispatchProfile).toBe('review');
    expect(data.toolPolicy.policyProfile).toBe('minimal');
    expect(data.toolPolicy.denyGroups).toContain('group:fs:write');
    expect(data.toolDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'view_file', action: 'allow' }),
        expect.objectContaining({ tool: 'create_file', action: 'deny' }),
        expect.objectContaining({ tool: 'bash', action: 'deny' }),
      ]),
    );
    expect(data.toolset.toolsetId).toBe('fleet.hermes.review');
    expect(data.toolset.deniedTools).toEqual(
      expect.arrayContaining(['create_file', 'bash']),
    );
    expect(data.nextCall.args.dispatchProfile).toBe('review');
    expect(data.rationale).toContain('Profile: review');
  });

  it('preserves peer.describe role tags so profile routing can choose the right specialist', async () => {
    const sharedModel = {
      id: 'reasoner',
      contextWindow: 32_000,
      strengths: ['reasoning'],
      provider: 'ollama' as const,
    };
    registerPeer(
      'coder-box',
      capability({
        roles: ['code'],
        models: [sharedModel],
      }),
    );
    registerPeer(
      'review-box',
      capability({
        roles: ['review'],
        models: [sharedModel],
      }),
    );

    const result = await executeRoutePeer({
      prompt: 'review this patch for regressions',
      dispatchProfile: 'review',
    });

    expect(result.success).toBe(true);
    const data = result.data as {
      recommendation: { peer: string; model: string; role?: string };
      rationale: string;
    };
    expect(data.recommendation).toMatchObject({
      peer: 'review-box',
      model: 'reasoner',
      role: 'review',
    });
    expect(data.rationale).toContain('Role hint: review');
  });

  it('returns an ordered peer_delegate chain when chainRoles are requested', async () => {
    const sharedModel = {
      id: 'reasoner',
      contextWindow: 32_000,
      strengths: ['reasoning'],
      provider: 'ollama' as const,
    };
    registerPeer(
      'code-box',
      capability({
        roles: ['code'],
        models: [sharedModel],
      }),
    );
    registerPeer(
      'review-box',
      capability({
        roles: ['review'],
        models: [sharedModel],
      }),
    );
    registerPeer(
      'safe-box',
      capability({
        roles: ['safe'],
        models: [sharedModel],
      }),
    );

    const result = await executeRoutePeer({
      prompt: 'think deeply about implementing, reviewing, and testing this patch',
      chainRoles: ['code', 'review', 'safe'],
    });

    expect(result.success).toBe(true);
    const data = result.data as {
      mode: string;
      recommendation: { peer: string; role?: string };
      chain: Array<{ peer: string; model: string; role?: string }>;
      nextCall: { tool: string; args: { peer: string; dispatchProfile?: string } };
      nextCalls: Array<{
        tool: string;
        args: { peer: string; model: string; dispatchProfile?: string };
      }>;
      rationale: string;
    };
    expect(data.mode).toBe('chain');
    expect(data.recommendation).toMatchObject({ peer: 'code-box', role: 'code' });
    expect(data.chain.map((lane) => [lane.peer, lane.role])).toEqual([
      ['code-box', 'code'],
      ['review-box', 'review'],
      ['safe-box', 'safe'],
    ]);
    expect(data.nextCalls.map((call) => [call.args.peer, call.args.dispatchProfile])).toEqual([
      ['code-box', 'code'],
      ['review-box', 'review'],
      ['safe-box', 'safe'],
    ]);
    expect(data.nextCall).toEqual(data.nextCalls[0]);
    expect(data.rationale).toContain('Chain dispatch: code');
  });

  it('rejects invalid chainRoles before peer discovery', async () => {
    const result = await executeRoutePeer({
      prompt: 'review this patch',
      chainRoles: ['code', 'chaos'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('chainRoles must contain only');
  });

  it('rejects chainRoles combined with parallelism', async () => {
    const result = await executeRoutePeer({
      prompt: 'review this patch',
      chainRoles: ['code', 'review'],
      parallelism: 2,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('mutually exclusive');
  });

  it('propagates the active agent dispatch profile when omitted by the caller', async () => {
    setActiveCustomAgentRuntime({
      id: 'hermes',
      name: 'Hermes Agent',
      description: '',
      systemPrompt: 'prompt',
      fleetDispatchProfile: 'review',
      requireExplicitDispatchProfile: true,
    });
    registerPeer(
      'review-box',
      capability({
        models: [
          {
            id: 'reviewer',
            contextWindow: 32_000,
            strengths: ['reasoning'],
            provider: 'ollama',
          },
        ],
      }),
    );

    const result = await executeRoutePeer({
      prompt: 'review this patch',
    });

    expect(result.success).toBe(true);
    const data = result.data as {
      dispatchProfile: string;
      dispatchProfileSource: string;
      dispatchProfileAgent?: string;
      nextCall: { args: { dispatchProfile?: string } };
      toolset: { toolsetId: string };
    };
    expect(data.dispatchProfile).toBe('review');
    expect(data.dispatchProfileSource).toBe('agent-default');
    expect(data.dispatchProfileAgent).toBe('hermes');
    expect(data.nextCall.args.dispatchProfile).toBe('review');
    expect(data.toolset.toolsetId).toBe('fleet.hermes.review');
  });

  it('vetoes cloud peers when privacyTag is sensitive', async () => {
    registerPeer(
      'chatgpt-pro',
      capability({
        egress: 'cloud',
        models: [
          {
            id: 'gpt-5.1-codex',
            contextWindow: 200_000,
            strengths: ['reasoning', 'thinking'],
            provider: 'chatgpt-oauth',
          },
        ],
      }),
    );
    registerPeer(
      'local-ollama',
      capability({
        egress: 'local',
        models: [
          {
            id: 'qwen3.6:35b',
            contextWindow: 32_000,
            strengths: ['reasoning', 'thinking'],
            provider: 'ollama',
          },
        ],
      }),
    );

    const result = await executeRoutePeer({
      prompt: 'think through this private codebase bug',
      privacyTag: 'sensitive',
    });

    expect(result.success).toBe(true);
    expect((result.data as { recommendation: { peer: string } }).recommendation.peer).toBe(
      'local-ollama',
    );
  });

  it('returns describe errors when no peer exposes capabilities', async () => {
    registerPeer('listen-only', null, new Error('FORBIDDEN: peer:invoke scope required'));

    const result = await executeRoutePeer({ prompt: 'where should this run?' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No connected peer exposed routable capabilities');
    expect((result.data as { describeErrors: Array<{ peer: string; error: string }> }).describeErrors)
      .toEqual([
        {
          peer: 'listen-only',
          error: 'FORBIDDEN: peer:invoke scope required',
        },
      ]);
  });
});
