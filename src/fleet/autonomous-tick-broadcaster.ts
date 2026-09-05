/**
 * Fleet autonomous-tick broadcaster (Hermes-style background daemon).
 *
 * Wakes the existing `fleet-tick-handler.runFleetTick()` (proven over
 * 6+ cycles via the external Python wrapper, Phase (d).18) into an
 * in-process daemon. Each tick claims at most one open task from the
 * fleet git bus and runs it under the in-process CodeBuddyAgent.
 *
 * Mirrors `heartbeat-broadcaster.ts` exactly: singleton timer,
 * `setInterval` with `unref()` so the daemon never blocks process
 * exit, idempotent start, graceful stop.
 *
 * Activation contract:
 *   - Caller passes `repoPath` (typically `process.env.CODEBUDDY_FLEET_REPO_PATH`).
 *   - When `repoPath` is falsy → log a `daemon inactive` warning and
 *     return a noop stop function. The autonomous fleet collaboration
 *     is opt-in; servers without a configured fleet repo boot clean.
 *   - When `repoPath` is set → fire `runFleetTick(mergedOpts)` every
 *     `intervalMs` (default 5 min). Each tick's outcome is logged.
 *
 * Failure handling: tick errors are swallowed at the timer boundary
 * (logged at warn level). The next tick still fires — a single bad
 * tick (transient git failure, e.g.) must not silence the daemon.
 *
 * @module fleet/autonomous-tick-broadcaster
 */

import {
  runFleetTick,
  type FleetTickOptions,
} from '../agent/autonomous/fleet-tick-handler.js';
import type { FleetTickOutcome } from '../agent/autonomous/fleet-task-types.js';
import { logger } from '../utils/logger.js';

/** Default cadence: 5 minutes between ticks. */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** Operator-facing config — `tickOptions` lets the caller override
 *  per-tick options (priorityThreshold, llmProvider, etc.). */
export interface AutonomousTickConfig {
  /** Absolute path to the fleet git bus. Falsy → daemon stays inactive. */
  repoPath: string | undefined;
  /** Host identifier (e.g., `hub/grok-cli`). */
  host: string;
  /** Milliseconds between ticks. Default 300_000 (5 min). */
  intervalMs?: number;
  /** Per-tick options forwarded to `runFleetTick`. `repoPath`/`host`
   *  are filled from the daemon config so callers don't repeat them. */
  tickOptions?: Partial<Omit<FleetTickOptions, 'repoPath' | 'host'>>;
}

let timer: NodeJS.Timeout | null = null;
let activeIntervalMs: number | null = null;

/**
 * Start the autonomous-tick daemon. Returns a stop function (also
 * available globally via {@link stopAutonomousTick}). Idempotent — a
 * second start while already running is a no-op.
 *
 * When `config.repoPath` is falsy, this returns immediately with a
 * graceful warning. That is the **expected** state on hosts that
 * haven't opted into the fleet bus: server boot stays green.
 */
export function startAutonomousTick(config: AutonomousTickConfig): () => void {
  if (timer !== null) {
    logger.debug?.('[autonomous-tick] start() called while already running — no-op', {
      currentIntervalMs: activeIntervalMs,
    });
    return stopAutonomousTick;
  }

  const repoPath = config.repoPath?.trim();
  if (!repoPath) {
    logger.warn?.(
      '[autonomous-tick] no CODEBUDDY_FLEET_REPO_PATH configured — daemon inactive (set the env var to enable autonomous fleet collaboration)',
    );
    return stopAutonomousTick;
  }

  const interval =
    Number.isFinite(config.intervalMs) && (config.intervalMs ?? 0) > 0
      ? (config.intervalMs as number)
      : DEFAULT_INTERVAL_MS;

  const opts: FleetTickOptions = {
    ...config.tickOptions,
    repoPath,
    host: config.host,
  };

  activeIntervalMs = interval;
  timer = setInterval(() => {
    runOneTick(opts).catch((err) => {
      // Defensive — `runFleetTick` already wraps its own errors into
      // `FleetTickOutcome` shapes, but a runtime crash in agentRun
      // should never break the daemon loop.
      logger.warn?.('[autonomous-tick] tick crashed (timer continues)', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, interval);
  timer.unref();
  logger.info?.('[autonomous-tick] daemon started', {
    repoPath,
    host: config.host,
    intervalMs: interval,
  });
  return stopAutonomousTick;
}

/** Cancel the active tick timer. Idempotent. */
export function stopAutonomousTick(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
  activeIntervalMs = null;
  logger.debug?.('[autonomous-tick] daemon stopped');
}

/** Whether the daemon is currently running. */
export function isAutonomousTickActive(): boolean {
  return timer !== null;
}

/** Active interval in ms, or null when stopped. */
export function getAutonomousTickIntervalMs(): number | null {
  return activeIntervalMs;
}

/** Test-only reset. */
export function _stopAutonomousTickForTests(): void {
  stopAutonomousTick();
}

async function runOneTick(opts: FleetTickOptions): Promise<void> {
  const outcome: FleetTickOutcome = await runFleetTick(opts);
  logger.info?.('[autonomous-tick] tick outcome', {
    kind: outcome.kind,
    ...('taskId' in outcome ? { taskId: outcome.taskId } : {}),
    ...('reason' in outcome ? { reason: outcome.reason } : {}),
  });
}
