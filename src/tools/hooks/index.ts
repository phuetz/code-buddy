/**
 * Tool Hooks Module
 *
 * OpenClaw-inspired tool lifecycle management:
 * - Tool lifecycle hooks (before/after/persist)
 * - Result sanitization
 * - Session lanes for serialized execution
 */

// Tool Hooks
export type {
  ToolHookStage,
  ToolHookContext,
  ToolHookResult,
  BeforeToolHook,
  AfterToolHook,
  PersistHook,
  ErrorHook,
  RegisteredHook,
  ToolHooksConfig,
  HookMetrics,
  ToolHooksEvents,
} from './tool-hooks.js';

export {
  DEFAULT_TOOL_HOOKS_CONFIG,
  ToolHooksManager,
  getToolHooksManager,
  resetToolHooksManager,
} from './tool-hooks.js';

// Result Sanitization
export type {
  LLMProvider,
  ProviderPolicy,
  ToolResultInput,
  SanitizedToolResult,
  SanitizationConfig,
  ToolUse,
  ToolResultPair,
  PairingValidationResult,
} from './result-sanitizer.js';

export {
  PROVIDER_POLICIES,
  ResultSanitizer,
  sanitizeToolUseResultPairing,
  createSanitizer,
  sanitizeResult,
} from './result-sanitizer.js';

// Session Lanes
export type {
  LaneTask,
  LaneStatus,
  LaneInfo,
  SessionLanesConfig,
  LaneExecutionResult,
  SessionLanesEvents,
} from './session-lanes.js';

export {
  DEFAULT_SESSION_LANES_CONFIG,
  SessionLanesManager,
  getSessionLanesManager,
  resetSessionLanesManager,
} from './session-lanes.js';
