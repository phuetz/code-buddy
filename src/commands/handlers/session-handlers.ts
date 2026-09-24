/**
 * Session Handlers
 *
 * Manage session history with replay capability (Mistral Vibe-style).
 */

import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ChatEntry } from '../../agent/codebuddy-agent.js';
import { failureFlag } from '../slash-failure.js';
import {
  InteractionLogger,
  SessionData,
  SessionMetadata,
} from '../../logging/interaction-logger.js';

export interface CommandHandlerResult {
  handled: boolean;
  failed?: boolean;
  entry?: ChatEntry;
  sendToAI?: boolean;
}

/**
 * Format a session list for display
 */
function formatSessionList(sessions: SessionMetadata[]): string {
  if (sessions.length === 0) {
    return 'No sessions found.';
  }

  const lines: string[] = ['Recent Sessions:', ''];

  for (const session of sessions) {
    const date = new Date(session.started_at);
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const duration = session.duration_ms
      ? `${Math.round(session.duration_ms / 1000)}s`
      : 'ongoing';
    const cost = `$${session.estimated_cost.toFixed(4)}`;

    lines.push(
      `  ${session.short_id}  ${dateStr} ${timeStr}  ${session.model.padEnd(20)}  ` +
      `${session.turns} turns  ${session.tool_calls} tools  ${cost}  ${duration}`
    );

    if (session.description) {
      lines.push(`          └─ ${session.description}`);
    }
  }

  lines.push('');
  lines.push('Use /sessions show <id> to view details');
  lines.push('Use /sessions replay <id> to format for replay');
  lines.push('Use /sessions delete <id> to delete a session');

  return lines.join('\n');
}

/**
 * Format a session for replay (as AI-consumable context)
 */
