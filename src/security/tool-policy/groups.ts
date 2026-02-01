/**
 * Tool Groups
 *
 * Inspired by OpenClaw's tool-policy.ts
 * Defines logical groups of tools for policy management.
 */

// ============================================================================
// Tool Group Types
// ============================================================================

/**
 * Tool group identifiers
 * Hierarchical structure: group:category:subcategory
 */
export type ToolGroup =
  | 'group:all'           // All tools
  | 'group:fs'            // All filesystem
  | 'group:fs:read'       // Read-only filesystem
  | 'group:fs:write'      // Write filesystem
  | 'group:fs:delete'     // Delete filesystem
  | 'group:runtime'       // Code execution
  | 'group:runtime:bash'  // Bash execution
  | 'group:runtime:node'  // Node execution
  | 'group:web'           // Web/network
  | 'group:web:fetch'     // HTTP fetching
  | 'group:web:browser'   // Browser control
  | 'group:git'           // Git operations
  | 'group:git:read'      // Git read (status, log, diff)
  | 'group:git:write'     // Git write (commit, push)
  | 'group:docker'        // Docker operations
  | 'group:messaging'     // Messaging channels
  | 'group:memory'        // Memory operations
  | 'group:agent'         // Agent operations
  | 'group:system'        // System operations
  | 'group:dangerous';    // Potentially destructive

// ============================================================================
// Tool Group Definitions
// ============================================================================

/**
 * Mapping of tool groups to individual tools
 */
export const TOOL_GROUPS: Record<ToolGroup, string[]> = {
  'group:all': ['*'],

  'group:fs': [
    'read_file', 'read', 'Read',
    'write_file', 'write', 'Write',
    'edit_file', 'edit', 'Edit',
    'list_directory', 'ls', 'Glob',
    'search_files', 'grep', 'Grep',
    'create_directory', 'mkdir',
    'delete_file', 'rm', 'delete',
    'move_file', 'mv', 'move',
    'copy_file', 'cp', 'copy',
  ],

  'group:fs:read': [
    'read_file', 'read', 'Read',
    'list_directory', 'ls', 'Glob',
    'search_files', 'grep', 'Grep',
  ],

  'group:fs:write': [
    'write_file', 'write', 'Write',
    'edit_file', 'edit', 'Edit',
    'create_directory', 'mkdir',
    'move_file', 'mv', 'move',
    'copy_file', 'cp', 'copy',
  ],

  'group:fs:delete': [
    'delete_file', 'rm', 'delete',
  ],

  'group:runtime': [
    'bash', 'Bash', 'exec', 'execute',
    'run_command', 'shell',
    'node', 'python', 'run_script',
  ],

  'group:runtime:bash': [
    'bash', 'Bash', 'exec', 'execute',
    'run_command', 'shell',
  ],

  'group:runtime:node': [
    'node', 'run_script',
  ],

  'group:web': [
    'web_fetch', 'WebFetch', 'fetch', 'http',
    'web_search', 'WebSearch', 'search',
    'browser_navigate', 'browser_click', 'browser_type',
    'browser_screenshot', 'browser_scroll',
  ],

  'group:web:fetch': [
    'web_fetch', 'WebFetch', 'fetch', 'http',
  ],

  'group:web:browser': [
    'browser_navigate', 'browser_click', 'browser_type',
    'browser_screenshot', 'browser_scroll',
    'browser_evaluate', 'browser_wait',
  ],

  'group:git': [
    'git_status', 'git_log', 'git_diff',
    'git_commit', 'git_push', 'git_pull',
    'git_branch', 'git_checkout', 'git_merge',
    'git_stash', 'git_reset',
  ],

  'group:git:read': [
    'git_status', 'git_log', 'git_diff',
    'git_branch',
  ],

  'group:git:write': [
    'git_commit', 'git_push', 'git_pull',
    'git_checkout', 'git_merge',
    'git_stash', 'git_reset',
  ],

  'group:docker': [
    'docker_build', 'docker_run', 'docker_stop',
    'docker_ps', 'docker_logs', 'docker_exec',
  ],

  'group:messaging': [
    'send_message', 'reply',
    'slack_send', 'discord_send', 'telegram_send',
    'email_send',
  ],

  'group:memory': [
    'memory_store', 'memory_recall', 'memory_search',
    'memory_delete', 'memory_clear',
  ],

  'group:agent': [
    'spawn_agent', 'Task',
    'agent_status', 'agent_stop',
    'subagent_spawn', 'subagent_list',
  ],

  'group:system': [
    'system_info', 'process_list',
    'screenshot', 'clipboard',
    'notification',
  ],

  'group:dangerous': [
    'delete_file', 'rm', 'delete',
    'git_reset', 'git_push',
    'docker_stop', 'docker_rm',
    'bash', 'Bash', 'exec',
    'memory_clear', 'memory_delete',
  ],
};

