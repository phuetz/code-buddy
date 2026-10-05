/**
 * Data only — no logic. The ordered fixed tool core used when
 * `CODEBUDDY_TOOLS_FIXED` is enabled.
 *
 * This is a product decision, not a relevance hint: the order is part of the
 * prompt prefix, so it must stay byte-stable across turns for the provider's
 * prompt cache to hit. Names absent from the available set (surface profile,
 * `applyToolFilter`, model capability) are dropped, never resurrected — a
 * surface-filtered tool must NEVER come back through the fixed core.
 *
 * The core deliberately omits `tool_search`-discoverable specialists: they
 * remain reachable on demand (the BM25 index covers every assembled tool and
 * `expandCachedTools` adds a discovered tool to the current turn). See
 * `src/agent/execution/tool-selection-strategy.ts`.
 */
export const FIXED_TOOL_CORE: readonly string[] = [
  'view_file',
  'list_directory',
  'search',
  'create_file',
  'str_replace_editor',
  'apply_patch',
  'bash',
  'web_search',
  'tool_search',
  'restore_context',
  'remember',
  'memory_propose',
  'lessons_add',
  'lessons_propose',
  'lessons_search',
  'extension_forge',
];
