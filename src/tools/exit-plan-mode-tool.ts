/**
 * ExitPlanMode Tool — Core (V4.4)
 *
 * Lets the LLM signal that its plan-mode research is complete and request
 * user approval to leave plan mode and start executing. The tool does not
 * leave plan mode itself — it delegates rendering + approval prompt to a
 * registered UI provider (mirror of V4.3 ask_user_question pattern).
 *
 * On approval, the tool transitions out of plan mode (DEFAULT) and clears
 * the awaiting-approval flag. On rejection, plan mode stays active and the
 * model receives the rejection reason so it can refine the plan.
 *
 * Per ADR-01 (V4.3 refactor) and V4.4 mirror — see
 * `~/.claude/plans/lovely-brewing-bubble.md`.
 */

import type { ToolResult } from '../types/index.js';
import {
  clearAwaitingApproval,
  getApprovedPlanPath,
  isPlanMode,
  setAwaitingApproval,
} from '../agent/plan-mode.js';
import { getOperatingModeManager } from '../agent/operating-modes.js';

// ============================================================================
// Types
// ============================================================================

export interface ExitPlanModePromptHint {
  /** Tool name the model expects to call next (informational; not enforced) */
  tool: string;
  /** Short prompt/intent the model wants to run */
  prompt: string;
}

export interface ExitPlanModeInput {
  /**
   * Optional hints listing the tool calls the model intends to run after
   * approval. Purely informational — surfaced in the UI so the user knows
   * what they are signing off on.
   */
  allowedPrompts?: ExitPlanModePromptHint[];
  /**
   * Optional inline plan summary. Used as a fallback when no plan file
   * has been registered via `setApprovedPlanPath`. The UI provider is
   * free to ignore this if it has a richer source (e.g., a markdown file).
   */
  planSummary?: string;
}

export interface ExitPlanModeApprovalResult {
  /** True when the user approved the plan. */
  approved: boolean;
  /** Optional free-text reason supplied by the user (rejection rationale, edits) */
  reason?: string;
}

/**
 * UI provider contract. Implementations show the plan content + the
 * intended next steps and return the user's decision.
 */
export interface ExitPlanModeUIProvider {
  /**
   * Display the plan and prompt for approval.
   *
   * @param ctx - The plan context (file path if any, model-supplied input)
   * @returns User's approval decision
   */
  requestApproval(ctx: {
    planPath: string | null;
    input: ExitPlanModeInput;
  }): Promise<ExitPlanModeApprovalResult>;

  /** Whether this provider can serve a request right now (TTY, etc.) */
  isAvailable(): boolean;
}

// ============================================================================
// Validation
// ============================================================================

export const MAX_PROMPT_HINTS = 16;
export const MAX_HINT_LEN = 500;
export const MAX_SUMMARY_LEN = 8000;

export function validateInput(input: ExitPlanModeInput): string | null {
  if (input == null || typeof input !== 'object') {
    return 'input must be an object';
  }
  if (input.allowedPrompts !== undefined) {
    if (!Array.isArray(input.allowedPrompts)) {
      return 'allowedPrompts must be an array';
    }
    if (input.allowedPrompts.length > MAX_PROMPT_HINTS) {
      return `allowedPrompts must contain at most ${MAX_PROMPT_HINTS} items (got ${input.allowedPrompts.length})`;
    }
    for (let i = 0; i < input.allowedPrompts.length; i++) {
      const hint = input.allowedPrompts[i]!;
      if (!hint || typeof hint !== 'object') {
        return `allowedPrompts[${i}] must be an object`;
      }
      if (typeof hint.tool !== 'string' || hint.tool.trim() === '') {
        return `allowedPrompts[${i}].tool must be a non-empty string`;
      }
      if (typeof hint.prompt !== 'string' || hint.prompt.trim() === '') {
        return `allowedPrompts[${i}].prompt must be a non-empty string`;
      }
      if (hint.prompt.length > MAX_HINT_LEN) {
        return `allowedPrompts[${i}].prompt must be ≤${MAX_HINT_LEN} chars`;
      }
    }
  }
  if (input.planSummary !== undefined) {
    if (typeof input.planSummary !== 'string') {
      return 'planSummary must be a string';
    }
    if (input.planSummary.length > MAX_SUMMARY_LEN) {
      return `planSummary must be ≤${MAX_SUMMARY_LEN} chars`;
    }
  }
  return null;
}

// ============================================================================
// Provider injection
// ============================================================================

let _uiProvider: ExitPlanModeUIProvider | null = null;

/**
 * Register the UI provider. Called once at agent startup. Multiple
 * registrations replace the previous provider (last writer wins).
 */
export function setExitPlanModeUIProvider(provider: ExitPlanModeUIProvider): void {
  _uiProvider = provider;
}

/** Reset the provider (for testing). */
export function resetExitPlanModeUIProvider(): void {
  _uiProvider = null;
}

/** Get the currently registered provider (for advanced testing scenarios). */
export function getExitPlanModeUIProvider(): ExitPlanModeUIProvider | null {
  return _uiProvider;
}

// ============================================================================
// Tool implementation (delegates to provider)
// ============================================================================

export async function executeExitPlanMode(input: ExitPlanModeInput): Promise<ToolResult> {
  const validationError = validateInput(input ?? {});
  if (validationError) {
    return { success: false, error: validationError };
  }

  if (!isPlanMode()) {
    return {
      success: false,
      error:
        'exit_plan_mode called outside plan mode. The agent is already in execution mode — ' +
        'no exit needed. If you intended to enter plan mode first, use the `/plan` command.',
    };
  }

  if (!_uiProvider || !_uiProvider.isAvailable()) {
    return {
      success: false,
      error:
        'exit_plan_mode requires an interactive UI. No provider available ' +
        '(CI, --prompt one-shot, headless server, or provider not registered). ' +
        'Continue producing the plan markdown and ask the user to leave plan mode manually.',
    };
  }

  const planPath = getApprovedPlanPath();

  setAwaitingApproval(true);
  try {
    const decision = await _uiProvider.requestApproval({ planPath, input });
    if (decision.approved) {
      // V4.4 ADR option A: leave plan mode by toggling OperatingModeManager
      // back to the default operating mode (`balanced`). The legacy
      // `setAgentMode(AgentMode.DEFAULT)` would only mutate the
      // module-local `_currentMode` which no caller consults anymore.
      getOperatingModeManager().setMode('balanced', 'exit_plan_mode tool: plan approved');
      {
        const { getPermissionModeManager } = await import('../security/permission-modes.js');
        const permissionManager = getPermissionModeManager();
        if (permissionManager.getMode() === 'plan') {
          permissionManager.setMode('default');
        }
      }
      const reasonNote = decision.reason ? ` (note: ${decision.reason})` : '';
      return {
        success: true,
        output: `Plan approved. Exited plan mode → balanced.${reasonNote}`,
      };
    }
    const reasonNote = decision.reason ? `: ${decision.reason}` : '';
    return {
      success: false,
      error: `Plan rejected by user${reasonNote}. Stay in plan mode and refine the plan before requesting approval again.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `exit_plan_mode failed: ${msg}` };
  } finally {
    clearAwaitingApproval();
  }
}
