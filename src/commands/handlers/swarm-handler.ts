/**
 * `/swarm <task>` slash command — UX wrapper around the MultiAgentSystem.
 *
 * Inspired by the "Swarms" mode that Korben described for Claude Code
 * (https://korben.info/claude-code-activer-mode-swarms-cache.html).
 * That mode requires patching the Claude Code CLI with `claude-sneakpeek`
 * to flip a hidden feature flag (`tengu_brass_pebble`). Code Buddy doesn't
 * need a patch — `MultiAgentSystem` (V0.4) + `WorkflowOrchestrator` +
 * `ParallelSubagentRunner` already provide the team-lead pattern; they
 * were just hidden behind a verbose `/agents enable && /agents strategy
 * parallel && /agents run <task>` sequence.
 *
 * `/swarm <task>` is a thin wrapper:
 *   1. Saves the user's current default strategy.
 *   2. Forces strategy = 'parallel' (closest analog to Korben's "swarm").
 *   3. Delegates to `handleAgents(['run', task])` which auto-enables
 *      MultiAgentSystem and dispatches via WorkflowOrchestrator.
 *   4. Restores the user's previous strategy in a finally block.
 *   5. Wraps the output with a thematic banner + footer hints so the
 *      user understands the team-lead pattern is engaged.
 *
 * Sub-actions delegate transparently to /agents:
 *   /swarm <task>  → /agents run <task> (with strategy=parallel override)
 *   /swarm stop    → /agents stop
 *   /swarm status  → /agents status
 *   /swarm help    → built-in help text
 */

import { ChatEntry } from '../../agent/codebuddy-agent.js';
import {
  handleAgents,
  _peekActiveStrategy,
  _setActiveStrategy,
} from './agents-handler.js';

export interface CommandHandlerResult {
  handled: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
}

const SWARM_HELP = `Usage: /swarm <task | stop | status | help>

🐝 Swarm mode — turn the agent into a team lead.

Instead of having a single agent code your task, /swarm activates the
MultiAgentSystem, decomposes the task into parallel subtasks, and
dispatches them to specialized worker agents (orchestrator, coder,
reviewer, tester) running concurrently via the WorkflowOrchestrator.

Examples:
  /swarm refactor the auth module to use JWT with PKCE
  /swarm scan the codebase for security issues and write a report
  /swarm add Stripe integration with full tests
  /swarm status        # see what the team is working on
  /swarm stop          # interrupt the active workflow

Under the hood:
  - Auto-enables MultiAgentSystem (idempotent)
  - Forces strategy=parallel for this run (restored after)
  - Delegates to /agents run <task>
  - Headless (buddy -p) waits for the team to finish and prints the report
  - Interactive TUI is fire-and-forget; track progress with /swarm status

Inspired by Korben's article on Claude Code's hidden Swarms mode
(korben.info/claude-code-activer-mode-swarms-cache.html). Code Buddy
exposes the same team-lead pattern without needing a CLI patch — the
infrastructure has been there since V0.4 (multi_agent_system module).

Related slashes:
  /agents enable|run|plan|stop|status — fine-grained control
  /subagent list                       — inspect available subagents
  /fleet listen                        — observe a peer Claude
`;

function textResult(content: string): CommandHandlerResult {
  return {
    handled: true,
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}

export async function handleSwarm(args: string[]): Promise<CommandHandlerResult> {
  const action = args[0]?.trim().toLowerCase() ?? '';

  // Help action OR no args → show usage. We do NOT auto-spawn on bare
  // /swarm because that would be too easy to trigger by accident.
  if (action === '' || action === 'help' || action === '--help' || action === '-h') {
    return textResult(SWARM_HELP);
  }

  // Pure pass-through actions to /agents — no strategy override needed.
  if (action === 'stop') {
    return handleAgents(['stop']);
  }
  if (action === 'status') {
    return handleAgents(['status']);
  }

  // Default: treat all args as the task description.
  const task = args.join(' ').trim();
  if (!task) {
    return textResult(SWARM_HELP);
  }

  // Save + restore strategy around the run so we don't permanently
  // override the user's preference set via /agents strategy.
  const previousStrategy = _peekActiveStrategy();
  _setActiveStrategy('parallel');

  try {
    const result = await handleAgents(['run', task]);

    const banner =
      `🐝 Swarm spawning for: ${task}\n` +
      `   Strategy: parallel (override) · Workers: see /swarm status\n` +
      '─'.repeat(50) + '\n\n';

    const footer =
      '\n\n💡 Tip: /swarm status for live progress · /agents metrics for cost breakdown';

    if (result.entry?.content) {
      result.entry.content = banner + result.entry.content + footer;
    }
    return result;
  } finally {
    _setActiveStrategy(previousStrategy);
  }
}
