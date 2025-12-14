/**
 * Permissions Handlers - Claude Code-style tool permissions management
 *
 * Inspired by Claude Code's /permissions command for managing tool allowlists.
 */

import { ChatEntry } from "../../agent/grok-agent.js";
import { getToolFilter, setToolFilter, createToolFilter, resetToolFilter } from "../../utils/tool-filter.js";
import * as fs from 'fs';
import * as path from 'path';

export interface CommandHandlerResult {
  handled: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
}

// Tool categories for easy management
const TOOL_CATEGORIES: Record<string, string[]> = {
  'file-read': ['read_file', 'search_files', 'list_directory', 'glob'],
  'file-write': ['write_file', 'edit_file', 'multi_edit', 'create_file'],
  'bash': ['bash', 'execute_command', 'run_command'],
  'git': ['git_*', 'commit', 'push', 'pull'],
  'web': ['web_search', 'fetch_url', 'web_*'],
  'mcp': ['mcp__*'],
  'dangerous': ['bash', 'execute_command', 'write_file', 'edit_file', 'delete_file'],
};

/**
 * Handle /permissions command
 */
export function handlePermissions(args: string[]): CommandHandlerResult {
  const action = args[0]?.toLowerCase();
  const target = args.slice(1).join(' ');

  let content: string;

  switch (action) {
    case 'add':
    case 'allow':
      content = addPermission(target);
      break;

    case 'remove':
    case 'deny':
    case 'block':
      content = removePermission(target);
      break;

    case 'list':
      content = listPermissions();
      break;

    case 'reset':
      content = resetPermissions();
      break;

    case 'save':
      content = savePermissions();
      break;

    case 'categories':
      content = listCategories();
      break;

    case 'help':
    default:
      content = getPermissionsHelp();
      break;
  }

  return {
    handled: true,
    entry: {
      type: "assistant",
      content,
      timestamp: new Date(),
    },
  };
}

/**
 * Add a tool to the allowlist
 */
function addPermission(tool: string): string {
  if (!tool) {
    return `❌ Usage: /permissions add <tool|category>

Examples:
  /permissions add bash
  /permissions add Edit
  /permissions add mcp__puppeteer__*
  /permissions add file-write  (category)`;
  }

  // Check if it's a category
  if (TOOL_CATEGORIES[tool]) {
    const tools = TOOL_CATEGORIES[tool];
    const currentFilter = getToolFilter();
    const enabled = new Set([...currentFilter.enabledPatterns, ...tools]);

    setToolFilter(createToolFilter({
      enabledTools: Array.from(enabled).join(','),
      disabledTools: currentFilter.disabledPatterns.join(','),
    }));

    return `✅ Added category "${tool}" to allowlist:
${tools.map(t => `  • ${t}`).join('\n')}`;
  }

  // Single tool
  const currentFilter = getToolFilter();
  const enabled = new Set([...currentFilter.enabledPatterns, tool]);

  setToolFilter(createToolFilter({
    enabledTools: Array.from(enabled).join(','),
    disabledTools: currentFilter.disabledPatterns.join(','),
  }));

  return `✅ Added "${tool}" to allowlist`;
}

/**
 * Remove a tool from the allowlist (add to blocklist)
 */
function removePermission(tool: string): string {
  if (!tool) {
    return `❌ Usage: /permissions remove <tool|category>

Examples:
  /permissions remove bash
  /permissions remove dangerous  (category)`;
  }

  // Check if it's a category
  if (TOOL_CATEGORIES[tool]) {
    const tools = TOOL_CATEGORIES[tool];
    const currentFilter = getToolFilter();
    const disabled = new Set([...currentFilter.disabledPatterns, ...tools]);

    setToolFilter(createToolFilter({
      enabledTools: currentFilter.enabledPatterns.join(','),
      disabledTools: Array.from(disabled).join(','),
    }));

    return `🚫 Blocked category "${tool}":
${tools.map(t => `  • ${t}`).join('\n')}`;
  }

  // Single tool
  const currentFilter = getToolFilter();
  const disabled = new Set([...currentFilter.disabledPatterns, tool]);

  setToolFilter(createToolFilter({
    enabledTools: currentFilter.enabledPatterns.join(','),
    disabledTools: Array.from(disabled).join(','),
  }));

  return `🚫 Blocked "${tool}"`;
}

/**
 * List current permissions
 */
