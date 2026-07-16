import { beforeEach, describe, expect, it } from 'vitest';
import { executeRoutePeer } from '../../src/tools/route-peer-tool.js';
import {
  getFleetRegistry,
  _resetFleetRegistryForTests,
  type ActiveListenerEntry,
  type FleetListenerPublicAPI,
} from '../../src/fleet/fleet-registry.js';
import type { FleetEgress, FleetProvider, PeerCapability } from '../../src/fleet/types.js';

function registerPeer(
  id: string,
  egress: FleetEgress,
  provider: FleetProvider,
  strengths: PeerCapability['models'][number]['strengths'],
): void {
  const capability: PeerCapability = {
    egress,
    machineLabel: id,
    models: [{
      id: `${provider}-model`,
      provider,
      egress,
      contextWindow: 64_000,
      strengths,
    }],
  };
  const listener: FleetListenerPublicAPI = {
    disconnect: async () => undefined,
    getReconnectAttempts: () => 0,
    isReconnecting: () => false,
    request: async () => ({ capabilities: capability }),
    getLastSeen: () => ({ at: Date.now(), reason: 'test', ageMs: 0 }),
    isStale: () => false,
    getPeerCompactionState: () => ({
      active: false,
      startedAt: null,
      ageMs: null,
      lastResult: null,
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

describe('route_peer privacy lint enforcement', () => {
  beforeEach(() => {
    _resetFleetRegistryForTests();
  });

  it('forces sensitive routing and refuses cloud/non-local peers for an API key', async () => {
    registerPeer('cloud-peer', 'cloud', 'openai', ['reasoning', 'code']);

    const result = await executeRoutePeer({
      prompt: 'Review this key: sk-proj-abcdefghijklmnopqrstuvwxyz123456',
      privacyTag: 'public',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No peer can satisfy');
    expect(result.data).toMatchObject({
      privacyTag: 'sensitive',
      privacyLint: { hasSecrets: true, highConfidence: true },
    });
  });

  it('selects only a local model when a high-confidence secret is present', async () => {
    registerPeer('cloud-peer', 'cloud', 'openai', ['reasoning', 'code']);
    registerPeer('local-peer', 'local', 'ollama', ['reasoning']);

    const result = await executeRoutePeer({
      prompt: 'Review this key: sk-proj-abcdefghijklmnopqrstuvwxyz123456',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      privacyTag: 'sensitive',
      privacyLint: { hasSecrets: true, highConfidence: true },
      recommendation: { peer: 'local-peer', provider: 'ollama' },
      nextCall: { args: { peer: 'local-peer', provider: 'ollama' } },
    });
  });

  it('forces sensitive routing for a lower-confidence private path match', async () => {
    registerPeer('cloud-peer', 'cloud', 'openai', ['reasoning', 'code']);
    registerPeer('local-peer', 'local', 'ollama', ['reasoning']);

    const result = await executeRoutePeer({
      prompt: 'Review the files under /home/patrice/private-project',
      privacyTag: 'public',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      privacyTag: 'sensitive',
      privacyLint: { hasSecrets: true, highConfidence: false },
      recommendation: { peer: 'local-peer' },
    });
  });

  it('routes an innocuous public prompt normally', async () => {
    registerPeer('cloud-peer', 'cloud', 'openai', ['reasoning', 'code']);

    const result = await executeRoutePeer({
      prompt: 'Review the architecture of this public example',
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      privacyTag: 'public',
      privacyLint: { hasSecrets: false, highConfidence: false },
      recommendation: { peer: 'cloud-peer' },
    });
  });
});
