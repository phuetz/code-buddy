/**
 * Mobile status payload: current provider, optional provider-health.json,
 * live fallback-chain health, and connected fleet peers.
 */

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadRelationshipState,
  moodBand,
  personalityOf,
} from '../../companion/relationship-state.js';
import { detectProviderFromEnv } from '../../utils/provider-detector.js';
import { getConnectionStats } from '../websocket/handler.js';
import { peekUserFacingFailoverNotice } from '../../providers/provider-failover-user-notice.js';

export interface MobilePeerStatus {
  id: string;
  url: string;
  stale: boolean;
  describe: Record<string, unknown> | null;
}

function readJsonFile(filePath: string): unknown {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export function readProviderHealthFile(homeDir = os.homedir()): unknown {
  const candidates = [
    path.join(homeDir, '.codebuddy', 'provider-health.json'),
    path.join(process.cwd(), '.codebuddy', 'provider-health.json'),
  ];
  for (const file of candidates) {
    const parsed = readJsonFile(file);
    if (parsed !== null) return parsed;
  }
  return null;
}

export async function listFleetPeersForMobile(
  describeTimeoutMs = 2_000,
): Promise<MobilePeerStatus[]> {
  const { getFleetRegistry } = await import('../../fleet/fleet-registry.js');
  const peers: MobilePeerStatus[] = [];
  for (const entry of getFleetRegistry().list()) {
    let describe: Record<string, unknown> | null = null;
    try {
      const raw = await entry.listener.request('peer.describe', {}, { timeoutMs: describeTimeoutMs });
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        describe = raw as Record<string, unknown>;
      }
    } catch {
      describe = null;
    }
    peers.push({
      id: entry.id,
      url: entry.url,
      stale: entry.listener.isStale(),
      describe,
    });
  }
  return peers;
}

/**
 * Read-only companion mood/traits for the PWA header.
 * Present only when CODEBUDDY_COMPANION_RELATIONAL=true; otherwise omitted.
 */
export function companionStatusForMobile():
  | { mood: number; traits: ReturnType<typeof personalityOf>['traits']; label: ReturnType<typeof moodBand> }
  | undefined {
  if (process.env.CODEBUDDY_COMPANION_RELATIONAL !== 'true') return undefined;
  const personality = personalityOf(loadRelationshipState());
  return {
    mood: personality.mood,
    traits: personality.traits,
    label: moodBand(personality.mood),
  };
}

export async function buildMobileStatus(homeDir = os.homedir()): Promise<Record<string, unknown>> {
  const detected = detectProviderFromEnv();
  let fallback: unknown = null;
  try {
    const { getFallbackChain } = await import('../../providers/fallback-chain.js');
    fallback = getFallbackChain().getAllHealthStatus();
  } catch {
    fallback = null;
  }

  const peers = await listFleetPeersForMobile();
  const companion = companionStatusForMobile();
  const notice = peekUserFacingFailoverNotice();
  return {
    provider: detected
      ? {
          id: detected.provider,
          model: detected.defaultModel,
          baseURL: detected.baseURL,
          source: detected.source ?? 'environment',
        }
      : null,
    providerHealthFile: readProviderHealthFile(homeDir),
    fallback,
    fleet: {
      connections: getConnectionStats(),
      peers,
    },
    ...(companion ? { companion } : {}),
    ...(notice ? { failoverNotice: notice.text, failoverNoticeKind: notice.kind } : {}),
  };
}
