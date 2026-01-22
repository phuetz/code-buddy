/**
 * Debug Command Handlers
 *
 * Enhanced debug mode with comprehensive debugging capabilities:
 * - Verbose API call logging with full request/response dumps
 * - Detailed timing for each operation
 * - Context dump functionality
 * - Request replay mechanism
 * - Stack trace capture
 */

import {
  getDebugLogger,
  DebugLogger,
  DebugConfig,
  APICallLog,
  ToolCallLog,
} from '../../utils/debug-logger.js';
import { ChatEntry } from '../../agent/codebuddy-agent.js';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

export interface CommandHandlerResult {
  handled: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
}

/**
 * Debug Mode Handler
 *
 * Usage:
 *   /debug on|off          - Enable/disable debug mode
 *   /debug status          - Show current debug status
 *   /debug dump context    - Dump current context
 *   /debug dump api        - Dump API call history
 *   /debug dump tools      - Dump tool call history
 *   /debug dump prompts    - Dump prompt history
 *   /debug dump all        - Dump everything
 *   /debug timing          - Show timing summary
 *   /debug replay <id>     - Replay a specific request
 *   /debug export          - Export debug data to file
 *   /debug clear           - Clear debug logs
 *   /debug level <level>   - Set debug level (verbose|normal|minimal)
 *   /debug config          - Show/modify debug configuration
 */
