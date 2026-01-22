/**
 * Enhanced Debug Logger for Grok CLI
 *
 * Provides comprehensive debugging capabilities:
 * - Verbose API call logging with full request/response dumps
 * - Detailed timing for each operation step
 * - Tool call tracing with full context
 * - Structured JSON output for analysis
 *
 * Activation:
 * - --debug flag on CLI
 * - DEBUG=true or DEBUG=1 environment variable
 * - DEBUG=codebuddy for component-specific debug
 *
 * Environment Variables:
 * - DEBUG=true|1|codebuddy: Enable debug mode
 * - DEBUG_LEVEL=verbose|normal|minimal: Debug verbosity
 * - DEBUG_OUTPUT=console|file|both: Output destination
 * - DEBUG_FILE=path: Custom debug log file path
 * - DEBUG_JSON=true: Force JSON format for all output
 * - DEBUG_TIMING=true: Enable detailed timing measurements
 * - DEBUG_API=true: Log full API requests/responses
 * - DEBUG_TOOLS=true: Log tool call details
 * - DEBUG_PROMPTS=true: Dump system/user prompts
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { logger, LogContext, LogEntry } from './logger.js';

export type DebugLevel = 'verbose' | 'normal' | 'minimal';
export type DebugOutput = 'console' | 'file' | 'both';

export interface DebugConfig {
  enabled: boolean;
  level: DebugLevel;
  output: DebugOutput;
  filePath?: string;
  jsonFormat: boolean;
  timing: boolean;
  api: boolean;
  tools: boolean;
  prompts: boolean;
}

export interface TimingEntry {
  label: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface APICallLog {
  timestamp: string;
  requestId: string;
  method: string;
  endpoint: string;
  model: string;
  messages: Array<{
    role: string;
    contentPreview: string;
    contentLength: number;
    hasToolCalls?: boolean;
  }>;
  tools?: Array<{
    name: string;
    description: string;
  }>;
  options?: Record<string, unknown>;
  response?: {
    status: string;
    contentPreview: string;
    contentLength: number;
    toolCalls?: Array<{
      id: string;
      name: string;
      argumentsPreview: string;
    }>;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  durationMs: number;
}

export interface ToolCallLog {
  timestamp: string;
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  argumentsRaw: string;
  result?: {
    success: boolean;
    output?: string;
    outputLength?: number;
    error?: string;
  };
  durationMs: number;
  roundNumber: number;
}

export interface PromptDump {
  timestamp: string;
  type: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  contentLength: number;
  tokenEstimate?: number;
  metadata?: Record<string, unknown>;
}

export interface ContextSnapshot {
  timestamp: string;
  label: string;
  conversationLength: number;
  contextLength: number;
  systemPromptLength: number;
  activeTools: string[];
  model?: string;
  tokenCount?: number;
  snapshot: {
    conversationPreview?: Array<{ type: string; preview: string }>;
    contextPreview?: string;
    systemPromptPreview?: string;
  };
}

export interface StackTraceEntry {
  timestamp: string;
  label: string;
  stack: string;
  errorName?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Check if debug mode is enabled via environment or flag
 */
function isDebugModeEnabled(): boolean {
  const debug = process.env.DEBUG;
  return (
    debug === 'true' ||
    debug === '1' ||
    debug === 'codebuddy' ||
    process.env.GROK_DEBUG === 'true'
  );
}

/**
 * Get debug level from environment
 */
function getDebugLevel(): DebugLevel {
  const level = process.env.DEBUG_LEVEL?.toLowerCase();
  if (level === 'verbose' || level === 'normal' || level === 'minimal') {
    return level;
  }
  return 'normal';
}

/**
 * Get debug output mode from environment
 */
function getDebugOutput(): DebugOutput {
  const output = process.env.DEBUG_OUTPUT?.toLowerCase();
  if (output === 'console' || output === 'file' || output === 'both') {
    return output;
  }
  return 'console';
}

/**
 * Enhanced Debug Logger class
 */
