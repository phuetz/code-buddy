/**
 * Policy Profiles
 *
 * Predefined permission profiles for different use cases:
 * - minimal: Most restrictive, read-only operations
 * - coding: Standard development workflow
 * - messaging: Communication and web-focused
 * - full: Full access with confirmation for dangerous ops
 */

import type {
  PolicyProfile,
  ProfileDefinition,
  PolicyRule,
} from './types.js';

// ============================================================================
// Profile Definitions
// ============================================================================

/**
 * Minimal profile - Most restrictive
 * Only allows read operations, no execution or writes
 */
const MINIMAL_PROFILE: ProfileDefinition = {
  name: 'minimal',
  description: 'Read-only mode. No file modifications or command execution.',
  customizable: true,
  rules: [
    // Allow read operations
    {
      group: 'group:fs:read',
      action: 'allow',
      reason: 'Read operations are safe',
      priority: 10,
    },
    // Deny all writes
    {
      group: 'group:fs:write',
      action: 'deny',
      reason: 'Write operations not allowed in minimal mode',
      priority: 10,
    },
    {
      group: 'group:fs:delete',
      action: 'deny',
      reason: 'Delete operations not allowed in minimal mode',
      priority: 10,
    },
    // Deny all runtime
    {
      group: 'group:runtime',
      action: 'deny',
      reason: 'Runtime operations not allowed in minimal mode',
      priority: 10,
    },
    // Allow web search (read-only)
    {
      group: 'group:web:search',
      action: 'allow',
      reason: 'Web search is read-only',
      priority: 10,
    },
    // Deny web fetch (can be used maliciously)
    {
      group: 'group:web:fetch',
      action: 'deny',
      reason: 'Web fetch not allowed in minimal mode',
      priority: 10,
    },
    // Allow git read
    {
      group: 'group:git:read',
      action: 'allow',
      reason: 'Git read operations are safe',
      priority: 10,
    },
    // Deny git write
    {
      group: 'group:git:write',
      action: 'deny',
      reason: 'Git write operations not allowed in minimal mode',
      priority: 10,
    },
    // Deny all dangerous
    {
      group: 'group:dangerous',
      action: 'deny',
      reason: 'Dangerous operations not allowed in minimal mode',
      priority: 100,
    },
    // Allow system info
    {
      group: 'group:system:info',
      action: 'allow',
      reason: 'System info is read-only',
      priority: 10,
    },
    // Deny system modify
    {
      group: 'group:system:modify',
      action: 'deny',
      reason: 'System modifications not allowed in minimal mode',
      priority: 10,
    },
    // Deny containers
    {
      group: 'group:docker',
      action: 'deny',
      reason: 'Docker operations not allowed in minimal mode',
      priority: 10,
    },
    {
      group: 'group:kubernetes',
      action: 'deny',
      reason: 'Kubernetes operations not allowed in minimal mode',
      priority: 10,
    },
    // Require confirmation for MCP/plugins
    {
      group: 'group:mcp',
      action: 'confirm',
      reason: 'MCP tools require explicit confirmation in minimal mode',
      priority: 10,
    },
    {
      group: 'group:plugin',
      action: 'confirm',
      reason: 'Plugin tools require explicit confirmation in minimal mode',
      priority: 10,
    },
  ],
};

/**
 * Coding profile - Standard development workflow
 * Allows file operations and safe commands with confirmation
 */
