/**
 * MultiAgentSystem workflow persistence (Phase G of multi-agent integration).
 *
 * Persists the active /agents workflow state to disk so it survives
 * process restarts (Ctrl+C, crash, Windows update). On the next boot,
 * the agents-handler can detect an interrupted workflow and offer
 * /agents resume.
 *
 * Storage:
 *   ~/.codebuddy/agents/current.json   — singleton (1 workflow at a time, V0.1)
 *
 * Atomic writes:
 *   write to current.json.tmp + rename to current.json (POSIX atomic;
 *   Windows fs.promises.rename is also atomic for same-volume swaps).
 *
 * Schema:
 *   - WorkflowResult.results is a Map → persisted as Array<[string, AgentExecutionResult]>
 *     and rehydrated on load.
 *   - Connection handles (LLM clients) are NOT persisted; the resume path
 *     reconstructs fresh agents.
 *
 * Mid-tool death:
 *   No magic rollback. The persisted state reflects the last
 *   workflow:event captured. Tools that ran mid-event may have left
 *   partial artifacts on disk that aren't tracked here.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../../utils/logger.js';
import { readJsonAtomic, writeJsonAtomic } from '../../utils/atomic-write.js';
import type {
  ExecutionPlan,
  AgentExecutionResult,
  TaskArtifact,
  WorkflowEvent,
  CollaborationStrategy,
} from './types.js';

export type WorkflowStatus = 'running' | 'completed' | 'failed' | 'interrupted';

/** Phase J — schema version for backward-compat resume.
 *  v0.1 = pre-Phase-J workflows; resume = restart from scratch.
 *  v0.3 = explicit completedTaskIds for true per-task skip on resume. */
export type WorkflowSchemaVersion = 'v0.1' | 'v0.3';

export interface PersistedWorkflow {
  goal: string;
  /** ISO timestamp string */
  startedAt: string;
  strategy: CollaborationStrategy;
  status: WorkflowStatus;
  plan: ExecutionPlan | null;
  /** Map → entries array for JSON-safety. Rehydrate via new Map(results) on load. */
  results: Array<[string, AgentExecutionResult]>;
  artifacts: TaskArtifact[];
  timeline: WorkflowEvent[];
  errors: string[];
  /** ISO timestamp string, present if status !== 'running' */
  finishedAt?: string;
  summary?: string;
  /** Phase J — schema version. Absent in v0.2 saves; loadWorkflow auto-migrates. */
  schemaVersion?: WorkflowSchemaVersion;
  /** Phase J — explicit list of completed task IDs (derived from results in v0.1 migration). */
  completedTaskIds?: string[];
}

const PERSIST_DIR = path.join(os.homedir(), '.codebuddy', 'agents');
const CURRENT_PATH = path.join(PERSIST_DIR, 'current.json');

async function ensureDir(): Promise<void> {
  await fs.mkdir(PERSIST_DIR, { recursive: true });
}

/**
 * Save workflow state atomically. Write to .tmp then rename — no readers
 * ever see a partial file.
 */
export async function saveWorkflow(state: PersistedWorkflow): Promise<void> {
  try {
    await ensureDir();
    // Phase J — auto-stamp schemaVersion v0.3 + derive completedTaskIds
    // from results if caller didn't provide one explicitly.
    const enriched: PersistedWorkflow = {
      ...state,
      schemaVersion: state.schemaVersion ?? 'v0.3',
      completedTaskIds: state.completedTaskIds ?? state.results.map(([id]) => id),
    };
    await writeJsonAtomic(CURRENT_PATH, enriched, { mode: 0o600 });
  } catch (err) {
    // Persistence is best-effort — never fail the workflow over a write error.
    logger.warn('Workflow persistence save failed', { error: String(err) });
  }
}

/**
 * Load the persisted workflow if any. Returns null when:
 * - File does not exist
 * - File is unreadable
 * - JSON is corrupt (logged + swallowed)
 *
 * Caller decides what to do with the result (e.g. set "interrupted" UI).
 */
export async function loadWorkflow(): Promise<PersistedWorkflow | null> {
  try {
    const parsed = await readJsonAtomic<PersistedWorkflow | null>(CURRENT_PATH, null, {
      mode: 0o600,
      isValid: (value): value is PersistedWorkflow => Boolean(
        value && typeof value === 'object' && !Array.isArray(value) &&
        Array.isArray((value as PersistedWorkflow).results),
      ),
    });
    if (!parsed) return null;
    // Phase J — auto-migrate pre-v0.3 saves. Workflows persisted by
    // V0.2 (Phase G) lacked `schemaVersion` — treat as v0.1 and derive
    // completedTaskIds from results so /agents resume can still skip them.
    if (!parsed.schemaVersion) {
      parsed.schemaVersion = 'v0.1';
    }
    if (!parsed.completedTaskIds) {
      parsed.completedTaskIds = parsed.results.map(([id]) => id);
    }
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    logger.warn('Workflow persistence load failed (corrupt or unreadable)', { error: String(err) });
    return null;
  }
}

/**
 * Remove the persisted state. Called when a workflow completes
 * cleanly + when the user explicitly disposes via /agents disable.
 * No-op if the file doesn't exist.
 */
export async function clearWorkflow(): Promise<void> {
  try {
    await fs.unlink(CURRENT_PATH);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn('Workflow persistence clear failed', { error: String(err) });
    }
  }
}

/** Test hook — exposes the storage path so tests can override or assert. */
export function _persistencePathForTests(): string {
  return CURRENT_PATH;
}
