/**
 * `/subagent` slash command handler — list / inspect the predefined
 * conversational subagents from `src/agent/subagents.ts`.
 *
 * Why a new slash (not `/agent` or `/agents`):
 * - `/agent` (singular) manages custom file-based agents — different concept
 * - `/agents` (plural) manages MultiAgentSystem V0.4 (WorkflowOrchestrator)
 * - `/subagent` (this) lists the conversational subagents (Explore,
 *   code-reviewer, debugger, etc.) registered in `PREDEFINED_SUBAGENTS`.
 *   Until rc.4 these were spawnable via tool but had no slash surface.
 *
 * Read-only handler: never spawns, never mutates state, never needs an
 * API key. Uses the registry directly. The main agent does the actual
 * spawning via the agent tool.
 */

import { ChatEntry } from '../../agent/codebuddy-agent.js';
import { PREDEFINED_SUBAGENTS, type SubagentConfig } from '../../agent/subagents.js';
import { failureFlag } from '../slash-failure.js';

export interface CommandHandlerResult {
  handled: boolean;
  failed?: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
}

const HELP_TEXT = `Usage: /subagent [action] [args]

Actions:
  list           List all available subagents (default)
  info <name>    Show full details (system prompt preview, tools, restrictions)
  help           Show this help

Subagents are spawned by the main agent via the agent tool. This slash
exists for inspection / discovery — particularly useful for finding
read-only subagents (Explore) when you want to delegate exploration
without risking modification.`;

/**
 * One-line summary of a subagent for the `list` view.
 *
 * Format: `name [model, NrM] — desc...
 *           tools: a, b, c | blocked: x, y`
 */
function formatListEntry(name: string, config: SubagentConfig): string {
  const tools = config.tools && config.tools.length > 0
    ? config.tools.join(', ')
    : '(all)';
  const blocked = config.disallowedTools && config.disallowedTools.length > 0
    ? config.disallowedTools.join(', ')
    : '(none)';
  const model = config.model ?? 'default';
  const maxRounds = config.maxRounds ?? 20;

  // Truncate description to 80 chars for compact list view
  const desc = config.description.length > 80
    ? config.description.slice(0, 77) + '...'
    : config.description;

  return [
    `  ${name}  [${model}, ${maxRounds}r]`,
    `    ${desc}`,
    `    tools: ${tools}`,
    `    blocked: ${blocked}`,
  ].join('\n');
}

/**
 * Detailed view of a single subagent for `info <name>`.
 */
function formatInfo(name: string, config: SubagentConfig): string {
  const lines: string[] = [];
  lines.push(`Subagent: ${name}`);
  lines.push('═'.repeat(50));
  lines.push(`Description: ${config.description}`);
  lines.push(`Model:       ${config.model ?? '(default)'}`);
  lines.push(`Max rounds:  ${config.maxRounds ?? 20}`);
  if (config.timeout !== undefined) {
    lines.push(`Timeout:     ${(config.timeout / 1000).toFixed(0)}s`);
  }
  lines.push('');
  lines.push(`Tools whitelist:    ${config.tools?.join(', ') ?? '(all available)'}`);
  lines.push(`Tools blacklist:    ${config.disallowedTools?.join(', ') ?? '(none)'}`);
  lines.push('');
  // System prompt preview — first 400 chars to keep the slash output readable
  const promptPreview = config.systemPrompt.length > 400
    ? config.systemPrompt.slice(0, 400) + '\n  ... [truncated, ' + config.systemPrompt.length + ' chars total]'
    : config.systemPrompt;
  lines.push('System prompt:');
  lines.push(promptPreview.split('\n').map(l => '  ' + l).join('\n'));
  return lines.join('\n');
}

export function handleSubagent(args: string[]): CommandHandlerResult {
  const action = (args[0] || 'list').trim().toLowerCase();
  let content: string;

  if (action === 'help') {
    content = HELP_TEXT;
  } else if (action === 'info') {
    const targetName = args[1]?.trim();
    if (!targetName) {
      content = `Usage: /subagent info <name>\n\nAvailable: ${Object.keys(PREDEFINED_SUBAGENTS).join(', ')}`;
    } else {
      // Try exact match first, then case-insensitive
      const exact = PREDEFINED_SUBAGENTS[targetName];
      const ciMatch = exact ?? Object.entries(PREDEFINED_SUBAGENTS)
        .find(([k]) => k.toLowerCase() === targetName.toLowerCase())?.[1];
      if (!ciMatch) {
        const available = Object.keys(PREDEFINED_SUBAGENTS).join(', ');
        content = `Subagent "${targetName}" not found.\n\nAvailable: ${available}`;
      } else {
        // Find the canonical name (preserve casing)
        const canonical = exact
          ? targetName
          : Object.entries(PREDEFINED_SUBAGENTS).find(([, v]) => v === ciMatch)?.[0] ?? targetName;
        content = formatInfo(canonical, ciMatch);
      }
    }
  } else if (action === 'list' || action === '') {
    const entries = Object.entries(PREDEFINED_SUBAGENTS);
    if (entries.length === 0) {
      content = 'No subagents registered.';
    } else {
      const lines: string[] = [];
      lines.push(`🤖 Available subagents (${entries.length})`);
      lines.push('═'.repeat(50));
      for (const [name, config] of entries) {
        lines.push(formatListEntry(name, config));
        lines.push('');
      }
      lines.push(`Tip: /subagent info <name> for details · /subagent help for usage`);
      content = lines.join('\n');
    }
  } else {
    content = `Unknown action: ${args[0]}\n\n${HELP_TEXT}`;
  }

  return {
    handled: true,
...failureFlag(content),
    entry: {
      type: 'assistant',
      content,
      timestamp: new Date(),
    },
  };
}