const CODING_PROFILE: ProfileDefinition = {
  name: 'coding',
  description: 'Standard development. File edits allowed, commands require confirmation.',
  customizable: true,
  rules: [
    // Allow all file read
    {
      group: 'group:fs:read',
      action: 'allow',
      reason: 'Read operations needed for development',
      priority: 10,
    },
    // Allow file write with implicit trust
    {
      group: 'group:fs:write',
      action: 'allow',
      reason: 'File edits allowed for coding workflow',
      priority: 10,
    },
    // Confirm file delete
    {
      group: 'group:fs:delete',
      action: 'confirm',
      reason: 'File deletion requires confirmation',
      priority: 10,
    },
    // Confirm shell commands
    {
      group: 'group:runtime:shell',
      action: 'confirm',
      reason: 'Shell commands require confirmation',
      priority: 10,
    },
    // Deny process management
    {
      group: 'group:runtime:process',
      action: 'confirm',
      reason: 'Process management requires confirmation',
      priority: 10,
    },
    // Allow web search
    {
      group: 'group:web:search',
      action: 'allow',
      reason: 'Web search useful for development',
      priority: 10,
    },
    // Allow web fetch for documentation/APIs
    {
      group: 'group:web:fetch',
      action: 'allow',
      reason: 'Web fetch useful for documentation',
      priority: 10,
    },
    // Allow all git read
    {
      group: 'group:git:read',
      action: 'allow',
      reason: 'Git read operations needed for development',
      priority: 10,
    },
    // Confirm git write
    {
      group: 'group:git:write',
      action: 'confirm',
      reason: 'Git write operations require confirmation',
      priority: 10,
    },
    // Allow system info
    {
      group: 'group:system:info',
      action: 'allow',
      reason: 'System info useful for development',
      priority: 10,
    },
    // Confirm system modify
    {
      group: 'group:system:modify',
      action: 'confirm',
      reason: 'System modifications require confirmation',
      priority: 10,
    },
    // Confirm Docker (useful but risky)
    {
      group: 'group:docker',
      action: 'confirm',
      reason: 'Docker operations require confirmation',
      priority: 10,
    },
    // Confirm Kubernetes
    {
      group: 'group:kubernetes',
      action: 'confirm',
      reason: 'Kubernetes operations require confirmation',
      priority: 10,
    },
    // Always confirm dangerous
    {
      group: 'group:dangerous',
      action: 'confirm',
      reason: 'Dangerous operations always require confirmation',
      priority: 100,
    },
    // Confirm MCP tools
    {
      group: 'group:mcp',
      action: 'confirm',
      reason: 'MCP tools require confirmation',
      priority: 10,
    },
    // Confirm plugins
    {
      group: 'group:plugin',
      action: 'confirm',
      reason: 'Plugin tools require confirmation',
      priority: 10,
    },
  ],
};

/**
 * Messaging profile - Communication and web-focused
 * Useful for agents that primarily fetch/search web content
 */
const MESSAGING_PROFILE: ProfileDefinition = {
  name: 'messaging',
  description: 'Communication focus. Web access allowed, limited file operations.',
  customizable: true,
  rules: [
    // Allow file read
    {
      group: 'group:fs:read',
      action: 'allow',
      reason: 'Read operations allowed for context gathering',
      priority: 10,
    },
    // Confirm file write (limited use case)
    {
      group: 'group:fs:write',
      action: 'confirm',
      reason: 'File writes require confirmation in messaging mode',
      priority: 10,
    },
    // Deny file delete
    {
      group: 'group:fs:delete',
      action: 'deny',
      reason: 'File deletion not needed for messaging',
      priority: 10,
    },
    // Confirm shell (limited use)
    {
      group: 'group:runtime:shell',
      action: 'confirm',
      reason: 'Shell commands require confirmation',
      priority: 10,
    },
    // Deny process management
    {
      group: 'group:runtime:process',
      action: 'deny',
      reason: 'Process management not needed for messaging',
      priority: 10,
    },
    // Allow all web operations
    {
      group: 'group:web',
      action: 'allow',
      reason: 'Web operations are core to messaging',
      priority: 10,
    },
    // Allow git read
    {
      group: 'group:git:read',
      action: 'allow',
      reason: 'Git read useful for context',
      priority: 10,
    },
    // Deny git write
    {
      group: 'group:git:write',
      action: 'deny',
      reason: 'Git write not needed for messaging',
      priority: 10,
    },
    // Allow system info
    {
      group: 'group:system:info',
      action: 'allow',
      reason: 'System info useful for context',
      priority: 10,
    },
    // Deny system modify
    {
      group: 'group:system:modify',
      action: 'deny',
      reason: 'System modifications not needed for messaging',
      priority: 10,
    },
    // Deny Docker
    {
      group: 'group:docker',
      action: 'deny',
      reason: 'Docker not needed for messaging',
      priority: 10,
    },
    // Deny Kubernetes
    {
      group: 'group:kubernetes',
      action: 'deny',
      reason: 'Kubernetes not needed for messaging',
      priority: 10,
    },
    // Always deny dangerous
    {
      group: 'group:dangerous',
      action: 'deny',
      reason: 'Dangerous operations not allowed in messaging mode',
      priority: 100,
    },
    // Confirm MCP (might be messaging tools)
    {
      group: 'group:mcp',
      action: 'confirm',
      reason: 'MCP tools require confirmation',
      priority: 10,
    },
    // Confirm plugins
    {
      group: 'group:plugin',
      action: 'confirm',
      reason: 'Plugin tools require confirmation',
      priority: 10,
    },
  ],
};

/**
 * Full profile - Maximum access
 * All operations allowed, dangerous ones require confirmation
 */
