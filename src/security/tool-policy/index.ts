/**
 * Tool Policy System
 *
 * Hierarchical tool grouping and policy management for fine-grained
 * access control in Code Buddy.
 *
 * @example
 * ```typescript
 * import { getPolicyManager, isToolAllowed } from './security/tool-policy';
 *
 * // Quick check
 * if (isToolAllowed('bash', { command: 'npm install' })) {
 *   // Execute
 * }
 *
 * // Full API
 * const manager = getPolicyManager();
 * manager.setProfile('coding');
 * const decision = manager.checkTool('bash', { command: 'rm -rf /' });
 * if (decision.action === 'deny') {
 *   console.log(decision.reason);
 * }
 * ```
 */

// Types
export type {
  ToolGroup,
  PolicyProfile,
  PolicyAction,
  PolicyRule,
  PolicyCondition,
  ProfileDefinition,
  PolicyDecision,
  PolicyContext,
  PolicySource,
  PolicyConfig,
  PolicyEvents,
} from './types.js';

export {
  ALL_TOOL_GROUPS,
  DEFAULT_POLICY_CONFIG,
  getParentGroup,
  isChildGroup,
} from './types.js';

// Tool Groups
export {
  TOOL_GROUPS,
  getToolGroups,
  getToolsInGroup,
  isToolInGroup,
  registerToolGroups,
  unregisterToolGroups,
  getAllRegisteredTools,
  getGroupStats,
} from './tool-groups.js';

// Profiles
export {
  PROFILES,
  getProfile,
  getProfileNames,
  getProfileRules,
  formatProfile,
  getProfileComparison,
} from './profiles.js';

// Resolver
export {
  PolicyResolver,
  resolveMultiple,
  filterByPolicy,
  getAllowedTools,
} from './policy-resolver.js';

// Manager (main API)
export {
  PolicyManager,
  getPolicyManager,
  resetPolicyManager,
  isToolAllowed,
  toolRequiresConfirmation,
  isToolDenied,
} from './policy-manager.js';
