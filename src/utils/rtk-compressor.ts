/**
 * RTK (Rust Token Killer) Command Proxy
 *
 * Integrates with the RTK CLI proxy to reduce LLM token consumption by 60-90%
 * on common dev commands (git, npm, ls, grep, test, etc.).
 * RTK wraps commands as `rtk <subcommand>` to filter and compress output
 * before it reaches the LLM context window.
 *
 * Falls back gracefully when RTK is not installed.
 *
 * @see https://github.com/rtk-ai/rtk
 */

import { execSync } from 'child_process';
import { logger } from './logger.js';

// Cache RTK availability check
let rtkAvailable: boolean | null = null;

/**
 * Check if the RTK binary is available on the system
 */
export function isRTKAvailable(): boolean {
  if (rtkAvailable !== null) return rtkAvailable;

  try {
    execSync('which rtk', { stdio: 'ignore' });
    rtkAvailable = true;
  } catch {
    rtkAvailable = false;
  }

  return rtkAvailable;
}

/**
 * Reset the cached availability check (useful for testing)
 */
export function resetRTKCache(): void {
  rtkAvailable = null;
}

/**
 * Commands that RTK supports as direct subcommands.
 * Maps the first token of a bash command to an RTK subcommand.
 * Note: `npm` is excluded — `rtk npm` only handles `npm run`, not `npm list/install/etc.`
 */
const RTK_SUPPORTED_COMMANDS = new Set([
  'ls', 'tree', 'git', 'gh', 'npx', 'pnpm',
  'grep', 'find', 'curl', 'wget', 'docker', 'kubectl',
  'cargo', 'pip', 'pytest', 'ruff', 'go', 'golangci-lint',
  'tsc', 'prettier', 'vitest', 'prisma',
  'playwright',
]);

/**
 * Commands that require special handling (only certain subcommands are supported)
 */
const RTK_CONDITIONAL_COMMANDS: Record<string, (args: string) => boolean> = {
  // `rtk npm` only handles `npm run <script>`, not `npm list`, `npm install`, etc.
  'npm': (args) => /^run\b/.test(args),
  // `rtk next` only handles `next build`
  'next': (args) => /^build\b/.test(args),
};

/**
 * Commands where RTK wrapping should be skipped (interactive, editors, etc.)
 */
const RTK_SKIP_PATTERNS = [
  /^(nano|vim|vi|emacs|code|less|more|man)\b/,
  /^(ssh|scp|rsync)\b/,
  /^(sudo|su)\b/,
  /\|\s*head\b/, // already piped/truncated
  /\|\s*tail\b/,
  /\|\s*less\b/,
  /\|\s*wc\b/,
  /\|\s*rtk\b/, // already using rtk
  /^rtk\b/,     // already prefixed
];

/**
 * Try to wrap a bash command with RTK for token-optimized output.
 * Returns the modified command if RTK can handle it, or the original command otherwise.
 */
export function wrapWithRTK(command: string): string {
  if (!isRTKAvailable()) return command;

  const trimmed = command.trim();

  // Skip patterns that shouldn't be wrapped
  for (const pattern of RTK_SKIP_PATTERNS) {
    if (pattern.test(trimmed)) return command;
  }

  // Extract the base command and remaining args
  const parts = trimmed.split(/\s+/);
  const firstToken = parts[0];
  const restArgs = parts.slice(1).join(' ');

  // Check direct support
  if (RTK_SUPPORTED_COMMANDS.has(firstToken)) {
    return `rtk ${trimmed}`;
  }

  // Check conditional support (command-specific subcommand filtering)
  const conditionalCheck = RTK_CONDITIONAL_COMMANDS[firstToken];
  if (conditionalCheck && conditionalCheck(restArgs)) {
    return `rtk ${trimmed}`;
  }

  return command;
}

/**
 * Check if a command can benefit from RTK wrapping
 */
export function isRTKCompatible(command: string): boolean {
  const trimmed = command.trim();

  for (const pattern of RTK_SKIP_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  const parts = trimmed.split(/\s+/);
  const firstToken = parts[0];

  if (RTK_SUPPORTED_COMMANDS.has(firstToken)) return true;

  const conditionalCheck = RTK_CONDITIONAL_COMMANDS[firstToken];
  if (conditionalCheck) {
    return conditionalCheck(parts.slice(1).join(' '));
  }

  return false;
}

export interface CompressionStats {
  originalTokens: number;
  compressedTokens: number;
  ratio: number;
}

/**
 * Estimate compression stats between original and compressed output.
 * Uses a simple whitespace-split token approximation.
 */
export function getCompressionStats(original: string, compressed: string): CompressionStats {
  const originalTokens = estimateTokens(original);
  const compressedTokens = estimateTokens(compressed);
  const ratio = originalTokens > 0 ? 1 - (compressedTokens / originalTokens) : 0;

  return { originalTokens, compressedTokens, ratio };
}

/**
 * Rough token count estimate (~4 chars per token, similar to GPT tokenizer average)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