export function handleDebugMode(
  args: string[],
  contextData?: {
    conversationHistory?: ChatEntry[];
    currentContext?: string;
    systemPrompt?: string;
  }
): CommandHandlerResult {
  const debugLogger = getDebugLogger();
  const action = args[0]?.toLowerCase();
  const subAction = args[1]?.toLowerCase();

  let content: string;

  switch (action) {
    case 'on':
      debugLogger.setEnabled(true);
      debugLogger.updateConfig({
        api: true,
        tools: true,
        timing: true,
      });
      content = formatDebugEnabled(debugLogger);
      break;

    case 'off':
      debugLogger.setEnabled(false);
      content = `${chalk.yellow('DEBUG MODE: DISABLED')}

Debug logging has been turned off.
Use /debug on to re-enable.`;
      break;

    case 'verbose':
      debugLogger.setEnabled(true);
      debugLogger.updateConfig({
        level: 'verbose',
        api: true,
        tools: true,
        timing: true,
        prompts: true,
      });
      content = `${chalk.yellow('DEBUG MODE: VERBOSE')}

All debug features enabled:
  - Full API request/response logging
  - Tool call tracing with full arguments
  - Detailed timing measurements
  - Prompt dumps enabled

${chalk.gray('Warning: Verbose mode may impact performance')}`;
      break;

    case 'status':
      content = formatDebugStatus(debugLogger);
      break;

    case 'dump':
      content = handleDebugDump(debugLogger, subAction, contextData);
      break;

    case 'timing':
      content = formatTimingSummary(debugLogger);
      break;

    case 'replay':
      content = handleReplay(debugLogger, subAction);
      break;

    case 'export':
      content = handleDebugExport(debugLogger);
      break;

    case 'clear':
      debugLogger.clear();
      content = `${chalk.green('Debug logs cleared')}

All debug history has been reset:
  - API call logs: cleared
  - Tool call logs: cleared
  - Prompt dumps: cleared
  - Timing entries: cleared`;
      break;

    case 'level':
      if (subAction && ['verbose', 'normal', 'minimal'].includes(subAction)) {
        debugLogger.updateConfig({ level: subAction as 'verbose' | 'normal' | 'minimal' });
        content = `Debug level set to: ${chalk.cyan(subAction.toUpperCase())}`;
      } else {
        content = `Invalid level. Valid options: verbose, normal, minimal`;
      }
      break;

    case 'config':
      content = formatDebugConfig(debugLogger);
      break;

    case 'api':
      // Shortcut for dump api
      debugLogger.updateConfig({ api: subAction !== 'off' });
      content = `API logging: ${subAction !== 'off' ? chalk.green('ON') : chalk.red('OFF')}`;
      break;

    case 'tools':
      // Shortcut for dump tools config
      debugLogger.updateConfig({ tools: subAction !== 'off' });
      content = `Tool tracing: ${subAction !== 'off' ? chalk.green('ON') : chalk.red('OFF')}`;
      break;

    case 'stack':
      content = handleStackTrace(args.slice(1).join(' '));
      break;

    default:
      content = formatDebugHelp();
      break;
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

/**
 * Format debug enabled message
 */
function formatDebugEnabled(debugLogger: DebugLogger): string {
  return `${chalk.yellow('=')}${chalk.yellow('='.repeat(50))}${chalk.yellow('=')}
${chalk.yellow('DEBUG MODE: ENABLED')}
${chalk.yellow('=')}${chalk.yellow('='.repeat(50))}${chalk.yellow('=')}

Debug features active:
  ${chalk.green('API Logging:')} ON - Full request/response logging
  ${chalk.green('Tool Tracing:')} ON - Track all tool calls
  ${chalk.green('Timing:')} ON - Measure operation durations

Commands:
  /debug status      - View current status
  /debug dump <type> - Dump logs (api, tools, context, all)
  /debug timing      - View timing summary
  /debug replay <id> - Replay a request
  /debug export      - Export to file
  /debug off         - Disable debug mode
  /debug verbose     - Enable all debug features

${chalk.gray('Tip: Use /debug verbose for maximum detail')}`;
}

/**
 * Format debug status
 */
function formatDebugStatus(debugLogger: DebugLogger): string {
  const summary = debugLogger.getSessionSummary();
  const enabled = debugLogger.isEnabled();

  return `${chalk.yellow('DEBUG STATUS')}
${chalk.gray('─'.repeat(50))}

${chalk.cyan('Mode:')} ${enabled ? chalk.green('ENABLED') : chalk.red('DISABLED')}

${chalk.cyan('Session Statistics:')}
  Duration: ${(summary.sessionDuration / 1000).toFixed(1)}s
  API Calls: ${summary.apiCallCount}
  Tool Calls: ${summary.toolCallCount}
  Timing Entries: ${summary.timingEntries}

${chalk.cyan('Performance:')}
  Total API Time: ${summary.totalApiDuration.toFixed(0)}ms
  Avg API Time: ${summary.avgApiDuration.toFixed(0)}ms
  Total Tool Time: ${summary.totalToolDuration.toFixed(0)}ms
  Avg Tool Time: ${summary.avgToolDuration.toFixed(0)}ms
  Tool Success Rate: ${summary.toolSuccessRate.toFixed(1)}%

${chalk.gray('─'.repeat(50))}
Use /debug dump <type> to view detailed logs`;
}

/**
 * Handle debug dump commands
 */
function handleDebugDump(
  debugLogger: DebugLogger,
  type?: string,
  contextData?: {
    conversationHistory?: ChatEntry[];
    currentContext?: string;
    systemPrompt?: string;
  }
): string {
  switch (type) {
    case 'context':
      return formatContextDump(contextData);

    case 'api':
      return formatAPIDump(debugLogger);

    case 'tools':
      return formatToolsDump(debugLogger);

    case 'prompts':
      return formatPromptsDump(debugLogger);

    case 'all':
      return [
        formatContextDump(contextData),
        '\n' + chalk.gray('─'.repeat(60)) + '\n',
        formatAPIDump(debugLogger),
        '\n' + chalk.gray('─'.repeat(60)) + '\n',
        formatToolsDump(debugLogger),
      ].join('\n');

    default:
      return `${chalk.yellow('DEBUG DUMP OPTIONS')}

  /debug dump context  - Current conversation context
  /debug dump api      - API call history
  /debug dump tools    - Tool execution history
  /debug dump prompts  - Prompt history
  /debug dump all      - Everything combined`;
  }
}

/**
 * Format context dump
 */
function formatContextDump(contextData?: {
  conversationHistory?: ChatEntry[];
  currentContext?: string;
  systemPrompt?: string;
}): string {
  const lines: string[] = [
    chalk.yellow('CONTEXT DUMP'),
    chalk.gray('─'.repeat(50)),
  ];

  if (!contextData) {
    lines.push(chalk.gray('No context data available'));
    return lines.join('\n');
  }

  if (contextData.systemPrompt) {
    lines.push(`\n${chalk.cyan('System Prompt:')}`);
    lines.push(chalk.gray(`(${contextData.systemPrompt.length} chars)`));
    lines.push(truncateWithEllipsis(contextData.systemPrompt, 500));
  }

  if (contextData.currentContext) {
    lines.push(`\n${chalk.cyan('Current Context:')}`);
    lines.push(chalk.gray(`(${contextData.currentContext.length} chars)`));
    lines.push(truncateWithEllipsis(contextData.currentContext, 500));
  }

  if (contextData.conversationHistory) {
    lines.push(`\n${chalk.cyan('Conversation History:')}`);
    lines.push(chalk.gray(`${contextData.conversationHistory.length} entries`));

    const recent = contextData.conversationHistory.slice(-5);
    for (const entry of recent) {
      const roleColor = entry.type === 'user' ? chalk.blue : chalk.green;
      const preview = truncateWithEllipsis(entry.content, 100);
      lines.push(`  ${roleColor(`[${entry.type}]`)} ${preview}`);
    }

    if (contextData.conversationHistory.length > 5) {
      lines.push(chalk.gray(`  ... and ${contextData.conversationHistory.length - 5} more entries`));
    }
  }

  return lines.join('\n');
}

/**
 * Format API dump
 */
function formatAPIDump(debugLogger: DebugLogger): string {
  const lines: string[] = [
    chalk.yellow('API CALL HISTORY'),
    chalk.gray('─'.repeat(50)),
  ];

  // Get API logs via export and parse
  const exported = JSON.parse(debugLogger.exportAsJSON());
  const apiLogs: APICallLog[] = exported.apiLogs || [];

  if (apiLogs.length === 0) {
    lines.push(chalk.gray('No API calls logged'));
    return lines.join('\n');
  }

  // Show last 10 API calls
  const recent = apiLogs.slice(-10);
  for (const log of recent) {
    lines.push(`\n${chalk.cyan(`[${log.requestId}]`)} ${log.timestamp}`);
    lines.push(`  Model: ${log.model}`);
    lines.push(`  Messages: ${log.messages.length}`);
    if (log.tools) {
      lines.push(`  Tools: ${log.tools.length}`);
    }
    lines.push(`  Duration: ${log.durationMs}ms`);

    if (log.response) {
      lines.push(`  Response: ${log.response.status}`);
      if (log.response.toolCalls && log.response.toolCalls.length > 0) {
        lines.push(`  Tool Calls: ${log.response.toolCalls.map(tc => tc.name).join(', ')}`);
      }
      if (log.response.usage) {
        lines.push(`  Tokens: ${log.response.usage.promptTokens} prompt, ${log.response.usage.completionTokens} completion`);
      }
    }

    if (log.error) {
      lines.push(chalk.red(`  Error: ${log.error.message}`));
    }
  }

  if (apiLogs.length > 10) {
    lines.push(chalk.gray(`\n... and ${apiLogs.length - 10} more API calls`));
  }

  return lines.join('\n');
}

/**
 * Format tools dump
 */
function formatToolsDump(debugLogger: DebugLogger): string {
  const lines: string[] = [
    chalk.yellow('TOOL CALL HISTORY'),
    chalk.gray('─'.repeat(50)),
  ];

  // Get tool logs via export and parse
  const exported = JSON.parse(debugLogger.exportAsJSON());
  const toolLogs: ToolCallLog[] = exported.toolLogs || [];

  if (toolLogs.length === 0) {
    lines.push(chalk.gray('No tool calls logged'));
    return lines.join('\n');
  }

  // Show last 20 tool calls
  const recent = toolLogs.slice(-20);
  for (const log of recent) {
    const statusIcon = log.result?.success ? chalk.green('[OK]') : chalk.red('[FAIL]');
    lines.push(`\n${statusIcon} ${chalk.cyan(log.toolName)} (Round ${log.roundNumber})`);
    lines.push(`  ID: ${log.callId}`);
    lines.push(`  Duration: ${log.durationMs}ms`);

    // Show arguments summary
    const argSummary = Object.entries(log.arguments)
      .slice(0, 3)
      .map(([k, v]) => `${k}=${summarizeValue(v)}`)
      .join(', ');
    if (argSummary) {
      lines.push(`  Args: ${argSummary}`);
    }

    if (log.result) {
      if (log.result.error) {
        lines.push(chalk.red(`  Error: ${log.result.error}`));
      } else if (log.result.outputLength) {
        lines.push(`  Output: ${log.result.outputLength} chars`);
      }
    }
  }

  if (toolLogs.length > 20) {
    lines.push(chalk.gray(`\n... and ${toolLogs.length - 20} more tool calls`));
  }

  return lines.join('\n');
}

/**
 * Format prompts dump
 */
function formatPromptsDump(debugLogger: DebugLogger): string {
  const lines: string[] = [
    chalk.yellow('PROMPT HISTORY'),
    chalk.gray('─'.repeat(50)),
  ];

  // Get prompt dumps via export and parse
  const exported = JSON.parse(debugLogger.exportAsJSON());
  const promptDumps = exported.promptDumps || [];

  if (promptDumps.length === 0) {
    lines.push(chalk.gray('No prompts logged (enable with /debug verbose)'));
    return lines.join('\n');
  }

  for (const dump of promptDumps.slice(-10)) {
    const typeColor = dump.type === 'system' ? chalk.magenta :
                      dump.type === 'user' ? chalk.blue :
                      dump.type === 'assistant' ? chalk.green : chalk.gray;

    lines.push(`\n${typeColor(`[${dump.type.toUpperCase()}]`)} ${dump.timestamp}`);
    lines.push(`  Length: ${dump.contentLength} chars (~${dump.tokenEstimate} tokens)`);
    lines.push(`  Preview: ${truncateWithEllipsis(dump.content, 200)}`);
  }

  return lines.join('\n');
}

/**
 * Format timing summary
 */
function formatTimingSummary(debugLogger: DebugLogger): string {
  const summary = debugLogger.getSessionSummary();
  const timings = debugLogger.getTimings();

  const lines: string[] = [
    chalk.yellow('TIMING SUMMARY'),
    chalk.gray('─'.repeat(50)),
    '',
    chalk.cyan('Session Overview:'),
    `  Total Duration: ${(summary.sessionDuration / 1000).toFixed(2)}s`,
    '',
    chalk.cyan('API Performance:'),
    `  Calls: ${summary.apiCallCount}`,
    `  Total: ${summary.totalApiDuration.toFixed(0)}ms`,
    `  Average: ${summary.avgApiDuration.toFixed(0)}ms`,
    '',
    chalk.cyan('Tool Performance:'),
    `  Calls: ${summary.toolCallCount}`,
    `  Total: ${summary.totalToolDuration.toFixed(0)}ms`,
    `  Average: ${summary.avgToolDuration.toFixed(0)}ms`,
    `  Success Rate: ${summary.toolSuccessRate.toFixed(1)}%`,
  ];

  if (timings.length > 0) {
    lines.push('');
    lines.push(chalk.cyan('Recent Timings:'));
    for (const timing of timings.slice(-10)) {
      const duration = timing.durationMs !== undefined
        ? `${timing.durationMs.toFixed(2)}ms`
        : 'running...';
      lines.push(`  ${timing.label}: ${duration}`);
    }
  }

  return lines.join('\n');
}

/**
 * Handle replay command
 */
function handleReplay(debugLogger: DebugLogger, requestId?: string): string {
  if (!requestId) {
    return `${chalk.yellow('REPLAY REQUESTS')}

Usage: /debug replay <request_id>

To find request IDs, use: /debug dump api

Replay will show the full request and response details for debugging.`;
  }

  // Get API logs via export and parse
  const exported = JSON.parse(debugLogger.exportAsJSON());
  const apiLogs: APICallLog[] = exported.apiLogs || [];

  const log = apiLogs.find(l => l.requestId === requestId);
  if (!log) {
    return chalk.red(`Request not found: ${requestId}\n\nUse /debug dump api to see available requests.`);
  }

  const lines: string[] = [
    chalk.yellow(`REPLAY: ${log.requestId}`),
    chalk.gray('─'.repeat(50)),
    '',
    chalk.cyan('Request:'),
    `  Timestamp: ${log.timestamp}`,
    `  Method: ${log.method}`,
    `  Endpoint: ${log.endpoint}`,
    `  Model: ${log.model}`,
    '',
    chalk.cyan('Messages:'),
  ];

  for (const msg of log.messages) {
    lines.push(`  [${msg.role}] ${msg.contentPreview}`);
    if (msg.hasToolCalls) {
      lines.push(`    (has tool calls)`);
    }
  }

  if (log.tools && log.tools.length > 0) {
    lines.push('');
    lines.push(chalk.cyan('Tools:'));
    for (const tool of log.tools.slice(0, 10)) {
      lines.push(`  - ${tool.name}: ${tool.description}`);
    }
    if (log.tools.length > 10) {
      lines.push(`  ... and ${log.tools.length - 10} more`);
    }
  }

  lines.push('');
  lines.push(chalk.cyan('Response:'));
  if (log.response) {
    lines.push(`  Status: ${log.response.status}`);
    lines.push(`  Content: ${log.response.contentPreview || '(no content)'}`);
    if (log.response.toolCalls && log.response.toolCalls.length > 0) {
      lines.push(`  Tool Calls:`);
      for (const tc of log.response.toolCalls) {
        lines.push(`    - ${tc.name}(${tc.argumentsPreview})`);
      }
    }
    if (log.response.usage) {
      lines.push(`  Usage: ${log.response.usage.promptTokens} + ${log.response.usage.completionTokens} = ${log.response.usage.totalTokens} tokens`);
    }
  } else {
    lines.push(chalk.gray('  (no response recorded)'));
  }

  if (log.error) {
    lines.push('');
    lines.push(chalk.red('Error:'));
    lines.push(`  ${log.error.name}: ${log.error.message}`);
    if (log.error.stack) {
      lines.push(`  Stack:\n${log.error.stack}`);
    }
  }

  lines.push('');
  lines.push(`Duration: ${log.durationMs}ms`);

  return lines.join('\n');
}

/**
 * Handle debug export
 */
function handleDebugExport(debugLogger: DebugLogger): string {
  const exportDir = path.join(process.cwd(), '.codebuddy', 'debug-exports');

  try {
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `debug-export-${timestamp}.json`;
    const filepath = path.join(exportDir, filename);

    const data = debugLogger.exportAsJSON();
    fs.writeFileSync(filepath, data);

    return `${chalk.green('Debug data exported!')}

File: ${filepath}

The export includes:
  - Session configuration
  - API call history
  - Tool call history
  - Prompt dumps
  - Timing data
  - Summary statistics`;
  } catch (error) {
    return chalk.red(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Format debug configuration
 */
function formatDebugConfig(debugLogger: DebugLogger): string {
  // Access config through the public methods
  const isEnabled = debugLogger.isEnabled();

  return `${chalk.yellow('DEBUG CONFIGURATION')}
${chalk.gray('─'.repeat(50))}

${chalk.cyan('Current Settings:')}
  Enabled: ${isEnabled ? chalk.green('YES') : chalk.red('NO')}

${chalk.cyan('Feature Flags:')}
  Use these commands to toggle features:
    /debug api on|off     - API request/response logging
    /debug tools on|off   - Tool call tracing
    /debug verbose        - Enable all features

${chalk.cyan('Environment Variables:')}
  DEBUG=true|1|codebuddy  - Enable debug mode
  DEBUG_LEVEL=verbose|normal|minimal
  DEBUG_OUTPUT=console|file|both
  DEBUG_FILE=<path>       - Custom log file
  DEBUG_JSON=true         - JSON output format
  DEBUG_TIMING=true       - Detailed timing
  DEBUG_API=true          - API logging
  DEBUG_TOOLS=true        - Tool tracing
  DEBUG_PROMPTS=true      - Prompt dumps`;
}

/**
 * Handle stack trace capture
 */
function handleStackTrace(context?: string): string {
  const stack = new Error('Debug Stack Trace').stack;

  const lines: string[] = [
    chalk.yellow('STACK TRACE'),
    chalk.gray('─'.repeat(50)),
  ];

  if (context) {
    lines.push(`Context: ${context}`);
    lines.push('');
  }

  lines.push(chalk.cyan('Current Stack:'));
  lines.push(stack || 'No stack trace available');

  return lines.join('\n');
}

/**
 * Format debug help
 */
function formatDebugHelp(): string {
  return `${chalk.yellow('DEBUG MODE COMMANDS')}
${chalk.gray('─'.repeat(50))}

${chalk.cyan('Basic:')}
  /debug on              Enable debug mode
  /debug off             Disable debug mode
  /debug status          Show debug status
  /debug verbose         Enable all debug features

${chalk.cyan('Inspection:')}
  /debug dump context    Dump current context
  /debug dump api        Dump API call history
  /debug dump tools      Dump tool call history
  /debug dump prompts    Dump prompt history
  /debug dump all        Dump everything

${chalk.cyan('Analysis:')}
  /debug timing          Show timing summary
  /debug replay <id>     Replay a specific request
  /debug stack [msg]     Capture stack trace

${chalk.cyan('Data Management:')}
  /debug export          Export debug data to file
  /debug clear           Clear all debug logs

${chalk.cyan('Configuration:')}
  /debug level <level>   Set level (verbose|normal|minimal)
  /debug config          Show configuration
  /debug api on|off      Toggle API logging
  /debug tools on|off    Toggle tool tracing

${chalk.gray('─'.repeat(50))}
${chalk.gray('Tip: Start with /debug on, then use /debug dump as needed')}`;
}

// ============================================================================
// Utility Functions
// ============================================================================

function truncateWithEllipsis(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

function summarizeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 30 ? `"${value.substring(0, 27)}..."` : `"${value}"`;
  }
  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).length} keys}`;
  }
  return String(value);
}
