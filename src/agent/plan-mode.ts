/**
 * Plan Mode — Read-only Research & Planning Mode
 *
 * When active, restricts available tools to read-only operations
 * (Read, Search, Think, Plan). Write/Execute tools are blocked
 * or have their descriptions modified to only allow .md plan files.
 *
 * Inspired by Gemini CLI's plan mode.
 *
 * V4.4 ADR option A (2026-05-02) — bridged to OperatingModeManager.
 * Historically this module had its own `_currentMode` state that no caller
 * ever set to PLAN, so plan-mode features (`isPlanMode`, `filterToolsForMode`,
 * `getPlanModePrompt`, etc.) were inert. The actual user-visible mode toggle
 * (`/plan` slash command) lives in `OperatingModeManager.setMode('plan')`.
 *
 * Bridge: every "are we in plan mode?" check now consults
 * `getOperatingModeManager().getMode() === 'plan'`. The legacy `_currentMode`
 * state, `getAgentMode()`, and `setAgentMode()` are kept as a no-op
 * deprecated API so existing callers (and tests) compile, but they no
 * longer affect runtime behavior. ADR-03 (separate ticket) will fold
 * `AgentMode` enum into `OperatingMode`.
 */

import { logger } from '../utils/logger.js';
import { getOperatingModeManager } from './operating-modes.js';

/**
 * Single source of truth for "are we in plan mode?" — reads from
 * OperatingModeManager (the system actually toggled by `/plan`).
 * All public predicates below delegate here.
 */
function inPlanMode(): boolean {
  return getOperatingModeManager().getMode() === 'plan';
}

// ============================================================================
// Types
// ============================================================================

export enum AgentMode {
  DEFAULT = 'default',
  PLAN = 'plan',
  CODE = 'code',
  ASK = 'ask',
  ARCHITECT = 'architect',
}

/** Tool kinds for classification */
export enum ToolKind {
  Read = 'read',
  Edit = 'edit',
  Delete = 'delete',
  Search = 'search',
  Execute = 'execute',
  Think = 'think',
  Plan = 'plan',
  Communicate = 'communicate',
  Other = 'other',
}

/** Tools allowed in plan mode (by name) */
const PLAN_MODE_ALLOWED_TOOLS = new Set([
  // Read
  'read_file', 'view_file', 'file_read', 'list_files', 'get_file_info', 'tree',
  // Search
  'grep', 'glob', 'search_files', 'find_references', 'web_search', 'browser_search',
  // Think
  'reason', 'think',
  // Plan
  'plan', 'submit_plan', 'exit_plan_mode',
  // Communicate
  'ask_human',
  // Knowledge
  'knowledge_search', 'knowledge_list', 'codebase_map', 'code_graph',
  // Other read-only
  'todo_update', 'lessons_search', 'lessons_list', 'lessons_graph',
  'restore_context', 'memory_search',
]);

/** Tools that get modified descriptions in plan mode (limited to .md files) */
const PLAN_MODE_RESTRICTED_TOOLS = new Set([
  'create_file', 'str_replace_editor', 'file_write', 'write_file',
  'edit_file', 'multi_edit',
]);

// ============================================================================
// State
// ============================================================================

/**
 * Mode state. WARNING: These are module-level globals. In multi-session
 * server deployments, mode should be tracked per-session via SessionFacade.
 * These globals are safe for the single-user CLI but must be reset between sessions.
 */
let _currentMode: AgentMode = AgentMode.DEFAULT;
let _planPath: string | null = null;
let _awaitingApproval = false;

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the current agent mode.
 *
 * @deprecated V4.4 — use `getOperatingModeManager().getMode()` directly.
 * This still returns the legacy module-local `_currentMode` for compat,
 * but plan-mode predicates (`isPlanMode`, `filterToolsForMode`, etc.) no
 * longer consult it. Will be removed in ADR-03.
 */
export function getAgentMode(): AgentMode {
  return _currentMode;
}

