/**
 * Extra Slash Command Handlers
 *
 * Implements high-value UX slash commands:
 * - /undo - Undo last file changes via CheckpointManager
 * - /diff - Show current uncommitted git changes
 * - /context - Show context window stats (enhanced)
 * - /search - Search codebase with ripgrep
 * - /test - Run project tests
 * - /fix - Auto-fix lint/type errors
 * - /review - Quick code review of staged changes
 */

import { ChatEntry } from '../../agent/codebuddy-agent.js';
import fs from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import path from 'path';
import { failureFlag } from '../slash-failure.js';

export interface CommandHandlerResult {
  handled: boolean;
  failed?: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
}

// ============================================================================
// /undo - Undo last file changes
// ============================================================================

export async function handleUndo(_args: string[]): Promise<CommandHandlerResult> {
  try {
    const { getPersistentCheckpointManager } = await import('../../checkpoints/persistent-checkpoint-manager.js');
    const checkpointManager = getPersistentCheckpointManager();
    const checkpoints = checkpointManager.getCheckpoints();

    if (checkpoints.length === 0) {
      return {
        handled: true,
...failureFlag('No checkpoints available to undo. File changes create automatic checkpoints that can be reverted.'),
        entry: {
          type: 'assistant',
          content: 'No checkpoints available to undo. File changes create automatic checkpoints that can be reverted.',
          timestamp: new Date(),
        },
      };
    }

    // Show what will be reverted
    const lastCheckpoint = checkpoints[checkpoints.length - 1];
    if (!lastCheckpoint) {
      return {
        handled: true,
...failureFlag('No checkpoints available to undo. File changes create automatic checkpoints that can be reverted.'),
        entry: {
          type: 'assistant',
          content: 'No checkpoints available to undo. File changes create automatic checkpoints that can be reverted.',
          timestamp: new Date(),
        },
      };
    }
    const fileList = lastCheckpoint.files
      .map(f => `  - ${path.relative(process.cwd(), f.path)}`)
      .join('\n');

    const previewLines = [
      'Reverting to checkpoint:',
      `  ID: ${lastCheckpoint.id}`,
      `  Description: ${lastCheckpoint.description}`,
      `  Time: ${new Date(lastCheckpoint.timestamp).toLocaleString()}`,
      '',
      'Files to restore:',
      fileList,
      '',
    ];

    // Perform the undo
    const result = checkpointManager.restoreLast();

    if (result.success) {
      const restoredList = result.restored
        .map((f: string) => `  - ${path.relative(process.cwd(), f)}`)
        .join('\n');

      return {
        handled: true,
...failureFlag(previewLines.join('\n') +
            `Undo successful. Files restored:\n${restoredList}`),
        entry: {
          type: 'assistant',
          content: previewLines.join('\n') +
            `Undo successful. Files restored:\n${restoredList}`,
          timestamp: new Date(),
        },
      };
    } else {
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: previewLines.join('\n') +
            `Undo failed: ${result.errors.join(', ')}`,
          timestamp: new Date(),
        },
      };
    }
  } catch (error) {
    return {
      handled: true,
...failureFlag(`Error during undo: ${error instanceof Error ? error.message : String(error)}`),
      entry: {
        type: 'assistant',
        content: `Error during undo: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      },
    };
  }
}

// ============================================================================
// /diff - Show current uncommitted changes
// ============================================================================

export async function handleDiff(_args: string[]): Promise<CommandHandlerResult> {
  try {
    const cwd = process.cwd();

    // Check if we're in a git repository
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'pipe' });
    } catch {
      return {
        handled: true,
...failureFlag('Not inside a git repository.'),
        entry: {
          type: 'assistant',
          content: 'Not inside a git repository.',
          timestamp: new Date(),
        },
      };
    }

    // Get unstaged changes
    let unstagedDiff = '';
    try {
      unstagedDiff = execFileSync('git', ['diff'], { cwd, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    } catch {
      // Ignore errors
    }

    // Get staged changes
    let stagedDiff = '';
    try {
      stagedDiff = execFileSync('git', ['diff', '--cached'], { cwd, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    } catch {
      // Ignore errors
    }

    if (!unstagedDiff && !stagedDiff) {
      return {
        handled: true,
...failureFlag('No uncommitted changes.'),
        entry: {
          type: 'assistant',
          content: 'No uncommitted changes.',
          timestamp: new Date(),
        },
      };
    }

    const sections: string[] = [];

    if (stagedDiff) {
      sections.push('Staged changes (will be committed):\n```diff\n' + truncateOutput(stagedDiff, 3000) + '\n```');
    }

    if (unstagedDiff) {
      sections.push('Unstaged changes:\n```diff\n' + truncateOutput(unstagedDiff, 3000) + '\n```');
    }

    // Get summary stats
    let statsSummary = '';
    try {
      const shortStat = execFileSync('git', ['diff', '--stat'], { cwd, encoding: 'utf-8' });
      const cachedStat = execFileSync('git', ['diff', '--cached', '--stat'], { cwd, encoding: 'utf-8' });
      if (shortStat.trim() || cachedStat.trim()) {
        const statsLines: string[] = [];
        if (cachedStat.trim()) statsLines.push('Staged:\n' + cachedStat.trim());
        if (shortStat.trim()) statsLines.push('Unstaged:\n' + shortStat.trim());
        statsSummary = '\nSummary:\n' + statsLines.join('\n\n');
      }
    } catch {
      // Ignore stat errors
    }

    return {
      handled: true,
...failureFlag(sections.join('\n\n') + (statsSummary ? '\n' + statsSummary : '')),
      entry: {
        type: 'assistant',
        content: sections.join('\n\n') + (statsSummary ? '\n' + statsSummary : ''),
        timestamp: new Date(),
      },
    };
  } catch (error) {
    return {
      handled: true,
...failureFlag(`Error getting diff: ${error instanceof Error ? error.message : String(error)}`),
      entry: {
        type: 'assistant',
        content: `Error getting diff: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      },
    };
  }
}

