/**
 * Post-Tool Handlers — side-effects that fire after every tool call.
 *
 * Extracts the small but identical helpers both paths apply once a tool
 * returns: persist the raw output to the restorable compressor, wrap it
 * via the observation variator, and (when YOLO is enabled) log the
 * running cost.
 *
 * UI / message-array side effects stay at the call site (sequential
 * mutates the entry history, streaming pushes a new ChatEntry + yields).
 *
 * @module agent/execution/post-tool-handlers
 */

import { logger } from '../../utils/logger.js';
import { getRestorableCompressor } from '../../context/restorable-compression.js';
import { getObservationVariator } from '../../context/observation-variator.js';

/**
 * Persist the raw tool output to disk via the restorable compressor.
 * Call-id-keyed; allows later restoration of compacted tool results.
 * No-op when toolCallId is empty.
 */
export function persistToolResult(
  toolCallId: string | undefined,
  rawContent: string,
  workDir = process.cwd(),
  sessionId?: string,
): void {
  if (toolCallId) {
    getRestorableCompressor().writeToolResult(toolCallId, rawContent, workDir, sessionId);
  }

  // Feed the session-metrics tracker so complex sessions can be distilled
  // into reusable authored skills. Best-effort: never throws.
  if (sessionId) {
    import('../../memory/session-metrics-tracker.js')
      .then(({ recordFileTouched }) => {
        // tool outputs rarely name a single file; record the call id as a
        // lightweight touch marker so the session is not counted as empty.
        recordFileTouched(`tool:${toolCallId}`);
      })
      .catch(() => { /* tracker optional */ });
  }
}

/**
 * Wrap raw tool output through the observation variator (Manus AI #17),
 * which rotates the presentation wrapper to prevent repetition drift.
 * Advances the variator's turn counter as a side-effect.
 */
export function applyObservationVariator(toolName: string, rawContent: string): string {
  const variator = getObservationVariator();
  variator.nextTurn();
  return variator.wrapToolResult(toolName, rawContent);
}

/**
 * Minimal config shape this helper needs — keeps the module decoupled
 * from the full ExecutorConfig.
 */
export interface YoloCostConfig {
  getSessionCost: () => number;
  getSessionCostLimit: () => number;
}

/**
 * If YOLO mode is on, log the running session cost. Errors are
 * swallowed (non-critical observability).
 */
export async function logYoloCostIfEnabled(config: YoloCostConfig): Promise<void> {
  try {
    const { getAutonomyManager } = await import('../../utils/autonomy-manager.js');
    if (getAutonomyManager().isYOLOEnabled()) {
      const sessionCost = config.getSessionCost();
      const sessionCostLimit = config.getSessionCostLimit();
      logger.info(`[YOLO] Cost: $${sessionCost.toFixed(4)} / $${sessionCostLimit}`);
    }
  } catch { /* non-critical */ }
}
