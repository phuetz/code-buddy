/**
 * Tool Policy System Types
 *
 * Hierarchical tool grouping and policy management for fine-grained
 * access control. Inspired by OpenClaw's permission model.
 *
 * Key concepts:
 * - ToolGroup: Hierarchical grouping (e.g., 'group:fs:write' is a subset of 'group:fs')
 * - PolicyProfile: Predefined permission sets (minimal, coding, messaging, full)
 * - PolicyDecision: The resolved action for a tool (allow, deny, confirm)
 */

// ============================================================================
// Tool Groups
// ============================================================================

/**
 * Hierarchical tool groups for categorization.
 * Uses colon-separated hierarchy (e.g., 'group:fs:write' inherits from 'group:fs')
 */
export type ToolGroup =
  // File system groups
  | 'group:fs'              // All filesystem operations
  | 'group:fs:read'         // Read-only filesystem (view_file, search, glob)
  | 'group:fs:write'        // Write operations (create_file, str_replace_editor)
  | 'group:fs:delete'       // Delete operations
  // Runtime groups
  | 'group:runtime'         // All runtime/execution
  | 'group:runtime:shell'   // Shell command execution
  | 'group:runtime:process' // Process management
  // Network groups
  | 'group:web'             // All web/network operations
  | 'group:web:fetch'       // HTTP requests
  | 'group:web:search'      // Web search
  // Version control
  | 'group:git'             // Git operations
  | 'group:git:read'        // Read-only git (status, log, diff)
  | 'group:git:write'       // Write git (commit, push, merge)
  // Container/orchestration
  | 'group:docker'          // Docker operations
  | 'group:kubernetes'      // Kubernetes operations
  // System
  | 'group:system'          // System-level operations
  | 'group:system:info'     // System information gathering
  | 'group:system:modify'   // System modifications
  // Special
  | 'group:dangerous'       // Potentially destructive operations
  | 'group:mcp'             // MCP server tools
  | 'group:plugin';         // Plugin marketplace tools

/**
 * All tool groups for iteration
 */
export const ALL_TOOL_GROUPS: ToolGroup[] = [
  'group:fs',
  'group:fs:read',
  'group:fs:write',
  'group:fs:delete',
  'group:runtime',
  'group:runtime:shell',
  'group:runtime:process',
  'group:web',
  'group:web:fetch',
  'group:web:search',
  'group:git',
  'group:git:read',
  'group:git:write',
  'group:docker',
  'group:kubernetes',
  'group:system',
  'group:system:info',
  'group:system:modify',
  'group:dangerous',
  'group:mcp',
  'group:plugin',
];

/**
 * Get parent group from hierarchical group name
 */
export function getParentGroup(group: ToolGroup): ToolGroup | null {
  const parts = group.split(':');
  if (parts.length <= 2) return null;
  parts.pop();
  return parts.join(':') as ToolGroup;
}

/**
 * Check if group is a child of potential parent
 */
export function isChildGroup(child: ToolGroup, parent: ToolGroup): boolean {
  if (child === parent) return true;
  return child.startsWith(parent + ':');
}

// ============================================================================
// Policy Profiles
// ============================================================================

/**
 * Predefined policy profiles with different permission levels
 */
export type PolicyProfile =
  | 'minimal'    // Most restrictive - read-only, no execution
  | 'coding'     // Standard development - fs read/write, safe shell
  | 'messaging'  // Communication focus - web access, limited fs
  | 'full';      // Full access - all tools (with confirmation for dangerous)

/**
 * Policy action for a tool or group
 */
export type PolicyAction = 'allow' | 'deny' | 'confirm';

/**
 * Policy rule for a tool group
 */
export interface PolicyRule {
  /** Tool group this rule applies to */
  group: ToolGroup;
  /** Action to take */
  action: PolicyAction;
  /** Optional conditions for the rule */
  conditions?: PolicyCondition[];
  /** Priority (higher wins on conflict) */
  priority?: number;
  /** Reason for this policy */
  reason?: string;
}

/**
 * Condition for conditional policy rules
 */
export interface PolicyCondition {
  /** Type of condition */
  type: 'path' | 'command' | 'pattern' | 'time' | 'custom';
  /** Condition value (path glob, regex pattern, etc.) */
  value: string;
  /** Whether to negate the condition */
  negate?: boolean;
}

/**
 * Complete profile definition
 */
export interface ProfileDefinition {
  /** Profile identifier */
  name: PolicyProfile;
  /** Human-readable description */
  description: string;
  /** Rules for this profile */
  rules: PolicyRule[];
  /** Inherit from another profile */
  inherits?: PolicyProfile;
  /** Whether profile can be customized */
  customizable: boolean;
}

// ============================================================================
// Policy Decision
// ============================================================================

/**
 * Decision source for traceability
 */
export type PolicySource =
  | 'profile'        // From profile rules
  | 'global'         // From global config
  | 'agent'          // From agent-specific config
  | 'provider'       // From provider config (MCP, plugin)
  | 'session'        // From session override
  | 'override'       // From explicit override
  | 'default';       // Default fallback

/**
 * Result of resolving a policy for a tool
 */
export interface PolicyDecision {
  /** Action to take */
  action: PolicyAction;
  /** Human-readable reason */
  reason: string;
  /** Source of this decision */
  source: PolicySource;
  /** The rule that produced this decision (if any) */
  rule?: PolicyRule;
  /** Confidence (0-1) for logged decisions */
  confidence?: number;
  /** Timestamp of decision */
  timestamp: Date;
}

/**
 * Context for policy resolution
 */
export interface PolicyContext {
  /** Tool being checked */
  toolName: string;
  /** Tool groups the tool belongs to */
  groups: ToolGroup[];
  /** Current agent/mode (if any) */
  agentId?: string;
  /** Provider (for MCP/plugin tools) */
  provider?: string;
  /** Tool arguments (for conditional rules) */
  args?: Record<string, unknown>;
  /** Session-level overrides */
  sessionOverrides?: Map<string, PolicyAction>;
  /** Global overrides */
  globalOverrides?: Map<string, PolicyAction>;
}

// ============================================================================
// Policy Configuration
// ============================================================================

/**
 * Tool policy configuration (persisted)
 */
export interface PolicyConfig {
  /** Schema version for migrations */
  version: number;
  /** Active profile */
  activeProfile: PolicyProfile;
  /** Global rule overrides */
  globalRules: PolicyRule[];
  /** Per-agent rule overrides */
  agentRules: Record<string, PolicyRule[]>;
  /** Provider-specific rules */
  providerRules: Record<string, PolicyRule[]>;
  /** Whether to log all policy decisions */
  auditLog: boolean;
  /** Default action for unknown tools */
  defaultAction: PolicyAction;
}

/**
 * Default policy configuration
 */
export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  version: 1,
  activeProfile: 'coding',
  globalRules: [],
  agentRules: {},
  providerRules: {},
  auditLog: false,
  defaultAction: 'confirm',
};

// ============================================================================
// Events
// ============================================================================

/**
 * Policy manager events
 */
export interface PolicyEvents {
  'policy:decision': PolicyDecision & { context: PolicyContext };
  'policy:denied': PolicyDecision & { context: PolicyContext };
  'policy:profile-changed': { from: PolicyProfile; to: PolicyProfile };
  'policy:rule-added': { rule: PolicyRule; source: PolicySource };
  'policy:config-saved': { config: PolicyConfig };
  'policy:error': { error: Error; context?: PolicyContext };
}