// ============================================================================
// /context-stats - Show context window statistics
// ============================================================================

export async function handleContextStats(
  _args: string[],
  agent?: {
    getContextStats: () => unknown;
    formatContextStats: () => string;
    getCurrentModel: () => string;
    getContextMemoryMetrics?: () => {
      summaryCount: number;
      summaryTokens: number;
      peakMessageCount: number;
      compressionCount: number;
      totalTokensSaved: number;
      lastCompressionTime: Date | null;
      warningsTriggered: number;
    };
    getCompressionStats?: () => {
      totalCompressions: number;
      totalTokensSaved: number;
      averageCompressionRatio: number;
      lastCompression: Date | null;
      archivesAvailable: number;
      lastStrategiesUsed: string[];
    };
    getContextBudgetBreakdown?: () => Record<string, { chars: number; tokens: number; percent: number }>;
  }
): Promise<CommandHandlerResult> {
  if (!agent) {
    return {
      handled: true,
...failureFlag('Context stats are only available when an agent is active.'),
      entry: {
        type: 'assistant',
        content: 'Context stats are only available when an agent is active.',
        timestamp: new Date(),
      },
    };
  }

  try {
    const stats = agent.getContextStats() as {
      totalTokens: number;
      maxTokens: number;
      messageCount: number;
      usagePercent: number;
      isCritical: boolean;
      isNearLimit: boolean;
      summarizedSessions: number;
    };

    const model = agent.getCurrentModel();
    const status = stats.isCritical ? 'CRITICAL' : stats.isNearLimit ? 'WARNING' : 'OK';
    const statusIcon = stats.isCritical ? '[!]' : stats.isNearLimit ? '[~]' : '[+]';

    const bar = createProgressBar(stats.usagePercent, 30);

    const lines = [
      'Context Window Statistics',
      '='.repeat(50),
      '',
      `  Model:           ${model}`,
      `  Status:          ${statusIcon} ${status}`,
      '',
      `  Tokens Used:     ${stats.totalTokens.toLocaleString()}`,
      `  Max Tokens:      ${stats.maxTokens.toLocaleString()}`,
      `  Usage:           ${stats.usagePercent.toFixed(1)}%`,
      `  ${bar}`,
      '',
      `  Messages:        ${stats.messageCount}`,
      `  Summarized:      ${stats.summarizedSessions}`,
    ];

    // Memory metrics section
    if (agent.getContextMemoryMetrics) {
      try {
        const mem = agent.getContextMemoryMetrics();
        lines.push(
          '',
          '-'.repeat(50),
          'Memory Metrics',
          '-'.repeat(50),
          '',
          `  Summaries Stored:    ${mem.summaryCount}`,
          `  Summary Tokens:      ${mem.summaryTokens.toLocaleString()}`,
          `  Peak Messages:       ${mem.peakMessageCount}`,
          `  Warnings Triggered:  ${mem.warningsTriggered}`,
        );
      } catch {
        // Memory metrics not available — skip silently
      }
    }

    // Compression stats section
    if (agent.getCompressionStats) {
      try {
        const comp = agent.getCompressionStats();
        lines.push(
          '',
          '-'.repeat(50),
          'Compression Statistics',
          '-'.repeat(50),
          '',
          `  Total Compressions:  ${comp.totalCompressions}`,
          `  Total Tokens Saved:  ${comp.totalTokensSaved.toLocaleString()}`,
          `  Avg Ratio:           ${comp.averageCompressionRatio.toFixed(2)}x`,
          `  Archives Available:  ${comp.archivesAvailable}`,
          `  Last Compression:    ${comp.lastCompression ? comp.lastCompression.toISOString() : 'Never'}`,
          `  Last Strategies:     ${comp.lastStrategiesUsed.length > 0 ? comp.lastStrategiesUsed.join(', ') : 'None'}`,
        );
      } catch {
        // Compression stats not available — skip silently
      }
    }

    // Budget breakdown section
    if (agent.getContextBudgetBreakdown) {
      try {
        const breakdown = agent.getContextBudgetBreakdown();
        const entries = Object.entries(breakdown).sort((a, b) => b[1].percent - a[1].percent);
        if (entries.length > 0) {
          lines.push(
            '',
            '-'.repeat(50),
            'Budget Breakdown by Layer',
            '-'.repeat(50),
            '',
          );
          for (const [layer, info] of entries) {
            const label = layer.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const layerBar = createProgressBar(info.percent, 20);
            lines.push(`  ${label.padEnd(20)} ${info.tokens.toLocaleString().padStart(8)} tok  ${layerBar}`);
          }
        }
      } catch {
        // Budget breakdown not available — skip silently
      }
    }

    lines.push(
      '',
      '='.repeat(50),
      '',
      'Tip: Use /compact to compress conversation history.',
    );

    return {
      handled: true,
...failureFlag(lines.join('\n')),
      entry: {
        type: 'assistant',
        content: lines.join('\n'),
        timestamp: new Date(),
      },
    };
  } catch (error) {
    // Fallback to formatContextStats
    try {
      const formatted = agent.formatContextStats();
      return {
        handled: true,
...failureFlag(formatted),
        entry: {
          type: 'assistant',
          content: formatted,
          timestamp: new Date(),
        },
      };
    } catch {
      return {
        handled: true,
...failureFlag(`Error getting context stats: ${error instanceof Error ? error.message : String(error)}`),
        entry: {
          type: 'assistant',
          content: `Error getting context stats: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date(),
        },
      };
    }
  }
}

// ============================================================================
// /search - Search codebase
// ============================================================================

export async function handleSearch(args: string[]): Promise<CommandHandlerResult> {
  const query = args.join(' ').trim();

  if (!query) {
    return {
      handled: true,
...failureFlag('Usage: /search <query>\n\nSearch the codebase for a text pattern.\n\nExamples:\n  /search TODO\n  /search function handleSubmit\n  /search import.*express'),
      entry: {
        type: 'assistant',
        content: 'Usage: /search <query>\n\nSearch the codebase for a text pattern.\n\nExamples:\n  /search TODO\n  /search function handleSubmit\n  /search import.*express',
        timestamp: new Date(),
      },
    };
  }

  try {
    const cwd = process.cwd();
    let output = '';

    // Explicit `.` path: without one, ripgrep searches stdin whenever stdin is
    // not a TTY (every non-interactive spawn), so real matches were reported as
    // "No matches" (status 1).
    const rgResult = runCommand(
      'rg',
      ['--line-number', '--no-heading', '--color=never', '--max-count=20', '--', query, '.'],
      { cwd, timeoutMs: 10000 }
    );

    if (rgResult.success) {
      output = rgResult.output;
    } else if (rgResult.status === 1) {
      return {
        handled: true,
...failureFlag(`No matches found for: ${query}`),
        entry: {
          type: 'assistant',
          content: `No matches found for: ${query}`,
          timestamp: new Date(),
        },
      };
    } else {
      const gitGrepResult = runCommand(
        'git',
        ['grep', '-n', '-I', '-m', '20', '-e', query, '--', '.'],
        { cwd, timeoutMs: 10000 }
      );

      if (gitGrepResult.success) {
        output = gitGrepResult.output;
      } else if (gitGrepResult.status === 1) {
        return {
          handled: true,
...failureFlag(`No matches found for: ${query}`),
          entry: {
            type: 'assistant',
            content: `No matches found for: ${query}`,
            timestamp: new Date(),
          },
        };
      } else {
        throw new Error(rgResult.output || gitGrepResult.output || 'Search tool not available');
      }
    }

    if (!output.trim()) {
      return {
        handled: true,
...failureFlag(`No matches found for: ${query}`),
        entry: {
          type: 'assistant',
          content: `No matches found for: ${query}`,
          timestamp: new Date(),
        },
      };
    }

    // Format output - truncate long lines and limit total output
    const lines = output.trim().split('\n');
    const formattedLines = lines.slice(0, 20).map(line => {
      if (line.length > 200) {
        return line.substring(0, 200) + '...';
      }
      return line;
    });

    const totalLabel = lines.length > 20 ? ` (showing first 20 of ${lines.length})` : '';

    return {
      handled: true,
...failureFlag(`Search results for "${query}"${totalLabel}:\n\n\`\`\`\n${formattedLines.join('\n')}\n\`\`\``),
      entry: {
        type: 'assistant',
        content: `Search results for "${query}"${totalLabel}:\n\n\`\`\`\n${formattedLines.join('\n')}\n\`\`\``,
        timestamp: new Date(),
      },
    };
  } catch (error) {
    return {
      handled: true,
...failureFlag(`Search error: ${error instanceof Error ? error.message : String(error)}`),
      entry: {
        type: 'assistant',
        content: `Search error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      },
    };
  }
}

// ============================================================================
// /test - Run tests
// ============================================================================

export async function handleTest(args: string[]): Promise<CommandHandlerResult> {
  const file = args.join(' ').trim();

  try {
    const cwd = process.cwd();

    // Detect test framework
    let output = '';
    const testArgs = file ? ['test', '--', file] : ['test'];
    const result = spawnSync('npm', testArgs, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 5 * 1024 * 1024,
      timeout: 120000, // 2 minute timeout
      env: { ...process.env, FORCE_COLOR: '0', CI: 'true' },
    });

    if (result.stdout) {
      output += result.stdout;
    }
    if (result.stderr) {
      output += `${output ? '\n' : ''}${result.stderr}`;
    }
    if (!output && result.error) {
      output = result.error.message;
    }

    const truncated = truncateOutput(output.trim(), 5000);

    return {
      handled: true,
...failureFlag(`Test results${file ? ` for ${file}` : ''}:\n\n\`\`\`\n${truncated}\n\`\`\``),
      entry: {
        type: 'assistant',
        content: `Test results${file ? ` for ${file}` : ''}:\n\n\`\`\`\n${truncated}\n\`\`\``,
        timestamp: new Date(),
      },
    };
  } catch (error) {
    return {
      handled: true,
...failureFlag(`Error running tests: ${error instanceof Error ? error.message : String(error)}`),
      entry: {
        type: 'assistant',
        content: `Error running tests: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      },
    };
  }
}

// ============================================================================
// /fix - Auto-fix lint/type errors
// ============================================================================

export async function handleFix(_args: string[]): Promise<CommandHandlerResult> {
  try {
    const cwd = process.cwd();
    const results: string[] = [];
    const targets = collectFixTargets(cwd);

    if (targets.length === 0) {
      results.push('ESLint: No changed JS/TS files found. Pass files explicitly or stage changes first.');
    } else {
      const limitedTargets = targets.slice(0, 25);
      const eslintResult = runCommand(
        getNpxCommand(),
        ['eslint', '--fix', '--cache', '--', ...limitedTargets],
        {
          cwd,
          timeoutMs: 15000,
          env: { ...process.env, FORCE_COLOR: '0' },
        }
      );

      if (eslintResult.success) {
        if (eslintResult.output) {
          results.push('ESLint auto-fix:\n```\n' + truncateOutput(eslintResult.output, 2000) + '\n```');
        } else {
          results.push(`ESLint: Auto-fix completed for ${limitedTargets.length} file(s).`);
        }
      } else if (eslintResult.timedOut) {
        results.push(
          `ESLint: Timed out after 15s while checking ${limitedTargets.length} file(s). ` +
          'Run `npm run lint:fix` for a full repository pass.'
        );
      } else if (eslintResult.output) {
        results.push('ESLint results:\n```\n' + truncateOutput(eslintResult.output, 2000) + '\n```');
      } else {
        results.push('ESLint: Not available or no configuration found.');
      }
    }

    const hasTypeScriptTargets = targets.some(target => /\.(cts|mts|ts|tsx)$/.test(target));
    if (hasTypeScriptTargets) {
      if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
        results.push(
          'TypeScript: Quick fix mode skips a full project typecheck to stay responsive. ' +
          'Run `npm run typecheck` for complete validation.'
        );
      } else {
        results.push('TypeScript: No tsconfig.json found.');
      }
    } else {
      results.push('TypeScript: No changed TS files found.');
    }

    return {
      handled: true,
...failureFlag(results.join('\n\n')),
      entry: {
        type: 'assistant',
        content: results.join('\n\n'),
        timestamp: new Date(),
      },
    };
  } catch (error) {
    return {
      handled: true,
...failureFlag(`Error running fix: ${error instanceof Error ? error.message : String(error)}`),
      entry: {
        type: 'assistant',
        content: `Error running fix: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      },
    };
  }
}

// ============================================================================
// /review - Quick code review of staged changes
// ============================================================================

export async function handleReview(_args: string[]): Promise<CommandHandlerResult> {
  try {
    const cwd = process.cwd();

    // Try staged changes first, fall back to unstaged
    let diff = '';
    let diffSource = '';

    try {
      diff = execFileSync('git', ['diff', '--cached'], { cwd, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
      if (diff.trim()) {
        diffSource = 'staged changes';
      }
    } catch {
      // Ignore
    }

    if (!diff.trim()) {
      try {
        diff = execFileSync('git', ['diff'], { cwd, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
        if (diff.trim()) {
          diffSource = 'unstaged changes';
        }
      } catch {
        // Ignore
      }
    }

    if (!diff.trim()) {
      return {
        handled: true,
...failureFlag('No changes to review. Stage changes with `git add` or make modifications first.'),
        entry: {
          type: 'assistant',
          content: 'No changes to review. Stage changes with `git add` or make modifications first.',
          timestamp: new Date(),
        },
      };
    }

    // Build a review prompt to send to the AI
    const reviewPrompt = `Please review the following ${diffSource} and provide feedback:

\`\`\`diff
${truncateOutput(diff.trim(), 8000)}
\`\`\`

Provide a structured code review covering:
1. Summary of changes
2. Issues found (bugs, security, performance)
3. Suggestions for improvement
4. Overall assessment`;

    return {
      handled: true,
      passToAI: true,
      prompt: reviewPrompt,
    };
  } catch (error) {
    return {
      handled: true,
...failureFlag(`Error getting changes for review: ${error instanceof Error ? error.message : String(error)}`),
      entry: {
        type: 'assistant',
        content: `Error getting changes for review: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      },
    };
  }
}

// ============================================================================
// Utility functions
// ============================================================================

function truncateOutput(output: string, maxLength: number): string {
  if (output.length <= maxLength) {
    return output;
  }
  const halfLen = Math.floor(maxLength / 2) - 20;
  return output.substring(0, halfLen) + '\n\n... (truncated) ...\n\n' + output.substring(output.length - halfLen);
}

function createProgressBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '[' + '#'.repeat(filled) + '-'.repeat(empty) + '] ' + percent.toFixed(1) + '%';
}

interface RunCommandOptions {
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

interface RunCommandResult {
  output: string;
  status: number | null;
  success: boolean;
  timedOut: boolean;
}

function runCommand(
  command: string,
  args: string[],
  { cwd, timeoutMs, env }: RunCommandOptions
): RunCommandResult {
  const result = spawnSync(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    maxBuffer: 5 * 1024 * 1024,
    timeout: timeoutMs,
    env,
    windowsHide: true,
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const errorMessage = result.error instanceof Error ? result.error.message : '';
  const output = [stdout.trim(), stderr.trim(), errorMessage.trim()].filter(Boolean).join('\n').trim();
  const timedOut =
    result.signal === 'SIGTERM' ||
    (result.error instanceof Error &&
      'code' in result.error &&
      (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT');

  return {
    output,
    status: result.status,
    success: result.status === 0 && !result.error,
    timedOut,
  };
}

function getNpxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function collectFixTargets(cwd: string): string[] {
  const supportedExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
  const changedFiles = new Set<string>();

  const commands: Array<[string, string[]]> = [
    ['git', ['diff', '--name-only', '--cached', '--diff-filter=ACMRTUXB']],
    ['git', ['diff', '--name-only', '--diff-filter=ACMRTUXB']],
    ['git', ['ls-files', '--others', '--exclude-standard']],
  ];

  for (const [command, args] of commands) {
    const result = runCommand(command, args, {
      cwd,
      timeoutMs: 3000,
    });

    if (!result.success && result.status !== 1) {
      continue;
    }

    for (const line of result.output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const fullPath = path.resolve(cwd, trimmed);
      if (!fs.existsSync(fullPath)) {
        continue;
      }

      if (!supportedExtensions.has(path.extname(trimmed).toLowerCase())) {
        continue;
      }

      changedFiles.add(trimmed);
    }
  }

  return Array.from(changedFiles).sort();
}