export class DebugLogger {
  private config: DebugConfig;
  private fileStream?: fs.WriteStream;
  private timings: Map<string, TimingEntry> = new Map();
  private apiLogs: APICallLog[] = [];
  private toolLogs: ToolCallLog[] = [];
  private promptDumps: PromptDump[] = [];
  private requestCounter = 0;
  private sessionStartTime: number;

  constructor(config?: Partial<DebugConfig>) {
    this.sessionStartTime = Date.now();

    this.config = {
      enabled: config?.enabled ?? isDebugModeEnabled(),
      level: config?.level ?? getDebugLevel(),
      output: config?.output ?? getDebugOutput(),
      filePath: config?.filePath ?? process.env.DEBUG_FILE,
      jsonFormat: config?.jsonFormat ?? (process.env.DEBUG_JSON === 'true'),
      timing: config?.timing ?? (process.env.DEBUG_TIMING === 'true' || isDebugModeEnabled()),
      api: config?.api ?? (process.env.DEBUG_API === 'true' || isDebugModeEnabled()),
      tools: config?.tools ?? (process.env.DEBUG_TOOLS === 'true' || isDebugModeEnabled()),
      prompts: config?.prompts ?? (process.env.DEBUG_PROMPTS === 'true'),
    };

    if (this.config.enabled && (this.config.output === 'file' || this.config.output === 'both')) {
      this.initializeFileLogging();
    }

    if (this.config.enabled) {
      this.logDebugBanner();
    }
  }

