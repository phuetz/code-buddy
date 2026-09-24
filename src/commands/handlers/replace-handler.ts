/**
 * /replace Slash Command Handler
 *
 * Codebase-wide find & replace across files.
 *
 * Usage:
 *   /replace <search> <replacement> [options]
 *   /replace --dry-run "old text" "new text"
 *   /replace --regex "pattern" "replacement" --glob "*.ts"
 */

import { CommandHandlerResult } from './branch-handlers.js';
import { logger } from '../../utils/logger.js';
import { failureFlag } from '../slash-failure.js';

/**
 * Handle the /replace slash command.
 */
export async function handleReplace(args: string[]): Promise<CommandHandlerResult> {
  // Parse flags
  let dryRun = false;
  let isRegex = false;
  let glob = '**/*';
  let maxFiles = 50;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    switch (arg) {
      case '--dry-run':
      case '-n':
        dryRun = true;
        break;
      case '--regex':
      case '-r':
        isRegex = true;
        break;
      case '--glob':
      case '-g': {
        const next = args[i + 1];
        if (next !== undefined) {
          glob = next;
          i++;
        }
        break;
      }
      case '--max-files': {
        const next = args[i + 1];
        if (next !== undefined) {
          maxFiles = parseInt(next, 10) || 50;
          i++;
        }
        break;
      }
      default:
        positional.push(arg);
    }
  }

  // Need at least search and replacement
  if (positional.length < 2) {
    return {
      handled: true,
...failureFlag(`/replace — Codebase-wide find & replace

Usage:
  /replace <search> <replacement> [options]

Options:
  --dry-run, -n     Preview changes without modifying files
  --regex, -r       Treat search as regex pattern
  --glob, -g <pat>  File glob pattern (default: **/*.*)
  --max-files <n>   Max files to modify (default: 50)

Examples:
  /replace "oldFunction" "newFunction"
  /replace --dry-run "console.log" "logger.info"
  /replace --regex "import\\s*\\{" "import type {" --glob "*.ts"
  /replace "OldClass" "NewClass" --glob "src/**/*.ts"`),
      entry: {
        type: 'assistant',
        content: `/replace — Codebase-wide find & replace

Usage:
  /replace <search> <replacement> [options]

Options:
  --dry-run, -n     Preview changes without modifying files
  --regex, -r       Treat search as regex pattern
  --glob, -g <pat>  File glob pattern (default: **/*.*)
  --max-files <n>   Max files to modify (default: 50)

Examples:
  /replace "oldFunction" "newFunction"
  /replace --dry-run "console.log" "logger.info"
  /replace --regex "import\\s*\\{" "import type {" --glob "*.ts"
  /replace "OldClass" "NewClass" --glob "src/**/*.ts"`,
        timestamp: new Date(),
      },
    };
  }

  const searchPattern = positional[0];
  const replacement = positional[1];
  if (searchPattern === undefined || replacement === undefined) {
    // Unreachable given the positional.length < 2 guard above; kept for type-safety.
    return {
      handled: true,
...failureFlag('/replace — search and replacement arguments are required.'),
      entry: {
        type: 'assistant',
        content: '/replace — search and replacement arguments are required.',
        timestamp: new Date(),
      },
    };
  }

  try {
    const { codebaseReplace, formatReplaceResult } = await import('../../tools/codebase-replace-tool.js');

    // Default to dry-run for safety when invoked as slash command
    // unless explicitly not set
    const result = await codebaseReplace(searchPattern, replacement, {
      glob,
      isRegex,
      dryRun,
      maxFiles,
    });

    const output = formatReplaceResult(result);

    return {
      handled: true,
...failureFlag(output),
      entry: {
        type: 'assistant',
        content: output,
        timestamp: new Date(),
      },
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('/replace error', { error: msg });
    return {
      handled: true,
...failureFlag(`/replace error: ${msg}`),
      entry: {
        type: 'assistant',
        content: `/replace error: ${msg}`,
        timestamp: new Date(),
      },
    };
  }
}
