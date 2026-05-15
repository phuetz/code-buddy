/**
 * /conflicts Slash Command Handler
 *
 * Detect, list, and resolve Git merge conflicts.
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import type { ToolResult } from '../../types/index.js';

function formatConflictResult(result: ToolResult, emptySuccessMessage: string): string {
  const output = result.output?.trim();
  if (result.success) {
    return output || emptySuccessMessage;
  }

  return result.error?.trim() || 'Conflict command failed without error details.';
}

export async function handleConflicts(args: string[]): Promise<CommandHandlerResult> {
  const { executeResolveConflicts } = await import('../../tools/merge-conflict-tool.js');

  const action = args[0]?.toLowerCase() || 'scan';

  switch (action) {
    case 'scan':
    case 'list': {
      const result = await executeResolveConflicts({ scan_only: true });
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: formatConflictResult(result, 'Conflict scan completed with no details.'),
          timestamp: new Date(),
        },
      };
    }

    case 'resolve': {
      const filePath = args[1];
      const strategy = (args[2] as 'ours' | 'theirs' | 'both') || 'ours';

      if (!filePath) {
        return {
          handled: true,
          entry: {
            type: 'assistant',
            content: 'Usage: /conflicts resolve <file> [ours|theirs|both]\n\nStrategies:\n  ours   — keep current branch (default)\n  theirs — keep incoming branch\n  both   — keep both versions',
            timestamp: new Date(),
          },
        };
      }

      const result = await executeResolveConflicts({ file_path: filePath, strategy });
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: formatConflictResult(result, 'Conflict resolution completed with no details.'),
          timestamp: new Date(),
        },
      };
    }

    case 'show': {
      const filePath = args[1];
      if (!filePath) {
        return {
          handled: true,
          entry: { type: 'assistant', content: 'Usage: /conflicts show <file>', timestamp: new Date() },
        };
      }

      const result = await executeResolveConflicts({ file_path: filePath, strategy: 'ai' });
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: formatConflictResult(result, 'Conflict inspection completed with no details.'),
          timestamp: new Date(),
        },
      };
    }

    default: {
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: 'Merge Conflict Commands:\n\n' +
            '  /conflicts              — Scan for all conflicted files\n' +
            '  /conflicts scan         — Same as above\n' +
            '  /conflicts show <file>  — Show conflict details\n' +
            '  /conflicts resolve <file> [ours|theirs|both] — Resolve conflicts',
          timestamp: new Date(),
        },
      };
    }
  }
}