  /**
   * Initialize file logging for debug output
   */
  private initializeFileLogging(): void {
    const defaultPath = path.join(process.cwd(), '.codebuddy', 'debug.log');
    const logPath = this.config.filePath || defaultPath;

    try {
      const logDir = path.dirname(logPath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      this.fileStream = fs.createWriteStream(logPath, { flags: 'a' });
      this.writeToFile(`\n${'='.repeat(80)}\nDebug session started: ${new Date().toISOString()}\n${'='.repeat(80)}\n`);
    } catch (err) {
      console.error(`Failed to initialize debug log file: ${logPath}`, err);
    }
  }

  /**
   * Log debug mode banner
   */
  private logDebugBanner(): void {
    const banner = `
${chalk.yellow('=')}${chalk.yellow('='.repeat(60))}${chalk.yellow('=')}
${chalk.yellow('DEBUG MODE ENABLED')}
${chalk.gray('Level:')} ${this.config.level}
${chalk.gray('Output:')} ${this.config.output}
${chalk.gray('API Logging:')} ${this.config.api ? 'ON' : 'OFF'}
${chalk.gray('Tool Tracing:')} ${this.config.tools ? 'ON' : 'OFF'}
${chalk.gray('Timing:')} ${this.config.timing ? 'ON' : 'OFF'}
${chalk.gray('Prompt Dump:')} ${this.config.prompts ? 'ON' : 'OFF'}
${chalk.yellow('=')}${chalk.yellow('='.repeat(60))}${chalk.yellow('=')}
`;
    if (this.config.output !== 'file') {
      console.log(banner);
    }
  }

  /**
   * Check if debug is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable or disable debug mode
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (enabled && !this.fileStream && (this.config.output === 'file' || this.config.output === 'both')) {
      this.initializeFileLogging();
    }
  }

  /**
   * Update debug configuration
   */
  updateConfig(config: Partial<DebugConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Write to file stream
   */
  private writeToFile(content: string): void {
    if (this.fileStream) {
      this.fileStream.write(content + '\n');
    }
  }

  /**
   * Format and output debug message
   */
  private output(category: string, message: string, data?: Record<string, unknown>): void {
    if (!this.config.enabled) return;

    const timestamp = new Date().toISOString();
    const elapsed = Date.now() - this.sessionStartTime;

    if (this.config.jsonFormat) {
      const jsonOutput = JSON.stringify({
        timestamp,
        elapsedMs: elapsed,
        category,
        message,
        ...data,
      });
      if (this.config.output !== 'file') {
        console.log(jsonOutput);
      }
      this.writeToFile(jsonOutput);
    } else {
      const prefix = chalk.gray(`[${timestamp}]`) + chalk.cyan(` [${category}]`);
      const formattedMessage = `${prefix} ${message}`;

      if (this.config.output !== 'file') {
        console.log(formattedMessage);
        if (data && this.config.level === 'verbose') {
          console.log(chalk.gray(JSON.stringify(data, null, 2)));
        }
      }

      this.writeToFile(`[${timestamp}] [${category}] ${message}`);
      if (data) {
        this.writeToFile(JSON.stringify(data, null, 2));
      }
    }
  }

  // ============================================================================
  // Timing Methods
  // ============================================================================

  /**
   * Start a timing measurement
   */
  startTiming(label: string, metadata?: Record<string, unknown>): void {
    if (!this.config.enabled || !this.config.timing) return;

    const entry: TimingEntry = {
      label,
      startTime: performance.now(),
      metadata,
    };
    this.timings.set(label, entry);
    this.output('TIMING', `Started: ${label}`, metadata);
  }

  /**
   * End a timing measurement and return duration
   */
  endTiming(label: string, additionalMetadata?: Record<string, unknown>): number | undefined {
    if (!this.config.enabled || !this.config.timing) return undefined;

    const entry = this.timings.get(label);
    if (!entry) {
      this.output('TIMING', `Warning: No timing entry found for "${label}"`);
      return undefined;
    }

    entry.endTime = performance.now();
    entry.durationMs = entry.endTime - entry.startTime;
    if (additionalMetadata) {
      entry.metadata = { ...entry.metadata, ...additionalMetadata };
    }

    const durationStr = entry.durationMs.toFixed(2);
    this.output('TIMING', `Completed: ${label} (${durationStr}ms)`, {
      durationMs: entry.durationMs,
      ...entry.metadata,
    });

    return entry.durationMs;
  }

  /**
   * Create a timing wrapper for async functions
   */
  async timeAsync<T>(label: string, fn: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T> {
    this.startTiming(label, metadata);
    try {
      const result = await fn();
      this.endTiming(label, { success: true });
      return result;
    } catch (error) {
      this.endTiming(label, { success: false, error: String(error) });
      throw error;
    }
  }

  /**
   * Get all timing entries
   */
  getTimings(): TimingEntry[] {
    return Array.from(this.timings.values());
  }

  // ============================================================================
  // API Call Logging
  // ============================================================================

  /**
   * Log an API request
   */
  logAPIRequest(
    method: string,
    endpoint: string,
    model: string,
    messages: Array<{ role: string; content: string | null; tool_calls?: unknown[] }>,
    tools?: Array<{ function: { name: string; description: string } }>,
    options?: Record<string, unknown>
  ): string {
    if (!this.config.enabled || !this.config.api) return '';

    const requestId = `req_${++this.requestCounter}_${Date.now()}`;

    const log: APICallLog = {
      timestamp: new Date().toISOString(),
      requestId,
      method,
      endpoint,
      model,
      messages: messages.map((m) => ({
        role: m.role,
        contentPreview: this.truncate(String(m.content || ''), 200),
        contentLength: String(m.content || '').length,
        hasToolCalls: Array.isArray(m.tool_calls) && m.tool_calls.length > 0,
      })),
      tools: tools?.map((t) => ({
        name: t.function.name,
        description: this.truncate(t.function.description, 100),
      })),
      options,
      durationMs: 0,
    };

    this.apiLogs.push(log);

    this.output('API-REQUEST', `${method} ${endpoint}`, {
      requestId,
      model,
      messageCount: messages.length,
      toolCount: tools?.length || 0,
    });

    // Dump full prompts if enabled
    if (this.config.prompts) {
      for (const msg of messages) {
        this.dumpPrompt(msg.role as PromptDump['type'], String(msg.content || ''));
      }
    }

    return requestId;
  }

  /**
   * Log an API response
   */
  logAPIResponse(
    requestId: string,
    status: string,
    content: string | null,
    toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>,
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
    durationMs?: number
  ): void {
    if (!this.config.enabled || !this.config.api) return;

    const log = this.apiLogs.find((l) => l.requestId === requestId);
    if (log) {
      log.response = {
        status,
        contentPreview: this.truncate(content || '', 200),
        contentLength: (content || '').length,
        toolCalls: toolCalls?.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          argumentsPreview: this.truncate(tc.function.arguments, 100),
        })),
        usage: usage
          ? {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens,
            }
          : undefined,
      };
      log.durationMs = durationMs || 0;
    }

    this.output('API-RESPONSE', `${requestId} - ${status}`, {
      requestId,
      contentLength: (content || '').length,
      toolCallCount: toolCalls?.length || 0,
      usage,
      durationMs,
    });
  }