// ============================================================================
// Tool Name Normalization
// ============================================================================

/**
 * Tool name aliases for normalization
 */
export const TOOL_ALIASES: Record<string, string> = {
  // Filesystem
  'read': 'read_file',
  'Read': 'read_file',
  'write': 'write_file',
  'Write': 'write_file',
  'edit': 'edit_file',
  'Edit': 'edit_file',
  'ls': 'list_directory',
  'Glob': 'list_directory',
  'grep': 'search_files',
  'Grep': 'search_files',
  'rm': 'delete_file',
  'mv': 'move_file',
  'cp': 'copy_file',

  // Runtime
  'Bash': 'bash',
  'exec': 'bash',
  'execute': 'bash',
  'shell': 'bash',
  'run_command': 'bash',

  // Web
  'WebFetch': 'web_fetch',
  'fetch': 'web_fetch',
  'http': 'web_fetch',
  'WebSearch': 'web_search',
  'search': 'web_search',

  // Agent
  'Task': 'spawn_agent',
};

/**
 * Normalize a tool name to canonical form
 */
export function normalizeToolName(name: string): string {
  return TOOL_ALIASES[name] || name.toLowerCase();
}

/**
 * Normalize a list of tool names
 */
export function normalizeToolList(tools: string[]): string[] {
  return [...new Set(tools.map(normalizeToolName))];
}

// ============================================================================
// Group Expansion
// ============================================================================

/**
 * Check if a string is a tool group
 */
export function isToolGroup(value: string): value is ToolGroup {
  return value.startsWith('group:') && value in TOOL_GROUPS;
}

/**
 * Expand tool groups into individual tools
 */
export function expandToolGroups(
  tools: string[],
  groups: Record<string, string[]> = TOOL_GROUPS
): string[] {
  const expanded = new Set<string>();

  for (const tool of tools) {
    if (isToolGroup(tool)) {
      const groupTools = groups[tool] || [];
      for (const t of groupTools) {
        if (t === '*') {
          // Wildcard - add all non-group tools
          for (const [_, groupToolList] of Object.entries(groups)) {
            for (const gt of groupToolList) {
              if (gt !== '*') {
                expanded.add(normalizeToolName(gt));
              }
            }
          }
        } else if (!isToolGroup(t)) {
          expanded.add(normalizeToolName(t));
        } else {
          // Recursive group expansion
          const subExpanded = expandToolGroups([t], groups);
          for (const st of subExpanded) {
            expanded.add(st);
          }
        }
      }
    } else {
      expanded.add(normalizeToolName(tool));
    }
  }

  return Array.from(expanded);
}

/**
 * Get all tools in a group (including subgroups)
 */
export function getToolsInGroup(group: ToolGroup): string[] {
  return expandToolGroups([group]);
}

/**
 * Check if a tool belongs to a group
 */
export function isToolInGroup(tool: string, group: ToolGroup): boolean {
  const groupTools = getToolsInGroup(group);
  const normalizedTool = normalizeToolName(tool);
  return groupTools.includes(normalizedTool);
}

/**
 * Get all groups a tool belongs to
 */
export function getToolGroups(tool: string): ToolGroup[] {
  const normalizedTool = normalizeToolName(tool);
  const groups: ToolGroup[] = [];

  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    const expanded = expandToolGroups(tools as string[]);
    if (expanded.includes(normalizedTool)) {
      groups.push(group as ToolGroup);
    }
  }

  return groups;
}