function listPermissions(): string {
  const filter = getToolFilter();
  const lines: string[] = [
    '🔐 Tool Permissions',
    '═'.repeat(40),
    '',
  ];

  const hasEnabled = filter.enabledPatterns.length > 0;
  const hasDisabled = filter.disabledPatterns.length > 0;

  if (!hasEnabled && !hasDisabled) {
    lines.push('Mode: All tools enabled (default)');
    lines.push('');
    lines.push('Use /permissions add <tool> to restrict to specific tools');
    lines.push('Use /permissions remove <tool> to block specific tools');
  } else {
    if (hasEnabled) {
      lines.push('✅ Allowed tools:');
      for (const tool of filter.enabledPatterns) {
        lines.push(`  • ${tool}`);
      }
      lines.push('');
    }

    if (hasDisabled) {
      lines.push('🚫 Blocked tools:');
      for (const tool of filter.disabledPatterns) {
        lines.push(`  • ${tool}`);
      }
      lines.push('');
    }
  }

  lines.push('Commands:');
  lines.push('  /permissions add <tool>     - Allow a tool');
  lines.push('  /permissions remove <tool>  - Block a tool');
  lines.push('  /permissions categories     - Show tool categories');
  lines.push('  /permissions save           - Save to settings');
  lines.push('  /permissions reset          - Reset to defaults');

  return lines.join('\n');
}

/**
 * Reset permissions to default
 */
function resetPermissions(): string {
  resetToolFilter();
  return `🔄 Permissions reset to default (all tools enabled)`;
}

/**
 * Save permissions to settings file
 */
function savePermissions(): string {
  const filter = getToolFilter();

  try {
    // Save to .grok/settings.json for project-specific settings
    const projectSettingsPath = path.join(process.cwd(), '.grok', 'settings.json');
    if (fs.existsSync(path.dirname(projectSettingsPath))) {
      let projectSettings: Record<string, unknown> = {};
      if (fs.existsSync(projectSettingsPath)) {
        projectSettings = JSON.parse(fs.readFileSync(projectSettingsPath, 'utf-8'));
      }

      projectSettings.allowedTools = filter.enabledPatterns;
      projectSettings.blockedTools = filter.disabledPatterns;

      fs.writeFileSync(projectSettingsPath, JSON.stringify(projectSettings, null, 2));

      return `💾 Permissions saved to settings

Saved to:
  • .grok/settings.json (project)

Allowed: ${filter.enabledPatterns.length > 0 ? filter.enabledPatterns.join(', ') : '(all)'}
Blocked: ${filter.disabledPatterns.length > 0 ? filter.disabledPatterns.join(', ') : '(none)'}`;
    } else {
      return `❌ No .grok directory found. Run /init first.`;
    }
  } catch (error) {
    return `❌ Failed to save permissions: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * List tool categories
 */
function listCategories(): string {
  const lines: string[] = [
    '📁 Tool Categories',
    '═'.repeat(40),
    '',
  ];

  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    lines.push(`${category}:`);
    for (const tool of tools) {
      lines.push(`  • ${tool}`);
    }
    lines.push('');
  }

  lines.push('Usage:');
  lines.push('  /permissions add <category>     - Allow all tools in category');
  lines.push('  /permissions remove <category>  - Block all tools in category');

  return lines.join('\n');
}

/**
 * Get help for permissions command
 */
function getPermissionsHelp(): string {
  return `🔐 Tool Permissions Management
═══════════════════════════════════════════════════

Manage which tools the AI can use during this session.

📋 Commands:
  /permissions                    - Show this help
  /permissions list               - Show current permissions
  /permissions add <tool>         - Allow a tool or category
  /permissions remove <tool>      - Block a tool or category
  /permissions categories         - Show available categories
  /permissions save               - Save to settings file
  /permissions reset              - Reset to defaults

📌 Examples:
  /permissions add bash           - Allow bash commands
  /permissions add file-write     - Allow all file write tools
  /permissions remove dangerous   - Block all dangerous tools
  /permissions add mcp__*         - Allow all MCP tools
  /permissions add Bash(git:*)    - Allow git commands only

🔧 Tool patterns support glob syntax:
  • bash           - Exact match
  • mcp__*         - Wildcard match
  • *file*         - Contains match
  • Bash(npm:*)    - Bash with npm commands only

💡 Tip: Permissions are session-specific. Use /permissions save
   to persist them to your settings file.`;
}
