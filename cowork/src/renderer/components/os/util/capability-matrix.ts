import type { Peer } from './fleet-model.js';

export interface CapabilityCell {
  peerId: string;
  capability: string;
  available: boolean;
  source: 'model' | 'tool' | 'capability' | 'missing';
}

export type Cell = CapabilityCell;

type CapabilitySource = CapabilityCell['source'];

function peerCapabilities(peer: Peer) {
  const entries = new Map<string, CapabilitySource>();
  for (const model of peer.models ?? []) {
    entries.set(model, 'model');
  }
  for (const tool of peer.tools ?? []) {
    entries.set(tool, 'tool');
  }
  for (const capability of peer.capabilities ?? []) {
    entries.set(capability, 'capability');
  }
  return entries;
}

export function buildMatrix(peers: Peer[], capabilities?: string[]): Cell[][] {
  const allCapabilities = capabilities ?? Array.from(new Set(peers.flatMap((peer) => [
    ...(peer.models ?? []),
    ...(peer.tools ?? []),
    ...(peer.capabilities ?? []),
  ]))).sort((left, right) => left.localeCompare(right));

  return peers.map((peer) => {
    const owned = peerCapabilities(peer);
    return allCapabilities.map((capability) => ({
      peerId: peer.id,
      capability,
      available: owned.has(capability),
      source: owned.get(capability) ?? 'missing',
    }));
  });
}

export function coverageOf(capability: string, peers: Peer[]): number {
  if (peers.length === 0) {
    return 0;
  }
  const covered = peers.filter((peer) => peerCapabilities(peer).has(capability)).length;
  return covered / peers.length;
}
