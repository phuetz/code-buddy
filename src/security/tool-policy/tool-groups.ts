/**
 * Tool Groups Mapping
 *
 * Maps individual tools to their hierarchical groups for policy resolution.
 * Each tool can belong to multiple groups (e.g., 'bash' belongs to both
 * 'group:runtime:shell' and 'group:dangerous').
 */

import type { ToolGroup } from './types.js';

// ============================================================================
// Tool to Groups Mapping
// ============================================================================

/**
 * Mapping of tool names to their groups
 */
export const TOOL_GROUPS: Record<string, ToolGroup[]> = {
  // File System - Read
  view_file: ['group:fs', 'group:fs:read'],
  read: ['group:fs', 'group:fs:read'],
  glob: ['group:fs', 'group:fs:read'],
  search: ['group:fs', 'group:fs:read'],
  unified_search: ['group:fs', 'group:fs:read'],
  find_symbols: ['group:fs', 'group:fs:read'],
  find_references: ['group:fs', 'group:fs:read'],
  find_definition: ['group:fs', 'group:fs:read'],
  list_files: ['group:fs', 'group:fs:read'],
  get_codebase_structure: ['group:fs', 'group:fs:read'],

  // File System - Write
  create_file: ['group:fs', 'group:fs:write'],
  str_replace_editor: ['group:fs', 'group:fs:write'],
  edit: ['group:fs', 'group:fs:write'],
  write: ['group:fs', 'group:fs:write'],
  insert: ['group:fs', 'group:fs:write'],
  edit_file: ['group:fs', 'group:fs:write'],

  // File System - Delete
  delete_file: ['group:fs', 'group:fs:delete', 'group:dangerous'],
  rm: ['group:fs', 'group:fs:delete', 'group:dangerous'],

  // Runtime - Shell
  bash: ['group:runtime', 'group:runtime:shell'],
  shell: ['group:runtime', 'group:runtime:shell'],
  execute: ['group:runtime', 'group:runtime:shell'],
  run_command: ['group:runtime', 'group:runtime:shell'],

  // Runtime - Process
  spawn_process: ['group:runtime', 'group:runtime:process'],
  kill_process: ['group:runtime', 'group:runtime:process', 'group:dangerous'],

  // Web - Fetch
  web_fetch: ['group:web', 'group:web:fetch'],
  http_request: ['group:web', 'group:web:fetch'],
  curl: ['group:web', 'group:web:fetch'],
  fetch_url: ['group:web', 'group:web:fetch'],

  // Web - Search
  web_search: ['group:web', 'group:web:search'],
  tavily_search: ['group:web', 'group:web:search'],

  // Git - Read
  git_status: ['group:git', 'group:git:read'],
  git_log: ['group:git', 'group:git:read'],
  git_diff: ['group:git', 'group:git:read'],
  git_show: ['group:git', 'group:git:read'],
  git_branch: ['group:git', 'group:git:read'],

  // Git - Write
  git_commit: ['group:git', 'group:git:write'],
  git_push: ['group:git', 'group:git:write', 'group:dangerous'],
  git_pull: ['group:git', 'group:git:write'],
  git_merge: ['group:git', 'group:git:write'],
  git_checkout: ['group:git', 'group:git:write'],
  git_rebase: ['group:git', 'group:git:write', 'group:dangerous'],
  git_reset: ['group:git', 'group:git:write', 'group:dangerous'],

  // Docker
  docker_build: ['group:docker'],
  docker_run: ['group:docker'],
  docker_exec: ['group:docker'],
  docker_ps: ['group:docker'],
  docker_logs: ['group:docker'],
  docker_stop: ['group:docker'],
  docker_rm: ['group:docker', 'group:dangerous'],

  // Kubernetes
  kubectl_get: ['group:kubernetes'],
  kubectl_describe: ['group:kubernetes'],
  kubectl_logs: ['group:kubernetes'],
  kubectl_exec: ['group:kubernetes'],
  kubectl_apply: ['group:kubernetes'],
  kubectl_delete: ['group:kubernetes', 'group:dangerous'],

  // System - Info
  system_info: ['group:system', 'group:system:info'],
  get_env: ['group:system', 'group:system:info'],
  which: ['group:system', 'group:system:info'],

  // System - Modify
  set_env: ['group:system', 'group:system:modify'],
  install_package: ['group:system', 'group:system:modify'],

  // Planning/Reasoning (no special groups - generally safe)
  plan: [],
  think: [],
  reason: [],
  todo_read: [],
  todo_write: [],

  // Browser
  browser_action: ['group:web'],
  screenshot: ['group:web'],
};

// ============================================================================
// Group Operations
// ============================================================================

/**
 * Get groups for a tool
 * @param toolName Tool name
 * @returns Array of groups the tool belongs to
 */
export function getToolGroups(toolName: string): ToolGroup[] {
  // Check for MCP tools
  if (toolName.startsWith('mcp__')) {
    return ['group:mcp'];
  }

  // Check for plugin tools
  if (toolName.startsWith('plugin__')) {
    return ['group:plugin'];
  }

  // Look up in mapping
  const groups = TOOL_GROUPS[toolName];
  if (groups) {
    return [...groups];
  }

  // Unknown tool - return empty array
  return [];
}

/**
 * Get all tools in a group (including child groups)
 * @param group Target group
 * @returns Array of tool names in the group
 */
export function getToolsInGroup(group: ToolGroup): string[] {
  const tools: string[] = [];

  for (const [tool, groups] of Object.entries(TOOL_GROUPS)) {
    for (const g of groups) {
      // Check exact match or child group
      if (g === group || g.startsWith(group + ':')) {
        tools.push(tool);
        break;
      }
    }
  }

  return tools;
}

/**
 * Check if a tool is in a group (or any child group)
 * @param toolName Tool to check
 * @param group Group to check against
 * @returns True if tool is in group
 */
export function isToolInGroup(toolName: string, group: ToolGroup): boolean {
  const toolGroups = getToolGroups(toolName);

  for (const tg of toolGroups) {
    if (tg === group || tg.startsWith(group + ':')) {
      return true;
    }
  }

  return false;
}

/**
 * Register a new tool with groups
 * @param toolName Tool name to register
 * @param groups Groups the tool belongs to
 */
export function registerToolGroups(toolName: string, groups: ToolGroup[]): void {
  TOOL_GROUPS[toolName] = [...groups];
}

/**
 * Unregister a tool
 * @param toolName Tool name to unregister
 */
export function unregisterToolGroups(toolName: string): void {
  delete TOOL_GROUPS[toolName];
}

/**
 * Get all registered tools
 * @returns Array of all registered tool names
 */
export function getAllRegisteredTools(): string[] {
  return Object.keys(TOOL_GROUPS);
}

/**
 * Get group statistics
 * @returns Map of groups to tool counts
 */
export function getGroupStats(): Map<ToolGroup, number> {
  const stats = new Map<ToolGroup, number>();

  for (const groups of Object.values(TOOL_GROUPS)) {
    for (const group of groups) {
      stats.set(group, (stats.get(group) || 0) + 1);
    }
  }

  return stats;
}
