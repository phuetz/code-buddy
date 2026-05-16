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
        'No fleet peers connected. The user must run /fleet listen <ws-url> --name <id> first to add a peer.',
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
      compacting: compaction.active,
      stale: entry.listener.isStale(),
      peerChatLikelyAvailable: seen.ageMs !== null && !compaction.active,
    };
  });

  if (params.includeCapabilities) {
    const timeoutMs =
      params.timeoutMs && params.timeoutMs > 0 ? params.timeoutMs : 5_000;
    await Promise.all(
      entries.map(async (entry, index) => {
        try {
          const raw = await entry.listener.request(
            'peer.describe',
            {},
            { timeoutMs },
          );
          const described = raw as {
            peerChatProvider?: unknown;
            capabilities?: unknown;
          };
          peers[index].peerChatProvider = normalizePeerChatProvider(
            described.peerChatProvider,
          );
          peers[index].capabilities = summarizeCapabilities(
            described.capabilities,
          );
        } catch (err) {
          peers[index].describeError =
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
  if (!Array.isArray(cap.models)) return null;

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
