/**
 * /conflicts Slash Command Handler
 *
 * Detect, list, and resolve Git merge conflicts.
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import { failureFlag } from '../slash-failure.js';

export async function handleConflicts(args: string[]): Promise<CommandHandlerResult> {
  const { executeResolveConflicts } = await import('../../tools/merge-conflict-tool.js');

  const action = args[0]?.toLowerCase() || 'scan';

  switch (action) {
    case 'scan':
    case 'list': {
      const result = await executeResolveConflicts({ scan_only: true });
      return {
        handled: true,
...failureFlag(result.output || result.error || 'Scan complete.'),
        entry: { type: 'assistant', content: result.output || result.error || 'Scan complete.', timestamp: new Date() },
      };
    }

    case 'resolve': {
      const filePath = args[1];
      const strategy = (args[2] as 'ours' | 'theirs' | 'both') || 'ours';

      if (!filePath) {
        return {
          handled: true,
...failureFlag('Usage: /conflicts resolve <file> [ours|theirs|both]\n\nStrategies:\n  ours   — keep current branch (default)\n  theirs — keep incoming branch\n  both   — keep both versions'),
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
...failureFlag(result.output || result.error || 'Done.'),
        entry: { type: 'assistant', content: result.output || result.error || 'Done.', timestamp: new Date() },
      };
    }

    case 'show': {
      const filePath = args[1];
      if (!filePath) {
        return {
          handled: true,
...failureFlag('Usage: /conflicts show <file>'),
          entry: { type: 'assistant', content: 'Usage: /conflicts show <file>', timestamp: new Date() },
        };
      }

      const result = await executeResolveConflicts({ file_path: filePath, strategy: 'ai' });
      return {
        handled: true,
...failureFlag(result.output || result.error || 'No conflicts found.'),
        entry: { type: 'assistant', content: result.output || result.error || 'No conflicts found.', timestamp: new Date() },
      };
    }

    default: {
      return {
        handled: true,
...failureFlag('Merge Conflict Commands:\n\n' +
            '  /conflicts              — Scan for all conflicted files\n' +
            '  /conflicts scan         — Same as above\n' +
            '  /conflicts show <file>  — Show conflict details\n' +
            '  /conflicts resolve <file> [ours|theirs|both] — Resolve conflicts'),
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