/**
 * Set the agent mode.
 *
 * @deprecated V4.4 — use `getOperatingModeManager().setMode('plan' | …)`.
 * This still mutates legacy `_currentMode` for compat, but plan-mode
 * predicates no longer consult it. Will be removed in ADR-03.
 */
export function setAgentMode(mode: AgentMode): void {
  const previous = _currentMode;
  _currentMode = mode;
  if (previous !== mode) {
    logger.info(`Agent mode changed (legacy, no runtime effect): ${previous} → ${mode}`);
  }
}

/**
 * Check if we're in plan mode. Reads from `OperatingModeManager` (the
 * system actually toggled by `/plan`). V4.4 ADR option A.
 */
export function isPlanMode(): boolean {
  return inPlanMode();
}

/**
 * Set the approved plan path (after user approves a plan).
 */
export function setApprovedPlanPath(planPath: string): void {
  _planPath = planPath;
}

/**
 * Get the approved plan path.
 */
export function getApprovedPlanPath(): string | null {
  return _planPath;
}

/**
 * Mark plan mode as awaiting user approval (set by `exit_plan_mode` tool
 * while the approval prompt is on screen). Used by the UI / status bar
 * to surface a "waiting for approval" indicator.
 */
export function setAwaitingApproval(awaiting: boolean): void {
  _awaitingApproval = awaiting;
}

/** Check whether plan mode is currently awaiting user approval. */
export function isAwaitingApproval(): boolean {
  return _awaitingApproval;
}

/** Clear the awaiting-approval flag. */
export function clearAwaitingApproval(): void {
  _awaitingApproval = false;
}

/**
 * Check if a tool is allowed in the current mode.
 * In plan mode, only read/search/think/plan tools are allowed.
 */
export function isToolAllowedInCurrentMode(toolName: string): boolean {
  if (!inPlanMode()) return true;

  return PLAN_MODE_ALLOWED_TOOLS.has(toolName) ||
    PLAN_MODE_RESTRICTED_TOOLS.has(toolName);
}

/**
 * Get a modified tool description for plan mode.
 * Write tools get restricted to .md files in .codebuddy/plans/.
 * Returns null if no modification needed.
 */
export function getPlanModeToolDescription(
  toolName: string,
  originalDescription: string,
): string | null {
  if (!inPlanMode()) return null;
  if (!PLAN_MODE_RESTRICTED_TOOLS.has(toolName)) return null;

  return `PLAN MODE ONLY: ${originalDescription}. You are in Plan Mode and may ONLY use this tool to write or update plan files (.md) in the .codebuddy/plans/ directory. You cannot modify source code directly.`;
}

/**
 * Filter tool definitions for the current mode.
 * In plan mode, removes disallowed tools and modifies restricted tool descriptions.
 */
export function filterToolsForMode<T extends { function: { name: string; description?: string } }>(
  tools: T[],
): T[] {
  if (!inPlanMode()) return tools;

  return tools
    .filter(t => isToolAllowedInCurrentMode(t.function.name))
    .map(t => {
      const modified = getPlanModeToolDescription(
        t.function.name,
        t.function.description ?? '',
      );
      if (modified) {
        return {
          ...t,
          function: { ...t.function, description: modified },
        };
      }
      return t;
    });
}

/**
 * Get the plan mode system prompt injection.
 */
export function getPlanModePrompt(): string | null {
  if (!inPlanMode()) return null;

  return `<plan_mode>
You are in PLAN MODE (read-only research phase).

Rules:
- Use ONLY read, search, and think tools to analyze the codebase
- Do NOT modify any source code files
- You MAY create/edit .md plan files in .codebuddy/plans/
- Focus on understanding the problem, identifying affected files, and designing a solution
- When your research is complete, present a plan to the user

Available operations: read files, search code, analyze dependencies, reason about architecture.
Blocked operations: edit code, run commands, create source files.
</plan_mode>`;
}

/**
 * Reset plan mode state. Must be called between sessions in multi-session
 * server deployments to prevent state leakage.
 */
export function resetPlanMode(): void {
  _currentMode = AgentMode.DEFAULT;
  _planPath = null;
  _awaitingApproval = false;
}
