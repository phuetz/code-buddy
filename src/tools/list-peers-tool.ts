/**
 * list_peers tool — Phase (d).17.
 *
 * Read-only projection of FleetRegistry state. By default no extra RPCs
 * are made: the LLM gets a fast snapshot of what's already known
 * locally. When `includeCapabilities` is true, the tool best-effort
 * calls `peer.describe` on each peer so the LLM can choose between
 * providers/models before using `peer_delegate`.
 *
 * @module src/tools/list-peers-tool
 */

import { getFleetRegistry } from '../fleet/fleet-registry.js';
import type { FleetProvider, ModelStrength, PeerCapability } from '../fleet/types.js';
import type { ToolResult } from '../types/index.js';

export interface ListPeersParams {
  includeCapabilities?: boolean;
  timeoutMs?: number;
}

export interface ListedPeerChatProvider {
  provider: string;
  model: string;
  isLocal: boolean;
}

export interface ListedPeerCapabilities {
  machineLabel: string;
  egress: PeerCapability['egress'];
  modelCount: number;
  providers: FleetProvider[];
  topModels: string[];
  strengths: ModelStrength[];
  maxConcurrency?: number;
  activeRequests?: number;
}

export interface ListedPeer {
  id: string;
  url: string;
  connectedSince: string;
  eventCount: number;
  lastSeenAgeMs: number | null;
  lastSeenReason: string | null;
  connected: boolean | null;
  /** Result of the optional peer.describe probe, not an inference from configuration. */
  reachable?: boolean;
  compacting: boolean;
  stale: boolean;
  /** Conservative hint — peer has been seen recently and isn't compacting. */
  peerChatLikelyAvailable: boolean;
  /** Present when includeCapabilities=true and peer.describe succeeds. */
  peerChatProvider?: ListedPeerChatProvider | null;
  /** Present when includeCapabilities=true and peer.describe returns capabilities. */
  capabilities?: ListedPeerCapabilities | null;
  /** Present when includeCapabilities=true but peer.describe fails. */
  describeError?: string;
}

export async function executeListPeers(params: ListPeersParams = {}): Promise<ToolResult> {
  const reg = getFleetRegistry();
  const entries = reg.list();

  if (entries.length === 0) {
    return {
      success: true,
      output:
        'No fleet peers connected to this session. Code Buddy supports remote collaboration; this does not prove no other Buddy is running on the network. Connect a known peer with /fleet listen <ws-url> --name <id>, then use list_peers with includeCapabilities=true and peer_delegate. No automatic network scan was performed.',
      data: { peers: [] as ListedPeer[] },
    };
  }

  const peers: ListedPeer[] = entries.map((entry) => {
    const seen = entry.listener.getLastSeen();
    const compaction = entry.listener.getPeerCompactionState();
    return {
      id: entry.id,
      url: entry.url,
      connectedSince: entry.startedAt.toISOString(),
      eventCount: entry.eventCount,
      lastSeenAgeMs: seen.ageMs,
      lastSeenReason: seen.reason,
      connected: entry.listener.isConnected?.() ?? null,
      compacting: compaction.active,
      stale: entry.listener.isStale(),
      peerChatLikelyAvailable: entry.listener.isConnected?.() === true && !entry.listener.isStale() && seen.ageMs !== null && !compaction.active,
    };
  });

  if (params.includeCapabilities) {
    const timeoutMs =
      params.timeoutMs && params.timeoutMs > 0 ? params.timeoutMs : 5_000;
    await Promise.all(
      entries.map(async (entry, index) => {
        // peers is built by mapping the same `entries` array, so this index
        // is always in range; guard regardless to satisfy strict indexing.
        const peer = peers[index];
        if (peer === undefined) return;
        try {
          const raw = await entry.listener.request(
            'peer.describe',
            {},
            { timeoutMs },
          );
          const described = raw && typeof raw === 'object' ? raw as {
            peerChatProvider?: unknown;
            capabilities?: unknown;
          } : {};
          peer.reachable = true;
          peer.peerChatProvider = normalizePeerChatProvider(
            described.peerChatProvider,
          );
          peer.peerChatLikelyAvailable = entry.listener.isConnected?.() === true && !entry.listener.getPeerCompactionState().active && peer.peerChatProvider !== null;
          peer.capabilities = summarizeCapabilities(
            described.capabilities,
          );
        } catch (err) {
          peer.reachable = false;
          peer.peerChatLikelyAvailable = false;
          peer.describeError =
            err instanceof Error ? err.message : String(err);
        }
      }),
    );
  }

  return {
    success: true,
    output: JSON.stringify(peers, null, 2),
    data: { peers },
  };
}

function normalizePeerChatProvider(raw: unknown): ListedPeerChatProvider | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as {
    provider?: unknown;
    model?: unknown;
    isLocal?: unknown;
  };
  if (
    typeof candidate.provider !== 'string' ||
    typeof candidate.model !== 'string' ||
    typeof candidate.isLocal !== 'boolean'
  ) {
    return null;
  }
  return {
    provider: candidate.provider,
    model: candidate.model,
    isLocal: candidate.isLocal,
  };
}

function summarizeCapabilities(raw: unknown): ListedPeerCapabilities | null {
  if (!raw || typeof raw !== 'object') return null;
  const cap = raw as Partial<PeerCapability>;
  if (!Array.isArray(cap.models) || cap.models.some(model =>
    !model || typeof model !== 'object' || typeof model.id !== 'string' ||
    typeof model.provider !== 'string' || !Array.isArray(model.strengths) ||
    model.strengths.some(strength => typeof strength !== 'string')
  )) return null;

  const providers = new Set<FleetProvider>();
  const strengths = new Set<ModelStrength>();
  for (const model of cap.models) {
    providers.add(model.provider);
    for (const strength of model.strengths) strengths.add(strength);
  }

  return {
    machineLabel: typeof cap.machineLabel === 'string' ? cap.machineLabel : '',
    egress: cap.egress ?? 'local',
    modelCount: cap.models.length,
    providers: Array.from(providers).sort(),
    topModels: cap.models.slice(0, 6).map((model) => model.id),
    strengths: Array.from(strengths).sort(),
    maxConcurrency: cap.maxConcurrency,
    activeRequests: cap.activeRequests,
  };
}
