/**
 * Tool Prefix Naming Convention — Codex-inspired canonical tool names.
 *
 * Codex CLI uses a strict `<namespace>_<action>` naming scheme so models
 * can reason about tool categories by prefix (e.g. all `shell_*` tools
 * spawn subprocesses; all `file_*` tools touch the filesystem).
 *
 * This module registers backward-compatible alias ITool wrappers so both
 * the original names (e.g. `bash`, `view_file`) and the new canonical names
 * (e.g. `shell_exec`, `file_read`) route to the same underlying implementation.
 *
 * Convention:
 *   shell_*    → subprocess / terminal execution (bash, git, docker, process)
 *   file_*     → read / write / edit filesystem files
 *   browser_*  → web requests, browser control, screenshots
 *   search_*   → code search, symbol lookup, find
 *   plan_*     → persistent planning (PLAN.md)
 *   todo_*     → attention todo list
 *   knowledge_*→ knowledge base operations
 *   agent_*    → human-in-the-loop / skill authoring
 *
 * To add new aliases simply append to TOOL_ALIASES below.
 */

import type { ITool, IToolMetadata, ToolSchema, IToolExecutionContext, IToolExecutionResult } from './types.js';

// ============================================================================
// Alias map: canonical_name → legacy_name
// ============================================================================

export const TOOL_ALIASES: Record<string, string> = {
  // shell_* — subprocess execution
  shell_exec:    'bash',
  shell_git:     'git',
  shell_docker:  'docker',
  shell_k8s:     'kubernetes',
  shell_process: 'process',

  // file_* — filesystem operations
  file_read:     'view_file',
  file_write:    'create_file',
  file_edit:     'str_replace_editor',

  // browser_* — web / browser
  browser_search: 'web_search',
  browser_fetch:  'web_fetch',
  browser_control:'browser',
  browser_screen: 'screenshot',

  // search_* — code intelligence
  search_code:        'search',
  search_symbol:      'find_symbols',
  search_refs:        'find_references',
  search_definition:  'find_definition',
  search_multi:       'search_multi',  // already has prefix

  // agent_* — agent capabilities
  agent_reason:       'reason',
  agent_ask_human:    'ask_human',
  agent_create_skill: 'create_skill',
  agent_skill_search: 'skill_discover',
  agent_device:       'device_manage',

  // todo_* (already prefixed, kept for completeness)
  todo_attention:     'todo_update',
  context_restore:    'restore_context',
};

/** Reverse map: legacy_name → canonical_name */
export const CANONICAL_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_ALIASES).map(([canonical, legacy]) => [legacy, canonical])
);

// ============================================================================
// AliasITool — lightweight wrapper that delegates to the primary tool
// ============================================================================

class AliasITool implements ITool {
  readonly name: string;
  private primary: ITool;

  constructor(aliasName: string, primaryTool: ITool) {
    this.name = aliasName;
    this.primary = primaryTool;
  }

  get metadata(): IToolMetadata {
    return {
      ...this.primary.metadata,
      name: this.name,
      description: `[alias → ${this.primary.name}] ${this.primary.metadata.description}`,
      tags: [...(this.primary.metadata.tags ?? []), 'alias'],
    };
  }

  get schema(): ToolSchema {
    return {
      ...this.primary.schema,
      name: this.name,
      description: `[alias → ${this.primary.name}] ${this.primary.schema.description ?? ''}`,
    };
  }

  validate(input: unknown): { valid: boolean; errors?: string[] } {
    return this.primary.validate(input);
  }

  async execute(input: unknown, context: IToolExecutionContext): Promise<IToolExecutionResult> {
    return this.primary.execute(input, context);
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Given a list of registered tools, build alias ITool wrappers for each
 * entry in TOOL_ALIASES that points to an existing primary tool.
 *
 * Aliases that point to missing primaries are silently skipped.
 */
export function createAliasTools(primaryTools: ITool[]): ITool[] {
  const byName = new Map<string, ITool>(primaryTools.map(t => [t.name, t]));
  const aliases: ITool[] = [];

  for (const [canonical, legacy] of Object.entries(TOOL_ALIASES)) {
    const primary = byName.get(legacy);
    if (!primary) continue;
    // Don't create an alias if the canonical name is already registered
    if (byName.has(canonical)) continue;
    aliases.push(new AliasITool(canonical, primary));
  }

  return aliases;
}

/**
 * Resolve a tool name to its canonical prefixed form.
 * Returns the canonical name if a mapping exists, otherwise the original name.
 */
export function toCanonicalName(name: string): string {
  return CANONICAL_NAME[name] ?? name;
}

/**
 * Resolve a canonical tool name to its legacy name (for backward compat lookup).
 * Returns the legacy name if a mapping exists, otherwise the original name.
 */
export function toLegacyName(canonical: string): string {
  return TOOL_ALIASES[canonical] ?? canonical;
}
