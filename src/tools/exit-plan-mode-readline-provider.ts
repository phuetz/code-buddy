import { resolveToolPath } from '../utils/tool-execution-context.js';
/**
 * ExitPlanMode Readline Provider — default CLI implementation
 *
 * Renders the plan content (loaded from `getApprovedPlanPath()` if set,
 * else falls back to the model-supplied `planSummary`) and the intended
 * next steps, then prompts the user for approval via `readline`.
 *
 * Drop-in replacement target for richer providers (Ink, web, robot voice)
 * when Code Buddy embeds in a different runtime.
 *
 * Per V4.4 — see `~/.claude/plans/lovely-brewing-bubble.md`.
 */

import * as fs from 'fs';
import * as readline from 'readline';
import type {
  ExitPlanModeApprovalResult,
  ExitPlanModeInput,
  ExitPlanModeUIProvider,
} from './exit-plan-mode-tool.js';

const TIMEOUT_SECONDS = 600;
const MAX_PLAN_RENDER_BYTES = 32 * 1024;

// ============================================================================
// Rendering
// ============================================================================

function readPlanFile(planPath: string): { content: string; truncated: boolean } | null {
  try {
    const stat = fs.statSync(resolveToolPath(planPath));
    if (!stat.isFile()) return null;
    const truncated = stat.size > MAX_PLAN_RENDER_BYTES;
    const buf = fs.readFileSync(resolveToolPath(planPath), { encoding: 'utf-8' });
    if (truncated) {
      return { content: buf.slice(0, MAX_PLAN_RENDER_BYTES), truncated: true };
    }
    return { content: buf, truncated: false };
  } catch {
    return null;
  }
}

function renderApprovalPrompt(
  planPath: string | null,
  input: ExitPlanModeInput,
): string {
  let out = '\n📋 Plan ready — approval requested before leaving plan mode\n\n';

  if (planPath) {
    out += `Plan file: ${planPath}\n`;
    const file = readPlanFile(planPath);
    if (file) {
      out += '─── plan content ───\n';
      out += file.content;
      if (!file.content.endsWith('\n')) out += '\n';
      if (file.truncated) {
        out += `… (truncated at ${MAX_PLAN_RENDER_BYTES} bytes — full file at ${planPath})\n`;
      }
      out += '────────────────────\n';
    } else {
      out += '(plan file unreadable — see model summary below)\n';
    }
  }

  if (!planPath && input.planSummary) {
    out += '─── plan summary (no file registered) ───\n';
    out += input.planSummary;
    if (!input.planSummary.endsWith('\n')) out += '\n';
    out += '────────────────────────────────────────\n';
  }

  if (input.allowedPrompts && input.allowedPrompts.length > 0) {
    out += '\nNext steps the agent intends to run:\n';
    input.allowedPrompts.forEach((hint, i) => {
      out += `  ${i + 1}. [${hint.tool}] ${hint.prompt}\n`;
    });
  }

  out += '\nApprove and exit plan mode?\n';
  out += '  y / yes — approve, switch to DEFAULT mode, agent starts executing\n';
  out += '  n / no  — reject, stay in plan mode (you may add a reason after)\n';
  out += '> ';
  return out;
}

// ============================================================================
// Answer parsing
// ============================================================================

function parseDecision(raw: string): 'approve' | 'reject' | 'unknown' {
  const v = raw.trim().toLowerCase();
  if (v === 'y' || v === 'yes' || v === 'approve' || v === 'a') return 'approve';
  if (v === 'n' || v === 'no' || v === 'reject' || v === 'r') return 'reject';
  return 'unknown';
}

// ============================================================================
// Provider
// ============================================================================

export class ExitPlanModeReadlineProvider implements ExitPlanModeUIProvider {
  /** TTY availability checked at call-time so the same instance survives toggles. */
  isAvailable(): boolean {
    return Boolean(process.stdin.isTTY);
  }

  async requestApproval(ctx: {
    planPath: string | null;
    input: ExitPlanModeInput;
  }): Promise<ExitPlanModeApprovalResult> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      rl.close();
    }, TIMEOUT_SECONDS * 1000);

    try {
      const prompt = renderApprovalPrompt(ctx.planPath, ctx.input);

      // Loop until we get y/n or 3 unknowns (then default to reject).
      let attempts = 0;
      let decision: 'approve' | 'reject' | 'unknown' = 'unknown';
      while (attempts < 3 && !timedOut) {
        const raw = await new Promise<string>((resolve) => {
          rl.question(attempts === 0 ? prompt : 'Please answer y or n: ', resolve);
        });
        if (timedOut) break;
        decision = parseDecision(raw);
        if (decision !== 'unknown') break;
        attempts++;
      }
      if (timedOut) {
        throw new Error(`timed out after ${TIMEOUT_SECONDS}s`);
      }
      if (decision === 'unknown') {
        return { approved: false, reason: 'no clear approval after 3 attempts' };
      }

      // Optional follow-up reason.
      const reasonPrompt =
        decision === 'approve'
          ? 'Optional note for the agent (press Enter to skip): '
          : 'Reason for rejection (press Enter to skip): ';
      const reason = await new Promise<string>((resolve) => {
        rl.question(reasonPrompt, (s) => resolve(s.trim()));
      });

      return {
        approved: decision === 'approve',
        ...(reason ? { reason } : {}),
      };
    } finally {
      clearTimeout(timer);
      rl.close();
    }
  }
}

let _instance: ExitPlanModeReadlineProvider | null = null;

export function getExitPlanModeReadlineProvider(): ExitPlanModeReadlineProvider {
  if (!_instance) _instance = new ExitPlanModeReadlineProvider();
  return _instance;
}

export function resetExitPlanModeReadlineProvider(): void {
  _instance = null;
}
