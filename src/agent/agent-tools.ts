/** Strict allowlist parsing shared by agent loaders and external imports. */
import { TOOL_ALIASES } from '../tools/registry/tool-alias-map.js';

const CLAUDE_TOOLS: Record<string, string> = {
  Read: TOOL_ALIASES.file_read!, Write: TOOL_ALIASES.file_write!, Edit: TOOL_ALIASES.file_edit!,
  Bash: TOOL_ALIASES.shell_exec!, Grep: TOOL_ALIASES.search_code!, Glob: TOOL_ALIASES.search_code!,
  WebFetch: 'web_fetch', WebSearch: 'web_search',
  TodoWrite: 'todo_update', AskUserQuestion: 'ask_human',
};

export function parseAgentTools(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const tools = typeof value === 'string' ? value.split(',').map(t => t.trim()) : value;
  if (!Array.isArray(tools) || tools.some(t => typeof t !== 'string' || !/^!?[A-Za-z*?][\w.*?:-]*$/.test(t))) {
    throw new Error('Unreadable agent tool allowlist');
  }
  return [...new Set((tools as string[]).map(t => Object.hasOwn(CLAUDE_TOOLS, t) ? CLAUDE_TOOLS[t]! : t))];
}

/** External Claude tools must have an explicit mapping; unknowns fail closed. */
export function translateClaudeTools(value: unknown): string[] {
  const raw = typeof value === 'string' ? value.split(',').map(t => t.trim()) : value;
  if (!Array.isArray(raw) || raw.some(t => typeof t !== 'string' || !Object.hasOwn(CLAUDE_TOOLS, t))) {
    throw new Error('Missing, unreadable or unsupported Claude tool allowlist');
  }
  return parseAgentTools(raw)!;
}

/** Policy equivalence includes the persistent shell; prototype keys are never aliases. */
export function resolveAgentTool(name: string): string {
  if (name === 'interactive_shell') return 'bash';
  return Object.hasOwn(TOOL_ALIASES, name) ? TOOL_ALIASES[name]! : name;
}
