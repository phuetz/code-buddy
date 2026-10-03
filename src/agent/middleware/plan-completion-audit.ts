/**
 * Plan Completion Audit Middleware
 *
 * Manus-inspired pattern: treat `todo.md`/`PLAN.md` as a *verification ledger*,
 * not just a plan. Before the agent concludes a task, its checklist should be
 * AUDITED — every item either verified done (with evidence) or explicitly marked
 * skipped with a reason — rather than declaring "done" on the faith of memory.
 *
 * This middleware reads the persistent `PLAN.md` (the source of truth the
 * `PlanTool` writes) and, when a plan is ACTIVE with OPEN items
 * (pending `[ ]` / in_progress `[/]`), nudges the model ONCE per task to close
 * the loop before finishing. Closed markers — completed `[x]` and failed/skipped
 * `[-]` — are not "open", so a fully-resolved plan produces zero noise.
 *
 * Priority 157 — sits just after verification-enforcement (155) and
 * visual-validation (156): a plan audit is a natural "before you finish" nudge,
 * so it belongs with the other end-of-task gates, ahead of quality-gate (200).
 *
 * Zero-noise guarantee: with NO active plan (no `PLAN.md`, or one with no open
 * items) the middleware returns `continue` silently — the common case for tasks
 * that never opened a plan is completely unaffected. The file is only read while
 * the per-task latch is unset, so once nudged (or once disabled) there is no I/O.
 */

import fs from 'fs-extra';
import * as path from 'path';
import type {
  ConversationMiddleware,
  MiddlewareContext,
  MiddlewareResult,
} from './types.js';
import { logger } from '../../utils/logger.js';

// ── Configuration ──────────────────────────────────────────────────

export interface PlanCompletionAuditConfig {
  /** Enable/disable the plan-completion audit nudge (default: true) */
  enabled: boolean;
  /**
   * Absolute path to the plan file to audit.
   * Defaults to `<cwd>/PLAN.md`, matching `PlanTool`'s default location.
   */
  planPath: string;
  /** Maximum number of open-item titles to quote in the nudge (default: 5) */
  maxItemsInMessage: number;
}

export function defaultPlanCompletionAuditConfig(): PlanCompletionAuditConfig {
  return {
    enabled: true,
    planPath: path.join(process.cwd(), 'PLAN.md'),
    maxItemsInMessage: 5,
  };
}

/** A parsed checklist item from the plan. */
export interface PlanItem {
  /** The raw marker character between the brackets (' ', '/', 'x', '-', …) */
  marker: string;
  /** The item text (everything after the checkbox) */
  text: string;
  /** Normalized status */
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'unknown';
  /** Whether this item is still OPEN (pending or in_progress) */
  open: boolean;
}

/**
 * Parse the markdown checklist items from a PLAN.md body.
 *
 * Mirrors `PlanTool`'s markers: `[ ]` pending, `[/]` in_progress, `[x]`/`[X]`
 * completed, `[-]` failed/skipped. Anything else is treated as `unknown` and,
 * conservatively, NOT open (so a non-standard marker never triggers a false
 * "unfinished" nudge).
 */
export function parsePlanItems(content: string): PlanItem[] {
  const items: PlanItem[] = [];
  const lineRe = /^\s*[-*]\s*\[(.)\]\s*(.*)$/;

  for (const rawLine of content.split('\n')) {
    const match = lineRe.exec(rawLine);
    if (!match) continue;

    const marker = match[1] ?? '';
    const text = (match[2] ?? '').trim();

    let status: PlanItem['status'];
    let open: boolean;
    switch (marker) {
      case ' ':
        status = 'pending';
        open = true;
        break;
      case '/':
        status = 'in_progress';
        open = true;
        break;
      case 'x':
      case 'X':
        status = 'completed';
        open = false;
        break;
      case '-':
        status = 'failed';
        open = false;
        break;
      default:
        status = 'unknown';
        open = false;
        break;
    }

    items.push({ marker, text, status, open });
  }

  return items;
}

// ── Middleware ──────────────────────────────────────────────────────

export class PlanCompletionAuditMiddleware implements ConversationMiddleware {
  readonly name = 'plan-completion-audit';
  readonly priority = 157;

  private config: PlanCompletionAuditConfig;
  private hasWarned = false;

  constructor(config: Partial<PlanCompletionAuditConfig> = {}) {
    this.config = { ...defaultPlanCompletionAuditConfig(), ...config };
  }

  async afterTurn(_context: MiddlewareContext): Promise<MiddlewareResult> {
    // Cheap short-circuits BEFORE any disk I/O: disabled or already nudged.
    if (!this.config.enabled || this.hasWarned) {
      return { action: 'continue' };
    }

    const openItems = await this.readOpenItems();

    // No active plan, or a plan with everything resolved → strictly silent.
    if (openItems.length === 0) {
      return { action: 'continue' };
    }

    this.hasWarned = true;

    const titles = openItems
      .slice(0, this.config.maxItemsInMessage)
      .map(item => `"${item.text}"`);
    const remaining = openItems.length - titles.length;
    const quoted = remaining > 0
      ? `${titles.join(', ')}, and ${remaining} more`
      : titles.join(', ');

    logger.info('Plan completion audit triggered', {
      openItems: openItems.length,
    });

    return {
      action: 'warn',
      message:
        `The plan has ${openItems.length} unfinished item(s): ${quoted}. ` +
        `Before concluding this task: verify each one (show the evidence) or ` +
        `explicitly mark it skipped with a reason via ` +
        `\`plan(action="update", status="failed")\` — don't declare the task ` +
        `done from memory. Task completion is a plan audit, not an "I'm done".`,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────

  /** Read the plan file and return only the OPEN (pending/in_progress) items. Never throws. */
  private async readOpenItems(): Promise<PlanItem[]> {
    try {
      let planPath = this.config.planPath;
      if (!(await fs.pathExists(planPath))) {
        // The workflow guard suggests the self-ignored .codebuddy/PLAN.md.
        planPath = path.join(path.dirname(planPath), '.codebuddy', path.basename(planPath));
        if (!(await fs.pathExists(planPath))) return [];
      }
      const content = await fs.readFile(planPath, 'utf-8');
      return parsePlanItems(content).filter(item => item.open);
    } catch (err) {
      // A plan we can't read is not a plan we should nag about — fail silent.
      logger.debug('Plan completion audit could not read plan file', {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Reset the per-task warning latch (called at the start of every new task). */
  reset(): void {
    this.hasWarned = false;
  }

  /** Whether the nudge has already been issued this task. */
  hasWarnedAlready(): boolean {
    return this.hasWarned;
  }

  /** Get a copy of the active configuration. */
  getConfig(): PlanCompletionAuditConfig {
    return { ...this.config };
  }
}

/**
 * Factory for the plan-completion audit middleware.
 */
export function createPlanCompletionAuditMiddleware(
  config?: Partial<PlanCompletionAuditConfig>,
): PlanCompletionAuditMiddleware {
  return new PlanCompletionAuditMiddleware(config);
}
