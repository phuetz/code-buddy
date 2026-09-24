/**
 * /bug Slash Command Handler
 *
 * Scans files or directories for bug patterns using the bug-finder-tool.
 * Supports severity filtering and directory scanning.
 *
 * Usage:
 *   /bug [file|directory]            — scan for bugs (default: current directory)
 *   /bug --severity critical|high    — filter by minimum severity
 *   /bug .                           — scan current directory
 */

import * as path from 'path';
import type { CommandHandlerResult } from './branch-handlers.js';
import { failureFlag } from '../slash-failure.js';

export async function handleBug(args: string[]): Promise<CommandHandlerResult> {
  // Parse arguments
  let targetPath = process.cwd();
  let severityFilter: 'critical' | 'high' | 'all' = 'all';

  const remaining: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    const next = args[i + 1];
    if (arg === '--severity' && next !== undefined) {
      i++;
      const sev = next.toLowerCase();
      if (sev === 'critical' || sev === 'high') {
        severityFilter = sev;
      } else {
        return result(`Invalid severity filter: "${sev}". Use "critical" or "high".`);
      }
    } else {
      remaining.push(arg);
    }
  }

  if (remaining.length > 0) {
    const rawPath = remaining.join(' ').trim();
    if (rawPath === '.') {
      targetPath = process.cwd();
    } else {
      targetPath = path.resolve(process.cwd(), rawPath);
    }
  }

  // No args at all: show help
  if (args.length === 0) {
    return result(
      'Usage: /bug [path] [--severity critical|high]\n\n' +
      'Scan files or directories for potential bugs using static analysis.\n\n' +
      'Examples:\n' +
      '  /bug                         — scan current directory\n' +
      '  /bug src/utils/index.ts      — scan a single file\n' +
      '  /bug src/ --severity high    — scan directory, high+ severity only\n' +
      '  /bug . --severity critical   — scan cwd, critical only'
    );
  }

  try {
    const { executeFindBugs } = await import('../../tools/bug-finder-tool.js');
    const toolResult = await executeFindBugs({
      path: targetPath,
      severity: severityFilter === 'all' ? 'all' : severityFilter,
    });

    if (toolResult.success) {
      return result(toolResult.output || 'No potential bugs found.');
    } else {
      return result(`Bug scan failed: ${toolResult.error || 'Unknown error'}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return result(`Bug scan error: ${msg}`);
  }
}

function result(content: string): CommandHandlerResult {
  return {
    handled: true,
    ...failureFlag(content),
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}
