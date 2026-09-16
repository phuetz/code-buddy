/**
 * Canonical ↔ legacy tool-name map. Pure data: safe to import from the
 * Cowork renderer (Vite browser bundle). Keep Node-only code — logger,
 * ITool wrappers — in tool-aliases.ts.
 */

export const TOOL_ALIASES: Record<string, string> = {
  // Hermes core names — direct compatibility with NousResearch/hermes-agent
  terminal:     'bash',
  read_file:    'view_file',
  write_file:   'create_file',
  patch:        'str_replace_editor',
  search_files: 'search',
  web_extract:  'web_fetch',

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