function formatSessionForReplay(session: SessionData): string {
  const lines: string[] = [];

  lines.push('# Session Replay');
  lines.push(`Session ID: ${session.metadata.short_id}`);
  lines.push(`Model: ${session.metadata.model}`);
  lines.push(`Directory: ${session.metadata.cwd}`);
  lines.push('');
  lines.push('## Conversation');
  lines.push('');

  for (const msg of session.messages) {
    if (msg.role === 'system') continue; // Skip system messages

    const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'Tool';
    lines.push(`### ${roleLabel}`);

    if (msg.content) {
      lines.push(msg.content);
    }

    if (msg.tool_calls?.length) {
      lines.push('');
      lines.push('**Tool calls:**');
      for (const tc of msg.tool_calls) {
        lines.push(`- \`${tc.name}\`: ${tc.success ? '✓' : '✗'}`);
        if (tc.output) {
          lines.push('  ```');
          lines.push('  ' + tc.output.substring(0, 200) + (tc.output.length > 200 ? '...' : ''));
          lines.push('  ```');
        }
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Clean up old sessions based on age or count.
 *
 * @param options - Cleanup configuration
 * @returns Summary of the cleanup operation
 */
export function cleanupSessions(options: {
  days?: number;
  keep?: number;
  dryRun?: boolean;
}): { deletedCount: number; freedBytes: number; sessionIds: string[] } {
  const LOG_DIR = join(homedir(), '.codebuddy', 'logs');
  if (!existsSync(LOG_DIR)) {
    return { deletedCount: 0, freedBytes: 0, sessionIds: [] };
  }

  // Collect all session files with metadata
  const allFiles: Array<{
    path: string;
    size: number;
    startedAt: Date;
    shortId: string;
  }> = [];

  const dateDirs = readdirSync(LOG_DIR).filter(d => {
    try {
      return statSync(join(LOG_DIR, d)).isDirectory();
    } catch {
      return false;
    }
  });

  for (const dateDir of dateDirs) {
    const dir = join(LOG_DIR, dateDir);
    let files: string[];
    try {
      files = readdirSync(dir).filter(f => f.endsWith('.json'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const fileStat = statSync(filePath);
        const content = readFileSync(filePath, 'utf-8');
        const session = JSON.parse(content) as SessionData;
        allFiles.push({
          path: filePath,
          size: fileStat.size,
          startedAt: new Date(session.metadata.started_at),
          shortId: session.metadata.short_id,
        });
      } catch {
        // Include invalid files for cleanup too, using file mtime
        try {
          const fileStat = statSync(filePath);
          allFiles.push({
            path: filePath,
            size: fileStat.size,
            startedAt: fileStat.mtime,
            shortId: file.replace('.json', '').substring(0, 8),
          });
        } catch {
          // Skip completely unreadable files
        }
      }
    }
  }

  // Sort by date (newest first)
  allFiles.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  // Determine which files to delete
  const toDelete: typeof allFiles = [];
  const now = new Date();

  if (options.keep !== undefined) {
    // Keep only the N most recent
    if (allFiles.length > options.keep) {
      toDelete.push(...allFiles.slice(options.keep));
    }
  } else {
    // Delete by age (default: 7 days)
    const maxAge = (options.days ?? 7) * 24 * 60 * 60 * 1000;
    for (const file of allFiles) {
      if (now.getTime() - file.startedAt.getTime() > maxAge) {
        toDelete.push(file);
      }
    }
  }

  // Perform deletion (or dry run)
  let freedBytes = 0;
  const deletedIds: string[] = [];

  for (const file of toDelete) {
    freedBytes += file.size;
    deletedIds.push(file.shortId);
    if (!options.dryRun) {
      try {
        unlinkSync(file.path);
      } catch {
        // Ignore deletion errors
      }
    }
  }

  // Clean up empty date directories
  if (!options.dryRun) {
    for (const dateDir of dateDirs) {
      const dir = join(LOG_DIR, dateDir);
      try {
        const remaining = readdirSync(dir);
        if (remaining.length === 0) {
          rmdirSync(dir);
        }
      } catch {
        // Ignore
      }
    }
  }

  return {
    deletedCount: toDelete.length,
    freedBytes,
    sessionIds: deletedIds,
  };
}

/**
 * Format bytes into a human-readable size string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[exponent]}`;
}

/**
 * Handle /sessions command
 */
export function handleSessions(args: string[]): CommandHandlerResult {
  const action = args[0]?.toLowerCase() || 'list';
  const param = args.slice(1).join(' ');

  switch (action) {
    case 'list': {
      const limit = parseInt(param) || 10;
      const { sessions, total } = InteractionLogger.listSessions({ limit });

      const content = formatSessionList(sessions);
      const footer = total > sessions.length
        ? `\nShowing ${sessions.length} of ${total} sessions. Use /sessions list <n> for more.`
        : '';

      return {
        handled: true,
...failureFlag(content + footer),
        entry: {
          type: 'assistant',
          content: content + footer,
          timestamp: new Date(),
        },
      };
    }

    case 'show': {
      if (!param) {
        return {
          handled: true,
...failureFlag('Usage: /sessions show <session-id>'),
          entry: {
            type: 'assistant',
            content: 'Usage: /sessions show <session-id>',
            timestamp: new Date(),
          },
        };
      }

      const session = InteractionLogger.loadSession(param);
      if (!session) {
        return {
          handled: true,
...failureFlag(`Session not found: ${param}`),
          entry: {
            type: 'assistant',
            content: `Session not found: ${param}`,
            timestamp: new Date(),
          },
        };
      }

      return {
        handled: true,
...failureFlag(InteractionLogger.formatSession(session)),
        entry: {
          type: 'assistant',
          content: InteractionLogger.formatSession(session),
          timestamp: new Date(),
        },
      };
    }

    case 'replay': {
      if (!param) {
        return {
          handled: true,
...failureFlag('Usage: /sessions replay <session-id>'),
          entry: {
            type: 'assistant',
            content: 'Usage: /sessions replay <session-id>',
            timestamp: new Date(),
          },
        };
      }

      const session = InteractionLogger.loadSession(param);
      if (!session) {
        return {
          handled: true,
...failureFlag(`Session not found: ${param}`),
          entry: {
            type: 'assistant',
            content: `Session not found: ${param}`,
            timestamp: new Date(),
          },
        };
      }

      return {
        handled: true,
...failureFlag(formatSessionForReplay(session)),
        entry: {
          type: 'assistant',
          content: formatSessionForReplay(session),
          timestamp: new Date(),
        },
      };
    }

    case 'delete': {
      if (!param) {
        return {
          handled: true,
...failureFlag('Usage: /sessions delete <session-id>'),
          entry: {
            type: 'assistant',
            content: 'Usage: /sessions delete <session-id>',
            timestamp: new Date(),
          },
        };
      }

      const deleted = InteractionLogger.deleteSession(param);
      return {
        handled: true,
...failureFlag(deleted
            ? `Session ${param} deleted.`
            : `Session not found: ${param}`),
        entry: {
          type: 'assistant',
          content: deleted
            ? `Session ${param} deleted.`
            : `Session not found: ${param}`,
          timestamp: new Date(),
        },
      };
    }

    case 'latest': {
      const session = InteractionLogger.getLatestSession();
      if (!session) {
        return {
          handled: true,
...failureFlag('No sessions found.'),
          entry: {
            type: 'assistant',
            content: 'No sessions found.',
            timestamp: new Date(),
          },
        };
      }

      return {
        handled: true,
...failureFlag(InteractionLogger.formatSession(session)),
        entry: {
          type: 'assistant',
          content: InteractionLogger.formatSession(session),
          timestamp: new Date(),
        },
      };
    }

    case 'search': {
      if (!param) {
        return {
          handled: true,
...failureFlag('Usage: /sessions search <partial-id>'),
          entry: {
            type: 'assistant',
            content: 'Usage: /sessions search <partial-id>',
            timestamp: new Date(),
          },
        };
      }

      const sessions = InteractionLogger.searchSessions(param);
      if (sessions.length === 0) {
        return {
          handled: true,
...failureFlag(`No sessions found matching: ${param}`),
          entry: {
            type: 'assistant',
            content: `No sessions found matching: ${param}`,
            timestamp: new Date(),
          },
        };
      }

      return {
        handled: true,
...failureFlag(formatSessionList(sessions.map(s => s.metadata))),
        entry: {
          type: 'assistant',
          content: formatSessionList(sessions.map(s => s.metadata)),
          timestamp: new Date(),
        },
      };
    }

    case 'cleanup': {
      // Parse cleanup options from args
      const cleanupArgs = args.slice(1);
      let days: number | undefined;
      let keep: number | undefined;
      let dryRun = false;

      for (let i = 0; i < cleanupArgs.length; i++) {
        const arg = cleanupArgs[i];
        const nextArg = cleanupArgs[i + 1];
        if (arg === '--days' && nextArg) {
          days = parseInt(nextArg, 10);
          if (isNaN(days) || days < 1) {
            return {
              handled: true,
...failureFlag('Invalid --days value. Must be a positive integer.'),
              entry: {
                type: 'assistant',
                content: 'Invalid --days value. Must be a positive integer.',
                timestamp: new Date(),
              },
            };
          }
          i++;
        } else if (arg === '--keep' && nextArg) {
          keep = parseInt(nextArg, 10);
          if (isNaN(keep) || keep < 0) {
            return {
              handled: true,
...failureFlag('Invalid --keep value. Must be a non-negative integer.'),
              entry: {
                type: 'assistant',
                content: 'Invalid --keep value. Must be a non-negative integer.',
                timestamp: new Date(),
              },
            };
          }
          i++;
        } else if (arg === '--dry-run') {
          dryRun = true;
        }
      }

      // Default to 7 days if neither --days nor --keep specified
      const result = cleanupSessions({ days, keep, dryRun });

      if (result.deletedCount === 0) {
        return {
          handled: true,
...failureFlag('No sessions to clean up.'),
          entry: {
            type: 'assistant',
            content: 'No sessions to clean up.',
            timestamp: new Date(),
          },
        };
      }

      const verb = dryRun ? 'Would delete' : 'Deleted';
      const sizeStr = formatBytes(result.freedBytes);
      const lines = [
        `${verb} ${result.deletedCount} session${result.deletedCount !== 1 ? 's' : ''}, freed ${sizeStr}.`,
      ];

      if (dryRun) {
        lines.push('(dry run - no files were actually deleted)');
      }

      if (result.deletedCount <= 20) {
        lines.push('');
        lines.push(`Session IDs: ${result.sessionIds.join(', ')}`);
      }

      return {
        handled: true,
...failureFlag(lines.join('\n')),
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
...failureFlag(`Unknown action: ${action}\n\nAvailable actions:\n  list [n]       - List recent sessions (default: 10)\n  show <id>      - Show session details\n  replay <id>    - Format session for AI context\n  delete <id>    - Delete a session\n  latest         - Show the most recent session\n  search <text>  - Search sessions by partial ID\n  cleanup        - Delete old sessions (--days N, --keep N, --dry-run)`),
        entry: {
          type: 'assistant',
          content: `Unknown action: ${action}\n\nAvailable actions:\n  list [n]       - List recent sessions (default: 10)\n  show <id>      - Show session details\n  replay <id>    - Format session for AI context\n  delete <id>    - Delete a session\n  latest         - Show the most recent session\n  search <text>  - Search sessions by partial ID\n  cleanup        - Delete old sessions (--days N, --keep N, --dry-run)`,
          timestamp: new Date(),
        },
      };
  }
}
