/**
 * WritePolicy — enforces diff-first writes at the tool-handler level.
 *
 * Modes:
 *   strict  — blocks any direct file write; the caller must use applyPatch()
 *   confirm — allows writes but records a decision event in RunStore (existing confirmation UX)
 *   off     — no restriction (current default behaviour)
 *
 * The singleton is injectable for tests via WritePolicy.setInstance().
 */

import { logger } from '../utils/logger.js';

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

export type WritePolicyMode = 'strict' | 'confirm' | 'off';

export interface WriteOperation {
  /** Tool name triggering the write */
  toolName: string;
  /** File path(s) being written */
  paths: string[];
  /** Patch content if already prepared */
  patch?: string;
  /** Short description for decision log */
  description?: string;
}

export interface GateResult {
  allowed: boolean;
  /** True if the caller must route through applyPatch() */
  requiresPatch: boolean;
  reason?: string;
}

// ──────────────────────────────────────────────────────────────────
// Tool names that trigger write-policy gating
// ──────────────────────────────────────────────────────────────────

export const WRITE_TOOL_NAMES = new Set([
  'str_replace_editor',
  'create_file',
  'multi_edit',
  'apply_patch',
  'edit_file',     // Morph Fast Apply
  'write_file',
]);

// ──────────────────────────────────────────────────────────────────
// WritePolicy
// ──────────────────────────────────────────────────────────────────

export class WritePolicy {
  private static _instance: WritePolicy | null = null;

  private mode: WritePolicyMode = 'confirm';
  private listeners: Array<(op: WriteOperation, result: GateResult) => void> = [];

  // ── Singleton ────────────────────────────────────────────────

  static getInstance(): WritePolicy {
    if (!WritePolicy._instance) {
      WritePolicy._instance = new WritePolicy();
    }
    return WritePolicy._instance;
  }

  /** Replace the singleton (for testing). */
  static setInstance(instance: WritePolicy): void {
    WritePolicy._instance = instance;
  }

  static resetInstance(): void {
    WritePolicy._instance = null;
  }

  // ── Configuration ─────────────────────────────────────────────

  setMode(mode: WritePolicyMode): void {
    this.mode = mode;
    logger.debug(`WritePolicy: mode set to ${mode}`);
  }

  getMode(): WritePolicyMode {
    return this.mode;
  }

  // ── Gating ────────────────────────────────────────────────────

  /**
   * Check whether the operation is allowed under the current policy.
   *
   * Called by tool-handler before executing str_replace_editor / create_file / multi_edit.
   *
   * @param operation - The write operation being attempted
   * @param runId - Active run ID for decision logging (optional)
   */
  async gate(operation: WriteOperation, _runId?: string): Promise<GateResult> {
    const { toolName } = operation;

    // apply_patch is always allowed — it IS the diff-first path
    if (toolName === 'apply_patch') {
      return { allowed: true, requiresPatch: false };
    }

    switch (this.mode) {
      case 'off':
        return { allowed: true, requiresPatch: false };

      case 'confirm': {
        // In confirm mode, direct writes are allowed but we log the decision
        const result: GateResult = { allowed: true, requiresPatch: false };
        this.notifyListeners(operation, result);
        return result;
      }

      case 'strict': {
        // In strict mode, block direct writes if no patch is provided
        if (operation.patch) {
          // Caller has already produced a patch — allow it
          return { allowed: true, requiresPatch: false };
        }

        const result: GateResult = {
          allowed: false,
          requiresPatch: true,
          reason: `WritePolicy (strict): tool "${toolName}" attempted a direct file write. Use apply_patch with a unified diff instead.`,
        };
        this.notifyListeners(operation, result);
        logger.info(`WritePolicy blocked: ${toolName}`, { paths: operation.paths });
        return result;
      }
    }
  }

  /**
   * Returns true if the tool name is subject to write-policy gating.
   */
  isWriteTool(toolName: string): boolean {
    return WRITE_TOOL_NAMES.has(toolName);
  }

  // ── Observability ─────────────────────────────────────────────

  /**
   * Subscribe to gate decisions (for RunStore integration).
   */
  onGate(listener: (op: WriteOperation, result: GateResult) => void): void {
    this.listeners.push(listener);
  }

  private notifyListeners(op: WriteOperation, result: GateResult): void {
    for (const l of this.listeners) {
      try {
        l(op, result);
      } catch {
        // Ignore listener errors
      }
    }
  }
}
