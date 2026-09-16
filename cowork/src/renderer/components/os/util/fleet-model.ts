import { FLEET_SILENCE_THRESHOLD_MS } from '../../../utils/fleet-freshness';

export type PeerStatus = 'online' | 'busy' | 'offline';
export type PeerRole = 'hub' | 'leaf' | 'reviewer' | 'research' | 'code' | 'safe' | string;

export interface Peer {
  id: string;
  label: string;
  status: PeerStatus;
  role: PeerRole;
  utilization: number;
  latencyMs?: number;
  models?: string[];
  tools?: string[];
  capabilities?: string[];
  /**
   * Authenticated, but nothing received for over three heartbeats. Presentation
   * only: it never changes `status`, the summary or routing.
   */
  quiet?: boolean;
}

export const QUIET_PEER_HINT = `Authentifié, mais rien reçu depuis plus de ${
  FLEET_SILENCE_THRESHOLD_MS / 1_000
} s. Statut et routage inchangés.`;

export interface FleetSummary {
  online: number;
  busy: number;
  offline: number;
  avgLatency: number;
}

export function summarizeFleet(peers: Peer[]): FleetSummary {
  const online = peers.filter((peer) => peer.status === 'online').length;
  const busy = peers.filter((peer) => peer.status === 'busy').length;
  const offline = peers.filter((peer) => peer.status === 'offline').length;
  const latencies = peers
    .map((peer) => peer.latencyMs)
    .filter((latency): latency is number => typeof latency === 'number' && Number.isFinite(latency));
  const avgLatency = latencies.length === 0 ? 0 : Math.round(latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length);

  return { online, busy, offline, avgLatency };
}

export function utilizationTone(utilization: number): 'ok' | 'warn' | 'critical' {
  if (utilization >= 0.85) {
    return 'critical';
  }
  if (utilization >= 0.65) {
    return 'warn';
  }
  return 'ok';
}
