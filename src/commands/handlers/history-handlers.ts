/**
 * History Handlers
 *
 * Handle /history command for viewing and searching command history.
 * Supports: list, search, clear, stats, limit configuration.
 */

import { ChatEntry } from '../../agent/codebuddy-agent.js';
import { getHistoryManager } from '../../utils/history-manager.js';

export interface CommandHandlerResult {
  handled: boolean;
  entry?: ChatEntry;
  sendToAI?: boolean;
}

/**
 * Handle /history command
 */
export function handleHistory(args: string[]): CommandHandlerResult {
  const historyManager = getHistoryManager();
  const action = args[0]?.toLowerCase() || 'list';
  const param = args.slice(1).join(' ');

  switch (action) {
    case 'list': {
      const limit = parseInt(param) || 20;
      const content = historyManager.formatHistoryList(limit, false);

      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: content + '\n\nTip: Use Ctrl+R for interactive reverse search (like bash)',
          timestamp: new Date(),
        },
      };
    }

    case 'search': {
      if (!param) {
        return {
          handled: true,
          entry: {
            type: 'assistant',
            content: 'Usage: /history search <pattern>\n\nSearches command history for entries containing the pattern.',
            timestamp: new Date(),
          },
        };
      }

      const results = historyManager.search(param, 20);

      if (results.length === 0) {
        return {
          handled: true,
          entry: {
            type: 'assistant',
            content: `No history entries found matching: "${param}"`,
            timestamp: new Date(),
          },
        };
      }

      const lines: string[] = [`Search results for "${param}":`,''];
      results.forEach((entry, index) => {
        const date = new Date(entry.timestamp);
        const timeStr = date.toLocaleString();
        lines.push(`  ${index + 1}. [${timeStr}] ${entry.text}`);
      });

      lines.push('');
      lines.push(`Found ${results.length} matching entries`);

      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: lines.join('\n'),
          timestamp: new Date(),
        },
      };
    }

    case 'clear': {
      const count = historyManager.count;
      historyManager.clear();

      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: `Cleared ${count} entries from command history.`,
          timestamp: new Date(),
        },
      };
    }

    case 'stats': {
      const count = historyManager.count;
      const maxEntries = historyManager.getMaxEntries();
      const frequent = historyManager.getFrequent(5);

      const lines: string[] = [
        'Command History Statistics:',
        '',
        `  Total entries: ${count}`,
        `  Max entries: ${maxEntries}`,
        `  Usage: ${((count / maxEntries) * 100).toFixed(1)}%`,
        '',
      ];

      if (frequent.length > 0) {
        lines.push('Most frequent commands:');
        frequent.forEach((item, index) => {
          lines.push(`  ${index + 1}. ${item.text} (${item.count}x)`);
        });
      }

      lines.push('');
      lines.push('Navigation:');
      lines.push('  - Up/Down arrows: Navigate through history');
      lines.push('  - Ctrl+R: Reverse search (like bash)');
      lines.push('  - Ctrl+R again: Next match');
      lines.push('  - Enter: Accept match');
      lines.push('  - Escape: Cancel search');

      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: lines.join('\n'),
          timestamp: new Date(),
        },
      };
    }

    case 'limit': {
      const newLimit = parseInt(param);

      if (!param) {
        return {
          handled: true,
          entry: {
            type: 'assistant',
            content: `Current history limit: ${historyManager.getMaxEntries()} entries\n\nUsage: /history limit <number>`,
            timestamp: new Date(),
          },
        };
      }

      if (isNaN(newLimit) || newLimit < 10 || newLimit > 10000) {
        return {
          handled: true,
          entry: {
            type: 'assistant',
            content: 'Invalid limit. Please specify a number between 10 and 10000.',
            timestamp: new Date(),
          },
        };
      }

      const oldLimit = historyManager.getMaxEntries();
      historyManager.setMaxEntries(newLimit);

      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: `History limit changed from ${oldLimit} to ${newLimit} entries.`,
          timestamp: new Date(),
        },
      };
    }

    case 'frequent': {
      const limit = parseInt(param) || 10;
      const frequent = historyManager.getFrequent(limit);

      if (frequent.length === 0) {
        return {
          handled: true,
          entry: {
            type: 'assistant',
            content: 'No command history yet.',
            timestamp: new Date(),
          },
        };
      }

      const lines: string[] = ['Most Frequently Used Commands:', ''];
      frequent.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.text} (${item.count} times)`);
      });

      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: lines.join('\n'),
          timestamp: new Date(),
        },
      };
    }

    default:
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: `Unknown action: ${action}

Available actions:
  list [n]           - List recent commands (default: 20)
  search <pattern>   - Search history for pattern
  clear              - Clear all history
  stats              - Show history statistics
  limit <n>          - Set max history entries (10-10000)
  frequent [n]       - Show most used commands

Keyboard shortcuts:
  Ctrl+R             - Reverse search (like bash)
  Up/Down arrows     - Navigate history`,
          timestamp: new Date(),
        },
      };
  }
}