const FULL_PROFILE: ProfileDefinition = {
  name: 'full',
  description: 'Full access. All operations allowed, dangerous ones require confirmation.',
  customizable: true,
  rules: [
    // Allow all file operations
    {
      group: 'group:fs',
      action: 'allow',
      reason: 'Full filesystem access granted',
      priority: 10,
    },
    // Allow all runtime
    {
      group: 'group:runtime',
      action: 'allow',
      reason: 'Full runtime access granted',
      priority: 10,
    },
    // Allow all web
    {
      group: 'group:web',
      action: 'allow',
      reason: 'Full web access granted',
      priority: 10,
    },
    // Allow all git
    {
      group: 'group:git',
      action: 'allow',
      reason: 'Full git access granted',
      priority: 10,
    },
    // Allow system
    {
      group: 'group:system',
      action: 'allow',
      reason: 'Full system access granted',
      priority: 10,
    },
    // Allow Docker
    {
      group: 'group:docker',
      action: 'allow',
      reason: 'Docker access granted',
      priority: 10,
    },
    // Allow Kubernetes
    {
      group: 'group:kubernetes',
      action: 'allow',
      reason: 'Kubernetes access granted',
      priority: 10,
    },
    // ALWAYS confirm dangerous (even in full mode)
    {
      group: 'group:dangerous',
      action: 'confirm',
      reason: 'Dangerous operations always require confirmation for safety',
      priority: 100,
    },
    // Allow MCP
    {
      group: 'group:mcp',
      action: 'allow',
      reason: 'MCP tools allowed in full mode',
      priority: 10,
    },
    // Allow plugins
    {
      group: 'group:plugin',
      action: 'allow',
      reason: 'Plugin tools allowed in full mode',
      priority: 10,
    },
  ],
};

// ============================================================================
// Profile Registry
// ============================================================================

/**
 * All profile definitions
 */
export const PROFILES: Record<PolicyProfile, ProfileDefinition> = {
  minimal: MINIMAL_PROFILE,
  coding: CODING_PROFILE,
  messaging: MESSAGING_PROFILE,
  full: FULL_PROFILE,
};

/**
 * Get profile definition by name
 */
export function getProfile(name: PolicyProfile): ProfileDefinition {
  const profile = PROFILES[name];
  if (!profile) {
    throw new Error(`Unknown profile: ${name}`);
  }
  return profile;
}

/**
 * Get all profile names
 */
export function getProfileNames(): PolicyProfile[] {
  return Object.keys(PROFILES) as PolicyProfile[];
}

/**
 * Get rules for a profile (including inherited rules)
 */
export function getProfileRules(name: PolicyProfile): PolicyRule[] {
  const profile = getProfile(name);
  const rules = [...profile.rules];

  // Handle inheritance
  if (profile.inherits) {
    const parentRules = getProfileRules(profile.inherits);
    // Parent rules have lower priority
    for (const rule of parentRules) {
      const existingRule = rules.find(r => r.group === rule.group);
      if (!existingRule) {
        rules.push({ ...rule, priority: (rule.priority || 1) - 1 });
      }
    }
  }

  return rules;
}

/**
 * Format profile for display
 */
export function formatProfile(name: PolicyProfile): string {
  const profile = getProfile(name);
  const icons: Record<PolicyProfile, string> = {
    minimal: '🔒',
    coding: '💻',
    messaging: '💬',
    full: '🔓',
  };

  return `${icons[name]} ${name}: ${profile.description}`;
}

/**
 * Get profile comparison table
 */
export function getProfileComparison(): string {
  const groups = [
    'group:fs:read',
    'group:fs:write',
    'group:fs:delete',
    'group:runtime:shell',
    'group:web',
    'group:git:read',
    'group:git:write',
    'group:dangerous',
  ];

  const headers = ['Group', ...getProfileNames()];
  const rows: string[][] = [];

  for (const group of groups) {
    const row = [group.replace('group:', '')];
    for (const profileName of getProfileNames()) {
      const rules = getProfileRules(profileName);
      const rule = rules.find(r => r.group === group || group.startsWith(r.group + ':'));
      const action = rule?.action || 'confirm';
      const icon = action === 'allow' ? '✅' : action === 'deny' ? '❌' : '❓';
      row.push(icon);
    }
    rows.push(row);
  }

  // Format as table
  const lines = [
    headers.join(' | '),
    headers.map(_ => '---').join(' | '),
    ...rows.map(row => row.join(' | ')),
  ];

  return lines.join('\n');
}
