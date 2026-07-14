/**
 * Heartbeat scheduler — turns the nervous-system heartbeat into a PACEMAKER for
 * periodic processing in Code Buddy. Register "treatments" that fire every N
 * beats; the daemon's heart rate (BUDDY_SENSE_HEARTBEAT_MS) dials how often they
 * run — a faster heart triggers more processing, a slower one less.
 *
 * This is the heartbeat-paced analogue of Hermes's curator/cron and OpenClaw's
 * cron-jobs + dreaming: scheduled background work, but driven by the heart rather
 * than a wall clock. Each beat carries vital signs (uptime, load) the treatments
 * can read — so a treatment can also adapt to the body's state.
 *
 * @module sensory/heartbeat-scheduler
 */

import { getGlobalEventBus } from '../events/event-bus.js';
import type { BaseEvent } from '../events/types.js';
import { logger } from '../utils/logger.js';

export interface HeartbeatContext {
  beat: number;
  uptimeMs?: number;
  load1?: number | null;
}

export type HeartbeatHandler = (ctx: HeartbeatContext) => void | Promise<void>;

export interface HeartbeatTask {
  name: string;
  /** Fire when `beat % everyBeats === 0` (1 = every beat). */
  everyBeats: number;
  handler: HeartbeatHandler;
}

interface HeartbeatPayload {
  beat?: number;
  uptime_ms?: number;
  load1?: number | null;
}

export class HeartbeatScheduler {
  private readonly tasks = new Map<string, HeartbeatTask>();
  private listenerId?: string;
  /**
   * One independent lock per organ. A slow memory/LLM treatment must not
   * overlap itself, but it must never stop vision, quality, prefetch or other
   * autonomous organs from receiving the next heartbeat.
   */
  private readonly inFlight = new Map<string, { beat: number; startedAt: number }>();

  /** Register a treatment to run every N beats. Re-registering replaces it. */
  register(task: HeartbeatTask): void {
    if (!Number.isInteger(task.everyBeats) || task.everyBeats < 1) {
      throw new Error(`heartbeat task "${task.name}": everyBeats must be an integer >= 1`);
    }
    this.tasks.set(task.name, task);
  }

  unregister(name: string): void {
    this.tasks.delete(name);
  }

  list(): HeartbeatTask[] {
    return [...this.tasks.values()];
  }

  /** Subscribe to the sensory bus and start pacing. Idempotent. */
  start(): void {
    if (this.listenerId) return;
    const bus = getGlobalEventBus();
    this.listenerId = bus.on('sensory:perception', (evt: BaseEvent) => {
      const m = evt.metadata as { modality?: string; kind?: string; payload?: HeartbeatPayload } | undefined;
      if (m?.modality !== 'vital' || m?.kind !== 'heartbeat') return;
      const beat = Number(m.payload?.beat ?? 0);
      if (!Number.isFinite(beat) || beat < 1) return;
      this.onBeat({ beat, uptimeMs: m.payload?.uptime_ms, load1: m.payload?.load1 });
    });
  }

  stop(): void {
    if (this.listenerId) {
      getGlobalEventBus().off(this.listenerId);
      this.listenerId = undefined;
    }
  }

  private onBeat(ctx: HeartbeatContext): void {
    for (const task of this.tasks.values()) {
      if (ctx.beat % task.everyBeats !== 0) continue;
      const active = this.inFlight.get(task.name);
      if (active) {
        logger.debug(
          `[heartbeat] treatment "${task.name}" skipped on beat ${ctx.beat} — ` +
            `its beat ${active.beat} run is still active`,
        );
        continue;
      }

      this.inFlight.set(task.name, { beat: ctx.beat, startedAt: Date.now() });
      // Schedule every due organ before any handler starts. Async IO (model,
      // network, disk, device) can then progress concurrently; CPU-heavy work
      // remains cooperative and can later move to a worker process.
      queueMicrotask(() => {
        void Promise.resolve()
          .then(() => task.handler(ctx))
          .catch((err) => {
            logger.warn(
              `[heartbeat] treatment "${task.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          })
          .finally(() => {
            this.inFlight.delete(task.name);
          });
      });
    }
  }
}

let singleton: HeartbeatScheduler | undefined;

export function getHeartbeatScheduler(): HeartbeatScheduler {
  if (!singleton) singleton = new HeartbeatScheduler();
  return singleton;
}
