/**
 * Bash Allowlist System
 *
 * Pattern-based command approval for bash tool. Allows users to
 * create persistent patterns for auto-approving or auto-denying
 * common commands.
 *
 * @example
 * ```typescript
 * import { getApprovalFlowManager } from './security/bash-allowlist';
 *
 * const flow = getApprovalFlowManager();
 * await flow.initialize();
 *
 * // Check and prompt if needed
 * const result = await flow.checkAndApprove('npm install lodash');
 * if (result.approved) {
 *   // Execute command
 * }
 *
 * // Quick check without prompting
 * const check = flow.quickCheck('git status');
 * if (check.decision === 'allow') {
 *   // Safe to execute
 * }
 *
 * // Add a pattern
 * flow.addPattern('npm run *', 'glob', 'allow', {
 *   description: 'Allow all npm scripts',
 * });
 * ```
 */

// Types
export type {
  PatternType,
  ApprovalDecision,
  ApprovalPattern,
  PatternSource,
  AllowlistCheckResult,
  ApprovalPromptOptions,
  ApprovalPromptResult,
  AllowlistConfig,
  AllowlistEvents,
} from './types.js';

export {
  DEFAULT_ALLOWLIST_CONFIG,
  DEFAULT_SAFE_PATTERNS,
  DEFAULT_DENY_PATTERNS,
} from './types.js';

// Pattern Matcher
export {
  matchPattern,
  matchApprovalPattern,
  findBestMatch,
  validatePattern,
  suggestPattern,
  extractBaseCommand,
  isPatternDangerous,
} from './pattern-matcher.js';

// Store
export {
  AllowlistStore,
  getAllowlistStore,
  resetAllowlistStore,
} from './allowlist-store.js';

// Approval Flow (main API)
export {
  ApprovalFlowManager,
  getApprovalFlowManager,
  resetApprovalFlowManager,
} from './approval-flow.js';
