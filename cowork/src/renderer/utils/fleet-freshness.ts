/**
 * Fleet peer freshness — how recently Cowork heard from a peer.
 *
 * The main-process FleetBridge stamps `lastSeenAt` with the local receipt time
 * of every `fleet:*` event, heartbeats included. A `buddy server` peer beacons
 * `fleet:peer:heartbeat` every 30 s, so an authenticated peer that has sent
 * nothing for three beats is "silent": its socket may be half-open (machine
 * asleep, cable pulled) even though the status still reads authenticated.
 *
 * Silence is a presentation fact only. It never implies a disconnection and
 * never triggers a reconnect; other statuses already explain why nothing
 * arrives, so they are never called silent.
 */
import type { FleetPeer } from '../types';

/** `DEFAULT_INTERVAL_MS` of the core heartbeat broadcaster (`src/fleet/heartbeat-broadcaster.ts`). */
export const FLEET_HEARTBEAT_INTERVAL_MS = 30_000;

/** Three missed heartbeats — the threshold `/fleet status` uses to flag a stale peer. */
export const FLEET_SILENCE_THRESHOLD_MS = 3 * FLEET_HEARTBEAT_INTERVAL_MS;

/**
 * Receipts are stamped on this machine, but labels read a shared clock snapshot
 * that can lag by one tick; a receipt this far ahead still counts as just seen.
 */
export const FLEET_CLOCK_SKEW_TOLERANCE_MS = 10_000;

export type PeerFreshness =
  /** No event received yet: there is no baseline to judge silence against. */
  | { kind: 'never' }
  /** Not a usable epoch, or ahead of the clock beyond the tolerance. */
  | { kind: 'invalid' }
  | { kind: 'seen'; ageMs: number }
  /** Authenticated, but nothing received for more than the silence threshold. */
  | { kind: 'silent'; ageMs: number };

export function describePeerFreshness(
  peer: Pick<FleetPeer, 'status' | 'lastSeenAt'>,
  now: number
): PeerFreshness {
  const { lastSeenAt } = peer;
  if (lastSeenAt === undefined || lastSeenAt === null) return { kind: 'never' };
  if (typeof lastSeenAt !== 'number' || !Number.isFinite(lastSeenAt) || lastSeenAt <= 0) {
    return { kind: 'invalid' };
  }
  const elapsedMs = now - lastSeenAt;
  if (elapsedMs < -FLEET_CLOCK_SKEW_TOLERANCE_MS) return { kind: 'invalid' };
  const ageMs = Math.max(0, elapsedMs);
  if (peer.status === 'authenticated' && ageMs > FLEET_SILENCE_THRESHOLD_MS) {
    return { kind: 'silent', ageMs };
  }
  return { kind: 'seen', ageMs };
}

export type SeenAge =
  | { unit: 'justNow' }
  | { unit: 'seconds' | 'minutes' | 'hours' | 'days'; count: number };

export function toSeenAge(ageMs: number): SeenAge {
  if (ageMs < 10_000) return { unit: 'justNow' };
  if (ageMs < 60_000) return { unit: 'seconds', count: Math.floor(ageMs / 1_000) };
  if (ageMs < 3_600_000) return { unit: 'minutes', count: Math.floor(ageMs / 60_000) };
  if (ageMs < 86_400_000) return { unit: 'hours', count: Math.floor(ageMs / 3_600_000) };
  return { unit: 'days', count: Math.floor(ageMs / 86_400_000) };
}