  /**
   * Log an API error
   */
  logAPIError(requestId: string, error: Error, durationMs?: number): void {
    if (!this.config.enabled || !this.config.api) return;

    const log = this.apiLogs.find((l) => l.requestId === requestId);
    if (log) {
      log.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
      log.durationMs = durationMs || 0;
    }

    this.output('API-ERROR', `${requestId} - ${error.name}: ${error.message}`, {
      requestId,
      errorName: error.name,
      errorMessage: error.message,
      durationMs,
    });
  }

  // ============================================================================
  // Tool Call Tracing
  // ============================================================================

  /**
   * Log a tool call
   */
  logToolCall(
    callId: string,
    toolName: string,
    argumentsRaw: string,
    roundNumber: number
  ): void {
    if (!this.config.enabled || !this.config.tools) return;

    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(argumentsRaw);
    } catch {
      parsedArgs = { raw: argumentsRaw };
    }

    const log: ToolCallLog = {
      timestamp: new Date().toISOString(),
      callId,
      toolName,
      arguments: parsedArgs,
      argumentsRaw,
      durationMs: 0,
      roundNumber,
    };

    this.toolLogs.push(log);

    this.output('TOOL-CALL', `[Round ${roundNumber}] ${toolName}`, {
      callId,
      toolName,
      arguments: this.config.level === 'verbose' ? parsedArgs : this.summarizeArgs(parsedArgs),
      roundNumber,
    });
  }

  /**
   * Log a tool result
   */
  logToolResult(
    callId: string,
    success: boolean,
    output?: string,
    error?: string,
    durationMs?: number
  ): void {
    if (!this.config.enabled || !this.config.tools) return;

    const log = this.toolLogs.find((l) => l.callId === callId);
    if (log) {
      log.result = {
        success,
        output: this.config.level === 'verbose' ? output : this.truncate(output || '', 200),
        outputLength: output?.length,
        error,
      };
      log.durationMs = durationMs || 0;
    }

    const statusIcon = success ? chalk.green('[OK]') : chalk.red('[FAIL]');
    this.output('TOOL-RESULT', `${statusIcon} ${callId}`, {
      callId,
      success,
      outputLength: output?.length,
      error,
      durationMs,
    });
  }

  // ============================================================================
  // Prompt Dumping
  // ============================================================================

  /**
   * Dump a prompt for analysis
   */
  dumpPrompt(type: PromptDump['type'], content: string, metadata?: Record<string, unknown>): void {
    if (!this.config.enabled || !this.config.prompts) return;

    const dump: PromptDump = {
      timestamp: new Date().toISOString(),
      type,
      content,
      contentLength: content.length,
      tokenEstimate: Math.ceil(content.length / 4), // Rough estimate
      metadata,
    };

    this.promptDumps.push(dump);

    if (this.config.level === 'verbose') {
      this.output('PROMPT', `[${type.toUpperCase()}] (${content.length} chars)`, {
        type,
        contentLength: content.length,
        preview: this.truncate(content, 500),
      });
    }
  }

  // ============================================================================
  // General Debug Methods
  // ============================================================================

  /**
   * Log a debug message
   */
  debug(message: string, context?: LogContext): void {
    if (!this.config.enabled) return;
    this.output('DEBUG', message, context);
  }

  /**
   * Log verbose debug message (only in verbose mode)
   */
  verbose(message: string, context?: LogContext): void {
    if (!this.config.enabled || this.config.level !== 'verbose') return;
    this.output('VERBOSE', message, context);
  }

  /**
   * Log a trace message with stack
   */
  trace(message: string, context?: LogContext): void {
    if (!this.config.enabled) return;
    const stack = new Error().stack?.split('\n').slice(2).join('\n');
    this.output('TRACE', message, { ...context, stack });
  }

  // ============================================================================
  // Summary and Export
  // ============================================================================

  /**
   * Get debug session summary
   */
  getSessionSummary(): {
    sessionDuration: number;
    apiCallCount: number;
    totalApiDuration: number;
    avgApiDuration: number;
    toolCallCount: number;
    totalToolDuration: number;
    avgToolDuration: number;
    toolSuccessRate: number;
    timingEntries: number;
  } {
    const sessionDuration = Date.now() - this.sessionStartTime;

    const totalApiDuration = this.apiLogs.reduce((sum, l) => sum + l.durationMs, 0);
    const avgApiDuration = this.apiLogs.length > 0 ? totalApiDuration / this.apiLogs.length : 0;

    const toolsWithResults = this.toolLogs.filter((l) => l.result);
    const totalToolDuration = toolsWithResults.reduce((sum, l) => sum + l.durationMs, 0);
    const avgToolDuration = toolsWithResults.length > 0 ? totalToolDuration / toolsWithResults.length : 0;

    const successfulTools = toolsWithResults.filter((l) => l.result?.success).length;
    const toolSuccessRate = toolsWithResults.length > 0 ? (successfulTools / toolsWithResults.length) * 100 : 100;

    return {
      sessionDuration,
      apiCallCount: this.apiLogs.length,
      totalApiDuration,
      avgApiDuration,
      toolCallCount: this.toolLogs.length,
      totalToolDuration,
      avgToolDuration,
      toolSuccessRate,
      timingEntries: this.timings.size,
    };
  }

  /**
   * Format session summary for display
   */
  formatSessionSummary(): string {
    const summary = this.getSessionSummary();

    return `
${chalk.yellow('=')}${chalk.yellow('='.repeat(40))}${chalk.yellow('=')}
${chalk.yellow('DEBUG SESSION SUMMARY')}
${chalk.gray('Duration:')} ${(summary.sessionDuration / 1000).toFixed(2)}s

${chalk.cyan('API Calls:')}
  Total: ${summary.apiCallCount}
  Total Duration: ${summary.totalApiDuration.toFixed(0)}ms
  Avg Duration: ${summary.avgApiDuration.toFixed(0)}ms

${chalk.cyan('Tool Calls:')}
  Total: ${summary.toolCallCount}
  Total Duration: ${summary.totalToolDuration.toFixed(0)}ms
  Avg Duration: ${summary.avgToolDuration.toFixed(0)}ms
  Success Rate: ${summary.toolSuccessRate.toFixed(1)}%

${chalk.cyan('Timing Entries:')} ${summary.timingEntries}
${chalk.yellow('=')}${chalk.yellow('='.repeat(40))}${chalk.yellow('=')}
`;
  }

  /**
   * Export all debug data as JSON
   */
  exportAsJSON(): string {
    return JSON.stringify(
      {
        sessionStartTime: new Date(this.sessionStartTime).toISOString(),
        config: this.config,
        summary: this.getSessionSummary(),
        apiLogs: this.apiLogs,
        toolLogs: this.toolLogs,
        promptDumps: this.promptDumpts,
        timings: Array.from(this.timings.values()),
      },
      null,
      2
    );
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this.apiLogs = [];
    this.toolLogs = [];
    this.promptDumps = [];
    this.timings.clear();
    this.contextSnapshots = [];
    this.stackTraces = [];
  }

  // ============================================================================
  // Context Snapshot Management
  // ============================================================================

  private contextSnapshots: ContextSnapshot[] = [];
  private stackTraces: StackTraceEntry[] = [];

  /**
   * Capture a context snapshot
   */
  captureContext(
    label: string,
    context: {
      conversationHistory?: Array<{ type: string; content: string }>;
      currentContext?: string;
      systemPrompt?: string;
      activeTools?: string[];
      model?: string;
      tokenCount?: number;
    }
  ): void {
    if (!this.config.enabled) return;

    const snapshot: ContextSnapshot = {
      timestamp: new Date().toISOString(),
      label,
      conversationLength: context.conversationHistory?.length || 0,
      contextLength: context.currentContext?.length || 0,
      systemPromptLength: context.systemPrompt?.length || 0,
      activeTools: context.activeTools || [],
      model: context.model,
      tokenCount: context.tokenCount,
      snapshot: {
        conversationPreview: context.conversationHistory?.slice(-3).map(m => ({
          type: m.type,
          preview: m.content.substring(0, 100),
        })),
        contextPreview: context.currentContext?.substring(0, 500),
        systemPromptPreview: context.systemPrompt?.substring(0, 300),
      },
    };

    this.contextSnapshots.push(snapshot);

    this.output('CONTEXT', `Snapshot: ${label}`, {
      conversationLength: snapshot.conversationLength,
      contextLength: snapshot.contextLength,
      tokenCount: snapshot.tokenCount,
    });
  }

  /**
   * Get context snapshots
   */
  getContextSnapshots(): ContextSnapshot[] {
    return [...this.contextSnapshots];
  }

  // ============================================================================
  // Stack Trace Management
  // ============================================================================

  /**
   * Capture a detailed stack trace with context
   */
  captureStackTrace(label: string, error?: Error, metadata?: Record<string, unknown>): void {
    if (!this.config.enabled) return;

    const stack = error?.stack || new Error('Stack Trace').stack || '';
    const cleanedStack = this.cleanStackTrace(stack);

    const entry: StackTraceEntry = {
      timestamp: new Date().toISOString(),
      label,
      stack: cleanedStack,
      errorName: error?.name,
      errorMessage: error?.message,
      metadata,
    };

    this.stackTraces.push(entry);

    this.output('STACK', label, {
      errorName: error?.name,
      errorMessage: error?.message,
      stackDepth: cleanedStack.split('\n').length,
    });
  }

  /**
   * Get stack traces
   */
  getStackTraces(): StackTraceEntry[] {
    return [...this.stackTraces];
  }

  /**
   * Clean and format a stack trace
   */
  private cleanStackTrace(stack: string): string {
    return stack
      .split('\n')
      .filter(line => !line.includes('debug-logger.ts'))
      .filter(line => !line.includes('node:internal'))
      .slice(0, 20) // Limit depth
      .join('\n');
  }

  // ============================================================================
  // Request Replay Support
  // ============================================================================

  /**
   * Get a specific API log by request ID
   */
  getAPILog(requestId: string): APICallLog | undefined {
    return this.apiLogs.find(l => l.requestId === requestId);
  }

  /**
   * Get API logs for replay
   */
  getAPILogs(): APICallLog[] {
    return [...this.apiLogs];
  }

  /**
   * Get tool logs
   */
  getToolLogs(): ToolCallLog[] {
    return [...this.toolLogs];
  }

  /**
   * Get a tool call by ID
   */
  getToolLog(callId: string): ToolCallLog | undefined {
    return this.toolLogs.find(l => l.callId === callId);
  }

  /**
   * Close file stream
   */
  close(): void {
    if (this.config.enabled) {
      this.output('DEBUG', 'Session ended');
      this.output('SUMMARY', this.formatSessionSummary());
    }
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = undefined;
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
  }

  private summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const summary: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.length > 100) {
        summary[key] = `<string:${value.length} chars>`;
      } else if (Array.isArray(value)) {
        summary[key] = `<array:${value.length} items>`;
      } else if (typeof value === 'object' && value !== null) {
        summary[key] = `<object:${Object.keys(value).length} keys>`;
      } else {
        summary[key] = value;
      }
    }
    return summary;
  }

  // Fix typo in exportAsJSON
  private get promptDumpts(): PromptDump[] {
    return this.promptDumps;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let debugLoggerInstance: DebugLogger | null = null;

/**
 * Get the global DebugLogger instance
 */
export function getDebugLogger(): DebugLogger {
  if (!debugLoggerInstance) {
    debugLoggerInstance = new DebugLogger();
  }
  return debugLoggerInstance;
}

/**
 * Create a new DebugLogger instance with custom config
 */
export function createDebugLogger(config?: Partial<DebugConfig>): DebugLogger {
  return new DebugLogger(config);
}

/**
 * Reset the global DebugLogger instance (for testing)
 */
export function resetDebugLogger(): void {
  if (debugLoggerInstance) {
    debugLoggerInstance.close();
    debugLoggerInstance = null;
  }
}

/**
 * Quick debug check - returns true if debug mode is enabled
 */
export function isDebugEnabled(): boolean {
  return getDebugLogger().isEnabled();
}

// Convenience export for direct use
export const debugLogger = {
  isEnabled: () => getDebugLogger().isEnabled(),
  setEnabled: (enabled: boolean) => getDebugLogger().setEnabled(enabled),
  updateConfig: (config: Partial<DebugConfig>) => getDebugLogger().updateConfig(config),
  debug: (message: string, context?: LogContext) => getDebugLogger().debug(message, context),
  verbose: (message: string, context?: LogContext) => getDebugLogger().verbose(message, context),
  trace: (message: string, context?: LogContext) => getDebugLogger().trace(message, context),
  startTiming: (label: string, metadata?: Record<string, unknown>) => getDebugLogger().startTiming(label, metadata),
  endTiming: (label: string, metadata?: Record<string, unknown>) => getDebugLogger().endTiming(label, metadata),
  timeAsync: <T>(label: string, fn: () => Promise<T>, metadata?: Record<string, unknown>) => getDebugLogger().timeAsync(label, fn, metadata),
  getTimings: () => getDebugLogger().getTimings(),
  logAPIRequest: (...args: Parameters<DebugLogger['logAPIRequest']>) => getDebugLogger().logAPIRequest(...args),
  logAPIResponse: (...args: Parameters<DebugLogger['logAPIResponse']>) => getDebugLogger().logAPIResponse(...args),
  logAPIError: (...args: Parameters<DebugLogger['logAPIError']>) => getDebugLogger().logAPIError(...args),
  getAPILog: (requestId: string) => getDebugLogger().getAPILog(requestId),
  getAPILogs: () => getDebugLogger().getAPILogs(),
  logToolCall: (...args: Parameters<DebugLogger['logToolCall']>) => getDebugLogger().logToolCall(...args),
  logToolResult: (...args: Parameters<DebugLogger['logToolResult']>) => getDebugLogger().logToolResult(...args),
  getToolLog: (callId: string) => getDebugLogger().getToolLog(callId),
  getToolLogs: () => getDebugLogger().getToolLogs(),
  dumpPrompt: (...args: Parameters<DebugLogger['dumpPrompt']>) => getDebugLogger().dumpPrompt(...args),
  captureContext: (...args: Parameters<DebugLogger['captureContext']>) => getDebugLogger().captureContext(...args),
  getContextSnapshots: () => getDebugLogger().getContextSnapshots(),
  captureStackTrace: (...args: Parameters<DebugLogger['captureStackTrace']>) => getDebugLogger().captureStackTrace(...args),
  getStackTraces: () => getDebugLogger().getStackTraces(),
  getSessionSummary: () => getDebugLogger().getSessionSummary(),
  formatSessionSummary: () => getDebugLogger().formatSessionSummary(),
  exportAsJSON: () => getDebugLogger().exportAsJSON(),
  clear: () => getDebugLogger().clear(),
  close: () => getDebugLogger().close(),
};
