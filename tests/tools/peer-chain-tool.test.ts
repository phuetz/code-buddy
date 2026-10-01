/**
 * peer_chain tool tests.
 *
 * Verifies that an autonomous Fleet chain routes peers by role and
 * threads completed stage output into later peer.chat prompts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetActiveCustomAgentRuntime,
} from '../../src/agent/custom/custom-agent-runtime.js';
import {
  _resetFleetRegistryForTests,
  getFleetRegistry,
  type ActiveListenerEntry,
  type FleetListenerPublicAPI,
} from '../../src/fleet/fleet-registry.js';
import type { PeerCapability } from '../../src/fleet/types.js';
import { executePeerChain } from '../../src/tools/peer-chain-tool.js';
import { _resetCallCounterForTests } from '../../src/tools/peer-delegate-tool.js';

function capability(partial: Partial<PeerCapability>): PeerCapability {
  return {
    models: [],
    egress: 'local',
    machineLabel: 'test',
    ...partial,
  };
}

function registerPeer(
  id: string,
  peerCapability: PeerCapability,
  onChat: (params: Record<string, unknown>) => string | Promise<string>,
): void {
  const listener: FleetListenerPublicAPI = {
    disconnect: async () => undefined,
    getReconnectAttempts: () => 0,
    isReconnecting: () => false,
    request: vi.fn(async (method, params) => {
      if (method === 'peer.describe') {
        return { capabilities: peerCapability };
      }
      if (method === 'peer.chat') {
        return {
          text: await onChat(params as Record<string, unknown>),
          modelRequested: typeof params?.model === 'string' ? params.model : undefined,
          dispatchProfile:
            typeof params?.dispatchProfile === 'string' ? params.dispatchProfile : undefined,
        };
      }
      throw new Error(`unexpected method: ${method}`);
    }),
    getLastSeen: () => ({ at: Date.now(), reason: 'test', ageMs: 10 }),
    isStale: () => false,
    getPeerCompactionState: () => ({
      active: false,
      ageMs: null,
      lastResult: null,
      startedAt: null,
    }),
    getEventHistory: () => [],
  };
  const entry: ActiveListenerEntry = {
    id,
    url: `ws://example/${id}`,
    startedAt: new Date(),
    eventCount: 0,
    autoReconnect: false,
    maxAttempts: 5,
    listener,
  };
  getFleetRegistry().register(entry);
}

describe('peer_chain tool', () => {
  beforeEach(() => {
    _resetFleetRegistryForTests();
    _resetCallCounterForTests();
    resetActiveCustomAgentRuntime();
  });

  it('routes roles to specialists and threads stage output into the next prompt', async () => {
    const prompts: Record<string, string> = {};
    const sharedModel = {
      id: 'reasoner',
      contextWindow: 32_000,
      strengths: ['reasoning'],
      provider: 'ollama' as const,
    };

    registerPeer(
      'code-box',
      capability({ roles: ['code'], models: [sharedModel] }),
      (params) => {
        prompts.code = String(params.prompt);
        return 'code stage output';
      },
    );
    registerPeer(
      'review-box',
      capability({ roles: ['review'], models: [sharedModel] }),
      (params) => {
        prompts.review = String(params.prompt);
        return 'review stage output';
      },
    );
    registerPeer(
      'safe-box',
      capability({ roles: ['safe'], models: [sharedModel] }),
      (params) => {
        prompts.safe = String(params.prompt);
        return 'safe stage output';
      },
    );

    const result = await executePeerChain({
      prompt: 'implement and verify a small autonomous improvement',
      chainRoles: ['code', 'review', 'safe'],
      privacyTag: 'public',
    });

    expect(result.success).toBe(true);
    const data = result.data as {
      finalText: string;
      stages: Array<{ peer: string; role: string; text: string }>;
    };
    expect(data.finalText).toBe('safe stage output');
    expect(data.stages.map((stage) => [stage.role, stage.peer, stage.text])).toEqual([
      ['code', 'code-box', 'code stage output'],
      ['review', 'review-box', 'review stage output'],
      ['safe', 'safe-box', 'safe stage output'],
    ]);
    expect(prompts.code).toContain('Previous stage outputs: none');
    expect(prompts.review).toContain('code stage output');
    expect(prompts.safe).toContain('code stage output');
    expect(prompts.safe).toContain('review stage output');
  });

  it('vetoes cloud routing when secrets appear only in supplied excerpts', async () => {
    const chat = vi.fn(() => 'unexpected cloud answer');
    registerPeer('cloud-box', capability({ egress: 'cloud', roles: ['review'], models: [{ id: 'cloud-fixture', provider: 'openai', contextWindow: 32000, strengths: ['reasoning'] }] }), chat);
    const result = await executePeerChain({ prompt: 'review the supplied excerpt', sourceContext: 'fixture.txt: SSN 123-45-6789', chainRoles: ['review'], privacyTag: 'public' });
    expect(result.success).toBe(false);
    expect(chat).not.toHaveBeenCalled();
  });

  it('stops on the first failed stage and returns completed stage context', async () => {
    const sharedModel = {
      id: 'reasoner',
      contextWindow: 32_000,
      strengths: ['reasoning'],
      provider: 'ollama' as const,
    };
    registerPeer(
      'code-box',
      capability({ roles: ['code'], models: [sharedModel] }),
      () => 'code done',
    );

    const listener: FleetListenerPublicAPI = {
      disconnect: async () => undefined,
      getReconnectAttempts: () => 0,
      isReconnecting: () => false,
      request: vi.fn(async (method) => {
        if (method === 'peer.describe') {
          return { capabilities: capability({ roles: ['review'], models: [sharedModel] }) };
        }
        throw Object.assign(new Error('review unavailable'), { code: 'REQUEST_TIMEOUT' });
      }),
      getLastSeen: () => ({ at: Date.now(), reason: 'test', ageMs: 10 }),
      isStale: () => false,
      getPeerCompactionState: () => ({
        active: false,
        ageMs: null,
        lastResult: null,
        startedAt: null,
      }),
      getEventHistory: () => [],
    };
    getFleetRegistry().register({
      id: 'review-box',
      url: 'ws://example/review-box',
      startedAt: new Date(),
      eventCount: 0,
      autoReconnect: false,
      maxAttempts: 5,
      listener,
    });

    const result = await executePeerChain({
      prompt: 'implement then review',
      chainRoles: ['code', 'review'],
      stageTimeoutMs: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('stage 2/2');
    expect(result.error).toContain('review');
    const data = result.data as {
      completedStages: Array<{ role: string; text: string }>;
      failedStage: { role: string; peer: string };
    };
    expect(data.completedStages).toEqual([
      expect.objectContaining({ role: 'code', text: 'code done' }),
    ]);
    expect(data.failedStage).toMatchObject({ role: 'review', peer: 'review-box' });
  });

  it('rejects invalid chain roles before peer discovery', async () => {
    const result = await executePeerChain({
      prompt: 'review this',
      chainRoles: ['code', 'chaos'],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('chainRoles must contain only');
  });
});
