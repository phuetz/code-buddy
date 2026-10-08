/**
 * Default progress sink — Phase (d).21 ship 4.
 *
 * Wakes `ProgressTracker` (previously dormant: registered but no
 * callers). Provides:
 *   - a process-level singleton (`getProgressTracker()`)
 *   - a default log-based sink that emits one info line per ~25%
 *     completion threshold (avoids per-tool log spam)
 *
 * Boot wiring: `codebuddy-agent.ts` calls `wireDefaultProgressSink()`
 * once at startup. Idempotent.
 *
 * Consumers:
 *   - `agent-executor.runTurnLoop()` calls `start()` at loop entry and
 *     `update()` per tool execution. Both streaming + sequential paths.
 *   - Future Cowork progress bar can listen on `getProgressTracker()
 *     .on('progress', ...)` for finer updates than the log thresholds.
 *
 * @module src/agent/planner/progress-default-sink
 */

import { ProgressTracker, type ProgressUpdate } from './progress-tracker.js';
import { logger } from '../../utils/logger.js';

let instance: ProgressTracker | null = null;
let wired = false;

/** Process-level singleton. */
export function getProgressTracker(): ProgressTracker {
  if (instance === null) instance = new ProgressTracker();
  return instance;
}

/**
 * Register the default log sink. Logs progress at the 25 / 50 / 75 / 100
 * thresholds (and never twice for the same threshold within a session).
 * Idempotent — second call is a no-op.
 */
export function wireDefaultProgressSink(): void {
  if (wired) return;
  wired = true;
  const tracker = getProgressTracker();
  let lastLoggedThreshold = -1;

  tracker.on('start', (data: { total: number }) => {
    lastLoggedThreshold = -1;
    logger.debug?.('[progress] turn started', { total: data.total });
  });

  tracker.on('progress', (update: ProgressUpdate) => {
    const done = update.completed + update.failed;
    const pct = update.total > 0
      ? Math.min(100, Math.round((done / update.total) * 100))
      : 0;
    // Cross a 25%-quantum threshold → log. Avoids per-tool spam.
    const bucket = Math.floor(pct / 25) * 25;
    if (bucket > lastLoggedThreshold && bucket > 0) {
      lastLoggedThreshold = bucket;
      const etaPart =
        update.eta !== undefined ? `, ETA ~${Math.round(update.eta / 1000)}s` : '';
      logger.info(
        `[progress] ${pct}% (${done}/${update.total} done${etaPart})`,
      );
    }
  });
}

/** Test-only — drop the singleton and the wired flag. */
export function _resetForTests(): void {
  instance = null;
  wired = false;
}
