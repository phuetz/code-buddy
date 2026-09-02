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

import type { ITool, IToolExecutionContext, IToolMetadata, ToolSchema } from './types.js';
import type { ToolResult } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { CANONICAL_NAME, TOOL_ALIASES } from './tool-alias-map.js';

export { CANONICAL_NAME, TOOL_ALIASES } from './tool-alias-map.js';

// ============================================================================
// AliasITool — lightweight wrapper that delegates to the primary tool
// ============================================================================

class AliasITool implements ITool {
  readonly name: string;
  readonly description: string;
  private primary: ITool;

  constructor(aliasName: string, primaryTool: ITool) {
    this.name = aliasName;
    this.primary = primaryTool;
    this.description = `[alias → ${primaryTool.name}] ${primaryTool.description}`;
  }

  getMetadata(): IToolMetadata {
    const meta = this.primary.getMetadata?.();
    return {
      ...(meta ?? { name: this.name, description: this.description, category: 'utility' as const, keywords: [], priority: 50 }),
      name: this.name,
      description: this.description,
      keywords: [...(meta?.keywords ?? []), 'alias'],
    };
  }

  getSchema(): ToolSchema {
    const schema = this.primary.getSchema();
    return {
      ...schema,
      name: this.name,
      description: this.description,
    };
  }

  validate(input: unknown): { valid: boolean; errors?: string[] } {
    if (this.primary.validate) return this.primary.validate(input);
    return { valid: true };
  }

  async execute(
    input: Record<string, unknown>,
    context?: IToolExecutionContext,
  ): Promise<ToolResult> {
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
 * Aliases that point to missing primaries are skipped with a warning; the
 * invariant test keeps the alias table honest against the built-in registry.
 */
export function createAliasTools(primaryTools: ITool[]): ITool[] {
  const byName = new Map<string, ITool>(primaryTools.map(t => [t.name, t]));
  const aliases: ITool[] = [];

  for (const [canonical, legacy] of Object.entries(TOOL_ALIASES)) {
    const primary = byName.get(legacy);
    if (!primary) {
      // An alias listed here but pointing nowhere is a promise the registry
      // cannot keep: say it, instead of dropping it in silence (2026-09-02).
      logger.warn(`Tool alias '${canonical}' skipped: primary tool '${legacy}' is not registered`);
      continue;
    }
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
