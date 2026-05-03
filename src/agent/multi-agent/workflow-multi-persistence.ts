/**
 * Multi-workflow persistence (Phase O V0.4.1).
 *
 * Extends the V0.3 single-workflow persistence (workflow-persistence.ts)
 * to support multiple concurrent workflows, each saved to its own file
 * under ~/.codebuddy/agents/workflows/{id}.json.
 *
 * Backward compatibility:
 * - `loadAllWorkflows()` returns per-id files first, then falls back to
 *   the legacy ~/.codebuddy/agents/current.json so users with V0.3 saves
 *   can /agents resume without manual migration.
 * - V0.3 workflow-persistence.ts continues to write to current.json when
 *   the orchestrator is disabled (max_concurrent_workflows=1 default), so
 *   existing tests and resume flows are not affected.
 *
 * Atomic writes: same .tmp + rename pattern as V0.3.
 *
 * Honest limitations:
 * - The directory listing in loadAllWorkflows is read once; concurrent
 *   writes from a parallel orchestrator run can race. V0.4.1 is single
 *   reader at boot; V0.5+ may add a lockfile if this becomes an issue.
 * - Per-id file naming uses the workflowId verbatim (UUID-style). Path
 *   traversal sanitised by validating the id matches a strict regex
 *   before joining the path.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../../utils/logger.js';
import type { PersistedWorkflow } from './workflow-persistence.js';

/** Sanity guard for workflowId — alphanumeric + dash + underscore only.
 *  Prevents path traversal via crafted ids and keeps filenames predictable. */
const VALID_WORKFLOW_ID = /^[a-zA-Z0-9_-]+$/;

function resolveWorkflowsDir(): string {
  const override = process.env.CODEBUDDY_WORKFLOWS_DIR;
  if (override) return override;
  return path.join(os.homedir(), '.codebuddy', 'agents', 'workflows');
}

function resolveLegacyCurrentPath(): string {
  const override = process.env.CODEBUDDY_LEGACY_WORKFLOW_PATH;
  if (override) return override;
  return path.join(os.homedir(), '.codebuddy', 'agents', 'current.json');
}

function workflowFilePath(workflowId: string): string {
  if (!VALID_WORKFLOW_ID.test(workflowId)) {
    throw new Error(`Invalid workflowId for persistence: ${workflowId}`);
  }
  return path.join(resolveWorkflowsDir(), `${workflowId}.json`);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Save a single workflow's state under workflows/{id}.json (atomic).
 * Best-effort: never throws.
 */
export async function saveWorkflowById(
  workflowId: string,
  state: PersistedWorkflow,
): Promise<void> {
  try {
    const dir = resolveWorkflowsDir();
    await ensureDir(dir);
    const filePath = workflowFilePath(workflowId);
    const tmpPath = `${filePath}.tmp`;
    const enriched: PersistedWorkflow = {
      ...state,
      schemaVersion: state.schemaVersion ?? 'v0.3',
      completedTaskIds: state.completedTaskIds ?? state.results.map(([id]) => id),
    };
    const json = JSON.stringify(enriched, null, 2);
    await fs.writeFile(tmpPath, json, 'utf8');
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    logger.warn('[multi-agent] workflow-by-id save failed', {
      workflowId,
      error: String(err),
    });
  }
}

/**
 * Load a single workflow by id. Returns null if missing/corrupt.
 */
export async function loadWorkflowById(workflowId: string): Promise<PersistedWorkflow | null> {
  try {
    const filePath = workflowFilePath(workflowId);
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as PersistedWorkflow;
    if (!parsed.schemaVersion) parsed.schemaVersion = 'v0.1';
    if (!parsed.completedTaskIds) {
      parsed.completedTaskIds = parsed.results.map(([id]) => id);
    }
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    logger.warn('[multi-agent] workflow-by-id load failed (corrupt or unreadable)', {
      workflowId,
      error: String(err),
    });
    return null;
  }
}

/**
 * List all persisted workflows. Reads the per-id directory first; if
 * empty (V0.3 user with only legacy current.json), falls back to the
 * legacy path so /agents resume continues to work.
 *
 * Returned tuples are `[workflowId | null, state]`. `null` means the
 * legacy fallback (no id assigned).
 */
export async function listAllWorkflows(): Promise<Array<[string | null, PersistedWorkflow]>> {
  const dir = resolveWorkflowsDir();
  const out: Array<[string | null, PersistedWorkflow]> = [];

  let dirEntries: string[] = [];
  try {
    dirEntries = await fs.readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn('[multi-agent] workflows dir listing failed', { error: String(err) });
    }
    // Continue — legacy fallback below
  }

  for (const entry of dirEntries) {
    if (!entry.endsWith('.json')) continue;
    const id = entry.replace(/\.json$/, '');
    if (!VALID_WORKFLOW_ID.test(id)) continue;
    const state = await loadWorkflowById(id);
    if (state) out.push([id, state]);
  }

  // Legacy fallback: only if no per-id files were loaded. Avoids dual
  // listings when both exist (which shouldn't happen in practice — once
  // the orchestrator has written a per-id file, the legacy current.json
  // is left alone but should be considered superseded).
  if (out.length === 0) {
    try {
      const legacyPath = resolveLegacyCurrentPath();
      const raw = await fs.readFile(legacyPath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedWorkflow;
      if (!parsed.schemaVersion) parsed.schemaVersion = 'v0.1';
      if (!parsed.completedTaskIds) {
        parsed.completedTaskIds = parsed.results.map(([id]) => id);
      }
      out.push([null, parsed]);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        logger.warn('[multi-agent] legacy workflow load failed', { error: String(err) });
      }
    }
  }

  return out;
}

/**
 * Remove a single workflow's persisted file. No-op if missing.
 */
export async function clearWorkflowById(workflowId: string): Promise<void> {
  try {
    const filePath = workflowFilePath(workflowId);
    await fs.unlink(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn('[multi-agent] workflow-by-id clear failed', {
        workflowId,
        error: String(err),
      });
    }
  }
}

/** Test hooks. */
export function _workflowsDirForTests(): string {
  return resolveWorkflowsDir();
}
export function _legacyPathForTests(): string {
  return resolveLegacyCurrentPath();
}
