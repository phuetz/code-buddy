/** Outbound status only. This module never emits perceptions or authorizes actions. */
import { randomUUID } from 'node:crypto';
import type { BaseEvent } from '../events/types.js';
import { logger } from '../utils/logger.js';

export interface SensoryMissionBus {
  on(type: string, listener: (event: BaseEvent) => unknown): string;
  off(id: string): unknown;
}

export interface MissionObservation {
  id: string;
  missionId: string;
  type: 'observation';
  source: 'buddy-sense' | 'system-vitals';
  kind: 'heartbeat' | 'resource_threshold' | 'disk_low' | 'fleet_saturated';
  receivedAt: number;
  /** Receipt time is authoritative; producer clocks may differ. */
  observedAt?: number;
  values: Record<string, number | boolean>;
}

export interface SensoryMissionBridgeOptions {
  enabled?: boolean;
  missionId?: string;
  bus: SensoryMissionBus;
  /** Resolve only once the journal has durably accepted the observation.
   * Use observation.id as an idempotency key; errors retry at most twice.
   * The signal is aborted at teardown. No downstream action dispatch here.
   */
  publish(observation: MissionObservation, signal: AbortSignal): Promise<void>;
  intervalMs?: number;
  now?: () => number;
}

/** Adapt a local signed-room publisher without importing the hub or its keys.
 * The injected publisher must retain the same signing key across retries, build
 * a kind-9 message with these exact content/createdAt values, and resolve only
 * on durable acceptance (including an already-stored duplicate).
 * JSON includes observation.id, so equal samples from distinct observations
 * cannot collide; stable receivedAt keeps the signed event id stable on retry.
 */
export function createMissionObservationRoomPublisher(
  room: string,
  publish: (room: string, content: string, createdAt: number, signal: AbortSignal) => Promise<void>,
): SensoryMissionBridgeOptions['publish'] {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(room)) throw new Error('Invalid observation room');
  return async (observation, signal) => {
    signal.throwIfAborted();
    await publish(room, JSON.stringify(observation), Math.floor(observation.receivedAt / 1000), signal);
  };
}

const FIELDS = {
  heartbeat: ['load1'], // beat/uptime counters intentionally do not defeat change dedupe
  resource_threshold: ['rssMb', 'heapUsedMb', 'load1', 'vramPct', 'vramUsedMb', 'diskPct', 'diskFreeBytes', 'fleetUtilization', 'fleetSaturated'],
  disk_low: ['diskPct', 'diskFreeBytes'],
  fleet_saturated: ['fleetUtilization'],
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Disabled or unconfigured means zero subscriptions, timers, and publications.
 * Exactly four possible keys bound queued status snapshots and dedupe memory.
 * Replacing a queued snapshot coalesces bursts; this is status, not an audit log
 * of every physical transition. Incoming remote messages must use a separate bus.
 */
export function wireSensoryMissionBridge(options: SensoryMissionBridgeOptions): () => void {
  const missionId = options.missionId;
  if (options.enabled !== true || !missionId || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(missionId)) return () => {};
  const intervalMs = options.intervalMs ?? 5_000;
  if (!Number.isFinite(intervalMs) || intervalMs < 1_000 || intervalMs > 60_000) {
    throw new Error('Observation interval must be between 1000 and 60000 ms');
  }
  const now = options.now ?? Date.now;
  type Pending = { observation: MissionObservation; fingerprint: string; attempts: number };
  const pending = new Map<string, Pending>();
  const delivered = new Map<string, string>();
  const controller = new AbortController();
  let active = true;
  let publishing = false;
  const listenerId = options.bus.on('sensory:perception', (event) => {
    if (!active || !record(event.metadata)) return;
    const meta = event.metadata;
    const kind = meta.kind;
    if (typeof kind !== 'string' || !Object.hasOwn(FIELDS, kind)) return;
    if (event.source === 'buddy-sense') {
      if (meta.modality !== 'vital' || kind !== 'heartbeat') return;
    } else if (event.source === 'system-vitals') {
      if (meta.modality !== 'system' || kind === 'heartbeat') return;
    } else return; // Includes remote, domain-bridge, and missing sources.
    if (!record(meta.payload)) return;
    const values: Record<string, number | boolean> = {};
    for (const field of FIELDS[kind as keyof typeof FIELDS]) {
      const value = meta.payload[field];
      if (value === undefined || value === null) continue;
      if (field === 'fleetSaturated') {
        if (typeof value !== 'boolean') return;
      } else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER
        || ((field === 'diskPct' || field === 'vramPct') && value > 100)) return;
      values[field] = value as number | boolean;
    }
    if (Object.keys(values).length === 0) return;
    const fingerprint = JSON.stringify(values);
    if (pending.get(kind)?.fingerprint === fingerprint) return;
    const receivedAt = now();
    if (!Number.isFinite(receivedAt) || receivedAt < 0) return;
    pending.set(kind, {
      observation: {
        id: randomUUID(), missionId, type: 'observation', source: event.source,
        kind: kind as MissionObservation['kind'], receivedAt,
        ...(typeof meta.tsMs === 'number' && Number.isFinite(meta.tsMs) && meta.tsMs >= 0 ? { observedAt: meta.tsMs } : {}),
        values,
      },
      fingerprint, attempts: 0,
    });
  });
  const timer = setInterval(() => {
    if (!active || publishing) return;
    const first = pending.entries().next().value as [string, Pending] | undefined;
    if (!first) return;
    const [key, item] = first;
    pending.delete(key);
    if (delivered.get(key) === item.fingerprint) return;
    publishing = true;
    // Promise boundary captures synchronous publisher failures too.
    void Promise.resolve().then(() => {
      if (active) return options.publish(item.observation, controller.signal);
      return undefined;
    }).then(() => {
      if (active) delivered.set(key, item.fingerprint);
    }).catch(() => {
      if (active && !pending.has(key) && ++item.attempts < 3) pending.set(key, item);
      if (active) logger.warn('[sensory-mission] observation publication failed');
    }).finally(() => { publishing = false; });
  }, intervalMs);
  timer.unref();
  return () => {
    if (!active) return;
    active = false;
    clearInterval(timer);
    options.bus.off(listenerId);
    pending.clear();
    delivered.clear();
    controller.abort();
  };
}
