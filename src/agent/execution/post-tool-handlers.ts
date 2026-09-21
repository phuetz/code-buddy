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
}

/**
 * Run all post-tool side effects. Best-effort: never throws, never blocks
 * the agent loop.
 */
export function handlePostTool(ctx: PostToolContext): void {
  try {
    recordToolCall();
    if (!ctx.success) recordRecoveredError();
  } catch {
    /* metrics are optional */
  }

  if (FILE_MUTATING_TOOLS.has(ctx.toolName)) {
    const files = extractTouchedFiles(ctx.toolName, ctx.args);
    for (const f of files) {
      try {
        recordFileTouched(f);
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
