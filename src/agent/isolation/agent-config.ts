/**
 * Agent Configuration
 *
 * Defines configuration for multi-agent isolation including
 * agent types, capabilities, and workspace settings.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Agent type identifier
 */
export type AgentType = 'coding' | 'research' | 'review' | 'planning' | 'custom';

/**
 * Agent capabilities
 */
export interface AgentCapabilities {
  /** Can read files */
  canRead: boolean;
  /** Can write files */
  canWrite: boolean;
  /** Can execute commands */
  canExecute: boolean;
  /** Can access network */
  canNetwork: boolean;
  /** Can access memory */
  canMemory: boolean;
  /** Allowed tool groups */
  allowedToolGroups: string[];
  /** Denied tool groups */
  deniedToolGroups: string[];
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Unique agent ID */
  id: string;
  /** Agent type */
  type: AgentType;
  /** Display name */
  name: string;
  /** Description */
  description?: string;
  /** Agent capabilities */
  capabilities: AgentCapabilities;
  /** Parent agent ID (for hierarchical agents) */
  parentId?: string;
  /** Maximum concurrent operations */
  maxConcurrentOps: number;
  /** Session timeout in milliseconds */
  sessionTimeoutMs: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Session key format: agent:<agent-id>:<session-key>
 */
export interface AgentSession {
  /** Session key */
  key: string;
  /** Agent ID */
  agentId: string;
  /** Session ID */
  sessionId: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Session metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Default Configurations
// ============================================================================

/**
 * Default capabilities by agent type
 */
export const DEFAULT_CAPABILITIES: Record<AgentType, AgentCapabilities> = {
  coding: {
    canRead: true,
    canWrite: true,
    canExecute: true,
    canNetwork: false,
    canMemory: true,
    allowedToolGroups: ['group:fs', 'group:runtime', 'group:git'],
    deniedToolGroups: ['group:dangerous'],
  },
  research: {
    canRead: true,
    canWrite: false,
    canExecute: false,
    canNetwork: true,
    canMemory: true,
    allowedToolGroups: ['group:fs:read', 'group:web'],
    deniedToolGroups: ['group:fs:write', 'group:runtime', 'group:dangerous'],
  },
  review: {
    canRead: true,
    canWrite: false,
    canExecute: false,
    canNetwork: false,
    canMemory: true,
    allowedToolGroups: ['group:fs:read'],
    deniedToolGroups: ['group:fs:write', 'group:runtime', 'group:dangerous'],
  },
  planning: {
    canRead: true,
    canWrite: false,
    canExecute: false,
    canNetwork: false,
    canMemory: true,
    allowedToolGroups: ['group:fs:read'],
    deniedToolGroups: ['group:fs:write', 'group:runtime', 'group:dangerous'],
  },
  custom: {
    canRead: true,
    canWrite: true,
    canExecute: true,
    canNetwork: true,
    canMemory: true,
    allowedToolGroups: [],
    deniedToolGroups: [],
  },
};

/**
 * Default agent configuration
 */
export const DEFAULT_AGENT_CONFIG: Omit<AgentConfig, 'id' | 'type' | 'name'> = {
  capabilities: DEFAULT_CAPABILITIES.coding,
  maxConcurrentOps: 5,
  sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create agent configuration with defaults
 */
export function createAgentConfig(
  id: string,
  type: AgentType,
  name: string,
  overrides: Partial<AgentConfig> = {}
): AgentConfig {
  return {
    id,
    type,
    name,
    capabilities: { ...DEFAULT_CAPABILITIES[type], ...overrides.capabilities },
    maxConcurrentOps: overrides.maxConcurrentOps ?? DEFAULT_AGENT_CONFIG.maxConcurrentOps,
    sessionTimeoutMs: overrides.sessionTimeoutMs ?? DEFAULT_AGENT_CONFIG.sessionTimeoutMs,
    description: overrides.description,
    parentId: overrides.parentId,
    metadata: overrides.metadata,
  };
}

/**
 * Generate session key for an agent
 */
export function generateSessionKey(agentId: string, sessionId: string): string {
  return `agent:${agentId}:${sessionId}`;
}

/**
 * Parse session key
 */
export function parseSessionKey(key: string): { agentId: string; sessionId: string } | null {
  const parts = key.split(':');
  if (parts.length !== 3 || parts[0] !== 'agent') {
    return null;
  }
  return {
    agentId: parts[1],
    sessionId: parts[2],
  };
}

/**
 * Check if a capability is allowed for an agent
 */
export function isCapabilityAllowed(
  config: AgentConfig,
  capability: keyof AgentCapabilities
): boolean {
  const cap = config.capabilities[capability];
  return typeof cap === 'boolean' ? cap : false;
}

/**
 * Check if a tool group is allowed for an agent
 */
export function isToolGroupAllowed(config: AgentConfig, toolGroup: string): boolean {
  const { allowedToolGroups, deniedToolGroups } = config.capabilities;

  // Check if explicitly denied
  if (deniedToolGroups.includes(toolGroup)) {
    return false;
  }

  // Check if explicitly allowed
  if (allowedToolGroups.length === 0 || allowedToolGroups.includes(toolGroup)) {
    return true;
  }

  // Check if parent group is allowed
  const parts = toolGroup.split(':');
  for (let i = parts.length - 1; i > 0; i--) {
    const parentGroup = parts.slice(0, i).join(':');
    if (allowedToolGroups.includes(parentGroup)) {
      return true;
    }
    if (deniedToolGroups.includes(parentGroup)) {
      return false;
    }
  }

  return false;
}
