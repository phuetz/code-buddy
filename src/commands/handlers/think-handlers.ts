/**
 * Think Command Handlers
 *
 * Implements /think slash command for Tree-of-Thought reasoning.
 * Supports: /think [level] [problem], /think status, /think off
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import {
  ThinkingMode,
  THINKING_MODE_CONFIG,
  ReasoningResult,
  Problem,
} from '../../agent/reasoning/types.js';
import {
  getTreeOfThoughtReasoner,
  TreeOfThoughtReasoner,
} from '../../agent/reasoning/tree-of-thought.js';

// ── Module-level state ──────────────────────────────────────────────────

let activeThinkingMode: ThinkingMode | null = null;
let lastResult: ReasoningResult | null = null;
let lastResultTimestamp: number | null = null;

// ── Public accessors ────────────────────────────────────────────────────

/**
 * Get the currently active thinking mode (null = off).
 */
export function getActiveThinkingMode(): ThinkingMode | null {
  return activeThinkingMode;
}

/**
 * Set the active thinking mode programmatically.
 * Pass `null` to disable reasoning mode.
 */
export function setActiveThinkingMode(mode: ThinkingMode | null): void {
  activeThinkingMode = mode;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const VALID_MODES: readonly ThinkingMode[] = [
  'shallow',
  'medium',
  'deep',
  'exhaustive',
];

function isThinkingMode(value: string): value is ThinkingMode {
  return (VALID_MODES as readonly string[]).includes(value);
}

function formatModeConfig(mode: ThinkingMode): string {
  const cfg = THINKING_MODE_CONFIG[mode];
  return [
    `  Mode:           ${mode}`,
    `  Max iterations: ${cfg.maxIterations ?? '—'}`,
    `  Max depth:      ${cfg.maxDepth ?? '—'}`,
    `  Expansion:      ${cfg.expansionCount ?? '—'} children/node`,
  ].join('\n');
}

function formatStatsBlock(result: ReasoningResult, ts: number): string {
  const elapsed = ((Date.now() - ts) / 1000).toFixed(0);
  return [
    `  Status:          ${result.success ? 'Solution found' : 'No solution'}`,
    `  Iterations:      ${result.stats.iterations}`,
    `  Nodes created:   ${result.stats.nodesCreated}`,
    `  Nodes evaluated: ${result.stats.nodesEvaluated}`,
    `  Nodes refined:   ${result.stats.nodesRefined}`,
    `  Max depth:       ${result.stats.maxDepthReached}`,
    `  Best score:      ${result.stats.bestScore.toFixed(2)}`,
    `  Run time:        ${(result.stats.totalTime / 1000).toFixed(2)}s`,
    `  Completed:       ${elapsed}s ago`,
  ].join('\n');
}

function buildHelpText(): string {
  return [
    'Usage:',
    '  /think                 Show current mode and help',
    '  /think off             Disable reasoning mode',
    '  /think shallow         Quick single-pass reasoning',
    '  /think medium          Moderate exploration (default)',
    '  /think deep            Thorough tree search',
    '  /think exhaustive      Full MCTS exploration',
    '  /think status          Show config and last result stats',
    '  /think <problem>       Run Tree-of-Thought on the given problem',
    '',
    `Current mode: ${activeThinkingMode ?? 'off'}`,
  ].join('\n');
}

// ── Main handler ────────────────────────────────────────────────────────

/**
 * Handle the /think slash command.
 *
 * @param args - Tokenised arguments after `/think`
 * @returns CommandHandlerResult with formatted output
 */
export async function handleThink(
  args: string[],
): Promise<CommandHandlerResult> {
  // /think (no args) → show help
  if (args.length === 0) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: buildHelpText(),
        timestamp: new Date(),
      },
    };
  }

  const first = args[0].toLowerCase();

  // ── /think off ──────────────────────────────────────────────────────
  if (first === 'off') {
    activeThinkingMode = null;
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'Reasoning mode disabled.',
        timestamp: new Date(),
      },
    };
  }

  // ── /think status ───────────────────────────────────────────────────
  if (first === 'status') {
    let content = `Reasoning mode: ${activeThinkingMode ?? 'off'}\n`;

    if (activeThinkingMode) {
      content += '\nConfiguration:\n';
      content += formatModeConfig(activeThinkingMode);
    }

    if (lastResult && lastResultTimestamp) {
      content += '\n\nLast result:\n';
      content += formatStatsBlock(lastResult, lastResultTimestamp);
    } else {
      content += '\n\nNo reasoning runs yet this session.';
    }

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content,
        timestamp: new Date(),
      },
    };
  }

  // ── /think <mode> [problem?] ────────────────────────────────────────
  if (isThinkingMode(first)) {
    activeThinkingMode = first;

    // If there is additional text after the mode, treat it as a problem
    const problemText = args.slice(1).join(' ').trim();
    if (problemText.length > 0) {
      return runReasoning(problemText);
    }

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: [
          `Reasoning mode set to: ${first}`,
          '',
          formatModeConfig(first),
          '',
          'All subsequent complex queries will use this reasoning depth.',
          'Use /think off to disable.',
        ].join('\n'),
        timestamp: new Date(),
      },
    };
  }

  // ── /think <problem text> ───────────────────────────────────────────
  const problemText = args.join(' ').trim();
  if (problemText.length > 0) {
    return runReasoning(problemText);
  }

  return {
    handled: true,
    entry: {
      type: 'assistant',
      content: buildHelpText(),
      timestamp: new Date(),
    },
  };
}

// ── Run reasoning ───────────────────────────────────────────────────────

async function runReasoning(
  problemText: string,
): Promise<CommandHandlerResult> {
  const mode = activeThinkingMode ?? 'medium';
  const apiKey = process.env.GROK_API_KEY ?? '';
  const baseURL = process.env.GROK_BASE_URL;

  if (!apiKey) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'Error: GROK_API_KEY is not set. Cannot run reasoning.',
        timestamp: new Date(),
      },
    };
  }

  const reasoner: TreeOfThoughtReasoner = getTreeOfThoughtReasoner(
    apiKey,
    baseURL,
    { mode },
  );
  reasoner.setMode(mode);

  const problem: Problem = {
    description: problemText,
  };

  try {
    // For shallow mode use quick chain-of-thought; otherwise full ToT
    if (mode === 'shallow') {
      const cotResult = await reasoner.chainOfThought(problem);

      let output = '=== Chain-of-Thought Reasoning ===\n\n';
      for (const step of cotResult.steps) {
        output += `Step ${step.step}: ${step.thought}\n`;
        if (step.action) {
          output += `  Action: ${step.action}\n`;
        }
        if (step.observation) {
          output += `  Observation: ${step.observation}\n`;
        }
        output += '\n';
      }
      output += `Final Answer: ${cotResult.finalAnswer}\n`;
      output += `Confidence: ${(cotResult.confidence * 100).toFixed(0)}%\n`;

      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: output,
          timestamp: new Date(),
        },
      };
    }

    const result = await reasoner.solve(problem);
    lastResult = result;
    lastResultTimestamp = Date.now();

    const formatted = reasoner.formatResult(result);

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: formatted,
        timestamp: new Date(),
      },
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error);
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Reasoning failed: ${message}`,
        timestamp: new Date(),
      },
    };
  }
}
