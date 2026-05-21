/**
 * Tool Filter - Inspired by Mistral Vibe CLI
 *
 * Filter available tools using glob patterns or regex:
 * - `--enabled-tools "bash,search,*file*"` - Enable only these tools
 * - `--disabled-tools "bash,web_*"` - Disable these tools
 *
 * Patterns support:
 * - Glob-style wildcards: `*`, `?`
 * - Comma-separated list: `bash,search,view_file`
 * - Negation with `!`: `*,!bash` (all except bash)
 */

import type { CodeBuddyTool } from '../codebuddy/client.js';

// ============================================================================
// Types
// ============================================================================

export interface ToolFilterConfig {
  /** Patterns for enabled tools (if empty, all tools are enabled) */
  enabledPatterns: string[];
  /** Patterns for disabled tools */
  disabledPatterns: string[];
}

export interface ToolFilterResult {
  /** Filtered tools */
  tools: CodeBuddyTool[];
  /** Tools that were filtered out */
  filtered: string[];
  /** Total original tools */
  originalCount: number;
  /** Total filtered tools */
  filteredCount: number;
}

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Convert glob pattern to regex
 */
function globToRegex(pattern: string): RegExp {
  // Escape regex special characters except * and ?
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Check if a tool name matches a pattern
 */
function matchesPattern(toolName: string, pattern: string): boolean {
  // Handle negation
  if (pattern.startsWith('!')) {
    return !matchesPattern(toolName, pattern.slice(1));
  }

  // Handle regex pattern (starts with /)
  if (pattern.startsWith('/') && pattern.endsWith('/')) {
    try {
      const regex = new RegExp(pattern.slice(1, -1), 'i');
      return regex.test(toolName);
    } catch {
      return false;
    }
  }

  // Handle glob pattern
  const regex = globToRegex(pattern);
  return regex.test(toolName);
}

/**
 * Check if a tool name matches any of the patterns
 */
function matchesAnyPattern(toolName: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }

  for (const pattern of patterns) {
    if (matchesPattern(toolName, pattern)) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Tool Filter
// ============================================================================

/**
 * Parse a pattern string into individual patterns
 * Supports comma-separated list: "bash,search,*file*"
 */
export function parsePatterns(patternString: string): string[] {
  if (!patternString || patternString.trim() === '') {
    return [];
  }

  return patternString
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Filter tools based on configuration
 */
export function filterTools(
  tools: CodeBuddyTool[],
  config: ToolFilterConfig
): ToolFilterResult {
  const { enabledPatterns, disabledPatterns } = config;
  const filtered: string[] = [];
  const result: CodeBuddyTool[] = [];

  for (const tool of tools) {
    const toolName = tool.function.name;

    // If enabled patterns specified, tool must match one
    if (enabledPatterns.length > 0) {
      if (!matchesAnyPattern(toolName, enabledPatterns)) {
        filtered.push(toolName);
        continue;
      }
    }

    // Check disabled patterns
    if (disabledPatterns.length > 0) {
      if (matchesAnyPattern(toolName, disabledPatterns)) {
        filtered.push(toolName);
        continue;
      }
    }

    result.push(tool);
  }

  return {
    tools: result,
    filtered,
    originalCount: tools.length,
    filteredCount: result.length,
  };
}

/**
 * Filter a list of tool names using the same rules as the model-facing
 * tool schema. Useful for prompt guidance that lists tool names without
 * needing to construct the full runtime definitions.
 */
export function filterToolNames(
  toolNames: readonly string[],
  config: ToolFilterConfig = currentFilter
): string[] {
  if (config.enabledPatterns.length === 0 && config.disabledPatterns.length === 0) {
    return [...toolNames];
  }

  const tools: CodeBuddyTool[] = toolNames.map(name => ({
    type: 'function',
    function: {
      name,
      description: '',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  }));

  return filterTools(tools, config).tools.map(tool => tool.function.name);
}

/**
 * Check whether a single tool name survives the active tool filter.
 */
export function isToolNameAllowed(
  toolName: string,
  config: ToolFilterConfig = currentFilter
): boolean {
  return filterToolNames([toolName], config).length === 1;
}

/**
 * Create a tool filter from CLI options
 */
export function createToolFilter(options: {
  enabledTools?: string;
  disabledTools?: string;
}): ToolFilterConfig {
  return {
    enabledPatterns: parsePatterns(options.enabledTools || ''),
    disabledPatterns: parsePatterns(options.disabledTools || ''),
  };
}

/**
 * Format filter result for display
 */
export function formatFilterResult(result: ToolFilterResult): string {
  const lines: string[] = [];

  lines.push(`Tool Filter: ${result.filteredCount}/${result.originalCount} tools enabled`);

  if (result.filtered.length > 0 && result.filtered.length <= 10) {
    lines.push(`   Disabled: ${result.filtered.join(', ')}`);
  } else if (result.filtered.length > 10) {
    lines.push(`   Disabled: ${result.filtered.slice(0, 10).join(', ')} (+${result.filtered.length - 10} more)`);
  }

  return lines.join('\n');
}

// ============================================================================
// Singleton Filter Manager
// ============================================================================

let currentFilter: ToolFilterConfig = {
  enabledPatterns: [],
  disabledPatterns: [],
};

/**
 * Get the current tool filter configuration
 */
export function getToolFilter(): ToolFilterConfig {
  return { ...currentFilter };
}

/**
 * Set the tool filter configuration
 */
export function setToolFilter(config: ToolFilterConfig): void {
  currentFilter = { ...config };
}

/**
 * Reset the tool filter to default (all tools enabled)
 */
export function resetToolFilter(): void {
  currentFilter = {
    enabledPatterns: [],
    disabledPatterns: [],
  };
}

/**
 * Apply the current filter to tools
 */
export function applyToolFilter(tools: CodeBuddyTool[]): CodeBuddyTool[] {
  if (currentFilter.enabledPatterns.length === 0 &&
      currentFilter.disabledPatterns.length === 0) {
    return tools;
  }

  return filterTools(tools, currentFilter).tools;
}
