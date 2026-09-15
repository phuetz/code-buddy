/**
 * Export Command Handlers
 *
 * Handlers for exporting sessions, conversations, and tool results
 */

import type { ChatEntry } from '../../agent/types.js';
import { initializeDatabase } from '../../database/database-manager.js';
import { getExportManager, type ConversationMessage, type ExportFormat } from '../../utils/export-manager.js';
import { CommandHandlerResult } from './branch-handlers.js';

function reply(content: string): CommandHandlerResult {
  return { handled: true, entry: { type: 'assistant', content, timestamp: new Date() } };
}

/** Map the visible transcript to export messages; UI-only entries are skipped. */
function chatEntriesToMessages(history: ChatEntry[]): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (const entry of history) {
    if (entry.type === 'user' || entry.type === 'assistant') {
      messages.push({ role: entry.type, content: entry.content, timestamp: entry.timestamp });
    } else if (entry.type === 'tool_result') {
      messages.push({
        role: 'tool',
        content: entry.content,
        timestamp: entry.timestamp,
        toolName: entry.toolCall?.function?.name ?? 'tool',
        toolCallId: entry.toolCall?.id,
      });
    }
  }
  return messages;
}

/**
 * Handle /export command
 * Export the current conversation, or a saved session with session:<id>
 */
export async function handleExport(
  args: string[],
  conversationHistory: ChatEntry[] = [],
  currentModel?: string
): Promise<CommandHandlerResult> {
  const exportManager = getExportManager();

  // Parse arguments
  const format = (args.find(a => ['json', 'markdown', 'html', 'text'].includes(a)) as ExportFormat) || 'markdown';
  const sessionIdArg = args.find(a => a.startsWith('session:'))?.split(':')[1];
  const includeSecrets = args.includes('--include-secrets');
  const noToolCalls = args.includes('--no-tools');
  const noMetadata = args.includes('--no-metadata');
  const options = {
    redactSecrets: !includeSecrets,
    includeToolCalls: !noToolCalls,
    includeMetadata: !noMetadata,
  };

  let result: { success: boolean; filePath?: string; error?: string };
  if (sessionIdArg) {
    // Saved sessions live in the SQLite session database, which the
    // interactive CLI does not open at startup.
    try {
      await initializeDatabase();
    } catch (error) {
      return reply(`Failed to export session ${sessionIdArg}: session database unavailable (${error instanceof Error ? error.message : String(error)}).`);
    }
    result = await exportManager.exportSession(sessionIdArg, format, options);
  } else {
    // The current session is the conversation on screen, not the most recent
    // database row (which may belong to another project).
    const messages = chatEntriesToMessages(conversationHistory);
    if (messages.length === 0) {
      return reply('Nothing to export yet: the current conversation is empty.\n\nSend a message first, or export a saved session with /export <format> session:<id>.');
    }
    result = await exportManager.exportConversationData({
      title: 'Code Buddy conversation',
      model: currentModel,
      startTime: messages[0]?.timestamp,
      endTime: messages[messages.length - 1]?.timestamp,
      messages,
      metadata: { projectPath: process.cwd(), messageCount: messages.length },
    }, format, options);
  }

  if (result.success && result.filePath) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `${sessionIdArg ? `Session ${sessionIdArg}` : 'Current conversation'} exported successfully!

**Format:** ${format}
**File:** ${result.filePath}

Use the following command to view the export:
\`\`\`bash
cat "${result.filePath}"
\`\`\``,
        timestamp: new Date(),
      },
    };
  } else {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Failed to export ${sessionIdArg ? `session ${sessionIdArg}` : 'the current conversation'}: ${result.error}`,
        timestamp: new Date(),
      },
    };
  }
}

/**
 * Handle /export-list command
 * List all exported files
 */
export async function handleExportList(): Promise<CommandHandlerResult> {
  const exportManager = getExportManager();
  const exports = await exportManager.listExports();

  if (exports.length === 0) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'No exported files found.',
        timestamp: new Date(),
      },
    };
  }

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const lines: string[] = [];
  lines.push('Exported Files');
  lines.push('═'.repeat(60));
  lines.push('');

  for (const exp of exports.slice(0, 20)) {
    const date = exp.created.toLocaleDateString();
    const time = exp.created.toLocaleTimeString();
    const size = formatSize(exp.size);

    lines.push(`**${exp.filename}**`);
    lines.push(`  Created: ${date} ${time}`);
    lines.push(`  Size: ${size}`);
    lines.push(`  Path: \`${exp.path}\``);
    lines.push('');
  }

  if (exports.length > 20) {
    lines.push(`... and ${exports.length - 20} more`);
  }

  return {
    handled: true,
    entry: {
      type: 'assistant',
      content: lines.join('\n'),
      timestamp: new Date(),
    },
  };
}

/**
 * Handle /export-formats command
 * Show available export formats and options
 */
export function handleExportFormats(): CommandHandlerResult {
  const content = `
Export Formats & Options
═══════════════════════════════════════════════════════════════════

Available Formats:
  • json       - Structured JSON format (machine-readable)
  • markdown   - Markdown format (human-readable, default)
  • html       - Styled HTML format (shareable)
  • text       - Plain text format
  • csv        - Comma-separated values (for tables)

Export Commands:

  /export [format] [options]
      Export current or specified session

      Options:
        session:<id>         Export specific session
        --include-secrets    Don't redact sensitive data
        --no-tools          Exclude tool calls
        --no-metadata       Exclude metadata

  /export-list
      List all exported files

  /export-formats
      Show this help message

Examples:

  /export markdown
      Export current session as markdown

  /export json session:abc123
      Export specific session as JSON

  /export html --no-tools
      Export as HTML without tool calls

Export Directory:
  ~/.codebuddy/exports/

All exports are saved with timestamps for easy organization.
  `.trim();

  return {
    handled: true,
    entry: {
      type: 'assistant',
      content,
      timestamp: new Date(),
    },
  };
}
