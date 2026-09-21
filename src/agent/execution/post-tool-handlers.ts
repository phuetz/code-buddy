/**
 * Post-tool handlers — side effects after a tool finishes.
 *
 * Records per-tool metrics (success + duration) and feeds the session-level
 * counters used by the session-end skill generator. Also tracks which files
 * were touched so multi-file sessions are recognised as complex.
 *
 * @module agent/execution/post-tool-handlers
 */

import { logger } from '../../utils/logger.js';
import { getObservationVariator } from '../../context/observation-variator.js';
import {
  recordToolCall,
  recordRecoveredError,
  recordFileTouched,
} from '../../memory/session-metrics-tracker.js';

/** Tool names that mutate files on disk. */
const FILE_MUTATING_TOOLS = new Set([
  'str_replace_editor',
  'write_file',
  'create_file',
  'delete_file',
  'apply_patch',
  'edit_file',
  'multi_edit',
]);

export interface PostToolContext {
  toolName: string;
  success: boolean;
  durationMs: number;
  /** Raw tool arguments, used to extract touched file paths. */
  args?: Record<string, unknown>;
  /**
   * Repertoire du projet ou les metriques sont ecrites. Sans lui, les
   * enregistreurs retombent sur process.cwd() : les metriques d'une session
   * lancee depuis un autre repertoire partaient ailleurs que la session
   * elle-meme, ouverte par beginSession(sessionId, workDir).
   */
  workDir?: string;
}

/**
 * Run all post-tool side effects. Best-effort: never throws, never blocks
 * the agent loop.
 */
export function handlePostTool(ctx: PostToolContext): void {
  const workDir = ctx.workDir ?? process.cwd();

  try {
    recordToolCall(workDir);
    if (!ctx.success) recordRecoveredError(workDir);
  } catch {
    /* metrics are optional */
  }

  if (FILE_MUTATING_TOOLS.has(ctx.toolName)) {
    const files = extractTouchedFiles(ctx.toolName, ctx.args);
    for (const f of files) {
      try {
        recordFileTouched(f, workDir);
      } catch {
        /* best-effort */
      }
    }
  }
}

/**
 * Pull file paths out of a tool's arguments. Different tools store the path
 * under different keys, so we check the common ones.
 */
function extractTouchedFiles(
  toolName: string,
  args?: Record<string, unknown>,
): string[] {
  if (!args) return [];
  const out: string[] = [];
  const candidates = [
    args.path,
    args.file,
    args.file_path,
    args.filePath,
    args.target,
    args.filename,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) out.push(c);
  }
  // multi_edit / apply_patch may carry an array of edits
  const edits = args.edits ?? args.operations ?? args.changes;
  if (Array.isArray(edits)) {
    for (const e of edits) {
      if (e && typeof e === 'object') {
        const p = (e as { path?: unknown; file?: unknown }).path
          ?? (e as { path?: unknown; file?: unknown }).file;
        if (typeof p === 'string' && p.length > 0) out.push(p);
      }
    }
  }
  return out;
}

/** Test helper. */
export function _resetForTests(): void {
  /* no-op: tracker is file-backed */
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
