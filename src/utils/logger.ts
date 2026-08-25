/**
 * Structured Logger for Code Buddy
 * Provides consistent logging across the application with levels and context
 *
 * Environment Variables:
 * - DEBUG=true or DEBUG=1: Enable debug mode (sets log level to 'debug')
 * - LOG_LEVEL=debug|info|warn|error: Set specific log level
 * - LOG_FORMAT=json|text: Output format (default: text)
 * - LOG_FILE=path: Write logs to file (in addition to console)
 * - NO_COLOR=1: Disable colored output
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { scrubSecrets, scrubValue } from '../security/secret-scrubber.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'text' | 'json';

export interface LogContext {
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  source?: string;
}

export interface LoggerOptions {
  level: LogLevel;
  format: LogFormat;
  enableColors: boolean;
  enableTimestamps: boolean;
  source?: string;
  silent?: boolean;
  logFile?: string;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_LEVEL_COLORS: Record<LogLevel, (text: string) => string> = {
  debug: chalk.gray,
  info: chalk.blue,
  warn: chalk.yellow,
  error: chalk.red,
};

const LOG_LEVEL_ICONS: Record<LogLevel, string> = {
  debug: '🔍',
  info: 'ℹ️',
  warn: '⚠️',
  error: '❌',
};

/**
 * Check if debug mode is enabled via environment
 */
function isDebugEnabled(): boolean {
  const debug = process.env.DEBUG;
  return debug === 'true' || debug === '1' || debug === 'codebuddy';
}

/**
 * Get log level from environment
 */
function getLogLevelFromEnv(): LogLevel {
  if (isDebugEnabled()) {
    return 'debug';
  }
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level && ['debug', 'info', 'warn', 'error'].includes(level)) {
    return level as LogLevel;
  }
  return 'info';
}

/** Default max log file size: 10MB */
const DEFAULT_LOG_MAX_SIZE = 10 * 1024 * 1024;
/** Default max rotated log files */
const DEFAULT_LOG_MAX_FILES = 5;
/** Check rotation every N writes to avoid stat() on every line */
const ROTATION_CHECK_INTERVAL = 100;

/**
 * Structured Logger class
 */
export class Logger {
  private options: LoggerOptions;
  private logHistory: LogEntry[] = [];
  private maxHistorySize = 1000;
  private fileStream?: fs.WriteStream;

  /** Log rotation: max file size in bytes */
  private logMaxSize: number;
  /** Log rotation: max rotated files to keep */
  private logMaxFiles: number;
  /** Counter for batched rotation checks */
  private writesSinceRotationCheck: number = 0;
  /** Guard against concurrent rotation */
  private isRotating: boolean = false;

  constructor(options: Partial<LoggerOptions> = {}) {
    this.options = {
      level: getLogLevelFromEnv(),
      format: (process.env.LOG_FORMAT as LogFormat) || 'text',
      enableColors: !process.env.NO_COLOR && (process.stdout.isTTY ?? true),
      enableTimestamps: true,
      silent: process.env.NODE_ENV === 'test',
      logFile: process.env.LOG_FILE,
      ...options,
    };

    // Parse rotation config from environment
    const envMaxSize = Number(process.env.LOG_MAX_SIZE);
    this.logMaxSize = Number.isFinite(envMaxSize) && envMaxSize > 0
      ? envMaxSize
      : DEFAULT_LOG_MAX_SIZE;

    const envMaxFiles = Number(process.env.LOG_MAX_FILES);
    this.logMaxFiles = Number.isFinite(envMaxFiles) && envMaxFiles > 0
      ? envMaxFiles
      : DEFAULT_LOG_MAX_FILES;

    // Initialize file stream if configured
    if (this.options.logFile) {
      this.initializeFileLogging(this.options.logFile);
    }
  }

  /**
   * Initialize file logging
   */
  private initializeFileLogging(logFile: string): void {
    try {
      const logDir = path.dirname(logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      this.fileStream = fs.createWriteStream(logFile, { flags: 'a' });
      // Attach error handler to prevent uncaught exceptions during rotation/cleanup
      this.fileStream.on('error', () => {
        // Silently discard write errors — the stream may be closed during rotation
        this.fileStream = undefined;
      });
    } catch (err) {
      console.error(`Failed to initialize log file: ${logFile}`, err);
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(source: string): Logger {
    return new Logger({
      ...this.options,
      source,
    });
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.options.level = level;
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.options.level;
  }

  /**
   * Enable or disable silent mode
   */
  setSilent(silent: boolean): void {
    this.options.silent = silent;
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.options.level];
  }

  /**
   * Format timestamp
   */
  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Format log entry for output
   */
  /** Safe JSON.stringify that handles circular references and Error objects */
  private safeStringify(obj: unknown): string {
    const seen = new WeakSet();
    return JSON.stringify(obj, (_key, value) => {
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
  }

  private formatEntry(entry: LogEntry): string {
    // JSON format
    if (this.options.format === 'json') {
      return this.safeStringify({
        timestamp: entry.timestamp,
        level: entry.level,
        source: entry.source,
        message: entry.message,
        ...entry.context,
      });
    }

    // Text format
    const parts: string[] = [];
    const color = this.options.enableColors ? LOG_LEVEL_COLORS[entry.level] : (s: string) => s;
    const icon = this.options.enableColors ? LOG_LEVEL_ICONS[entry.level] : '';

    // Timestamp
    if (this.options.enableTimestamps) {
      parts.push(chalk.gray(`[${entry.timestamp}]`));
    }

    // Level with icon
    parts.push(color(`${icon} ${entry.level.toUpperCase().padEnd(5)}`));

    // Source
    if (entry.source) {
      parts.push(chalk.cyan(`[${entry.source}]`));
    }

    // Message
    parts.push(entry.message);

    // Context
    if (entry.context && Object.keys(entry.context).length > 0) {
      const contextStr = this.safeStringify(entry.context);
      parts.push(chalk.gray(contextStr));
    }

    return parts.join(' ');
  }

  /**
   * Core log method
   */
  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) {
      return;
    }

    // Scrub secrets from the message and any structured context BEFORE the
    // entry is stored, printed, or written to disk. Secret-free values are
    // returned reference-identical, so normal logs are byte-for-byte unchanged.
    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level,
      message: scrubSecrets(message),
      context: context ? (scrubValue(context) as LogContext) : context,
      source: this.options.source,
    };

    // Store in history
    this.logHistory.push(entry);
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }

    // Output to console
    if (!this.options.silent) {
      // Re-scrub the fully rendered line as a final guard: safeStringify may
      // surface Error message/stack (non-enumerable, so invisible to
      // scrubValue) that could still carry a token. Idempotent + fast-path.
      const formatted = scrubSecrets(this.formatEntry(entry));
      // Route all log levels to stderr to avoid polluting stdout
      // (important for headless --output json mode)
      console.error(formatted);
    }

    // Output to file (always JSON for easy parsing)
    if (this.fileStream) {
      const jsonEntry = scrubSecrets(this.safeStringify({
        timestamp: entry.timestamp,
        level: entry.level,
        source: entry.source,
        message: entry.message,
        ...entry.context,
      }));
      this.fileStream.write(jsonEntry + '\n');

      // Check log rotation every ROTATION_CHECK_INTERVAL writes
      this.writesSinceRotationCheck++;
      if (this.writesSinceRotationCheck >= ROTATION_CHECK_INTERVAL) {
        this.writesSinceRotationCheck = 0;
        this.rotateIfNeeded();
      }
    }
  }

  /**
   * Check if debug logging is enabled
   */
  isDebugEnabled(): boolean {
    return this.options.level === 'debug';
  }

  /**
   * Close file stream
   */
  close(): void {
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = undefined;
    }
  }

  /**
   * Rotate log files if the current file exceeds the max size.
   *
   * Rotation scheme:
   *   codebuddy.log -> codebuddy.1.log
   *   codebuddy.1.log -> codebuddy.2.log
   *   ... up to logMaxFiles
   *   Oldest file beyond logMaxFiles is deleted.
   *
   * Non-blocking: rotation errors are silently ignored so logging continues.
   */
  private rotateIfNeeded(): void {
    const logFile = this.options.logFile;
    if (!logFile || this.isRotating) return;

    try {
      // Check current file size
      const stat = fs.statSync(logFile);
      if (stat.size < this.logMaxSize) return;

      this.isRotating = true;

      // Close current stream before rotation
      if (this.fileStream) {
        this.fileStream.end();
        this.fileStream = undefined;
      }

      // Shift existing rotated files (N -> N+1)
      for (let i = this.logMaxFiles - 1; i >= 1; i--) {
        const src = this.getRotatedPath(logFile, i);
        const dst = this.getRotatedPath(logFile, i + 1);
        try {
          if (fs.existsSync(src)) {
            if (i + 1 > this.logMaxFiles) {
              // Delete the oldest file beyond max
              fs.unlinkSync(src);
            } else {
              fs.renameSync(src, dst);
            }
          }
        } catch {
          // Ignore individual file rotation errors
        }
      }

      // Delete the file that would exceed max count
      try {
        const overflow = this.getRotatedPath(logFile, this.logMaxFiles + 1);
        if (fs.existsSync(overflow)) {
          fs.unlinkSync(overflow);
        }
      } catch {
        // Ignore
      }

      // Rename current log to .1.log
      try {
        const firstRotated = this.getRotatedPath(logFile, 1);
        fs.renameSync(logFile, firstRotated);
      } catch {
        // If rename fails, continue with a fresh file
      }

      // Reopen the file stream (fresh file)
      this.initializeFileLogging(logFile);
    } catch {
      // stat failed or other error — file may not exist yet, skip rotation
    } finally {
      this.isRotating = false;
    }
  }

  /**
   * Get the path for a rotated log file.
   * Example: codebuddy.log -> codebuddy.1.log
   */
  private getRotatedPath(logFile: string, index: number): string {
    const ext = path.extname(logFile);
    const base = logFile.slice(0, logFile.length - ext.length);
    return `${base}.${index}${ext}`;
  }

  /**
   * Debug level log
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * Info level log
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Warning level log
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * Error level log
   */
  error(message: string, context?: LogContext): void;
  error(message: string, error: Error, context?: LogContext): void;
  error(message: string, errorOrContext?: Error | LogContext, context?: LogContext): void {
    let finalContext: LogContext = {};

    if (errorOrContext instanceof Error) {
      finalContext = {
        errorName: errorOrContext.name,
        errorMessage: errorOrContext.message,
        errorStack: errorOrContext.stack,
        ...context,
      };
    } else if (errorOrContext) {
      finalContext = errorOrContext;
    }

    this.log('error', message, finalContext);
  }

  /**
   * Log with timing
   */
  time(label: string): () => void {
    const start = Date.now();
    this.debug(`Timer started: ${label}`);

    return () => {
      const duration = Date.now() - start;
      this.debug(`Timer ended: ${label}`, { durationMs: duration });
    };
  }

  /**
   * Get log history
   */
  getHistory(): LogEntry[] {
    return [...this.logHistory];
  }

  /**
   * Clear log history
   */
  clearHistory(): void {
    this.logHistory = [];
  }

  /**
   * Export logs as JSON
   */
  exportLogsAsJSON(): string {
    return JSON.stringify(this.logHistory, null, 2);
  }
}

// Default logger instance
let defaultLogger: Logger | null = null;

/**
 * Get the default log file path (~/.codebuddy/logs/codebuddy.log)
 * Returns undefined in test environment to avoid file I/O
 */
function getDefaultLogFile(): string | undefined {
  if (process.env.NODE_ENV === 'test') return undefined;
  // Respect explicit LOG_FILE env var (including empty string to disable)
  if (process.env.LOG_FILE !== undefined) return process.env.LOG_FILE || undefined;
  return path.join(homedir(), '.codebuddy', 'logs', 'codebuddy.log');
}

/**
 * Get the default logger instance
 */
export function getLogger(): Logger {
  if (!defaultLogger) {
    defaultLogger = new Logger({ logFile: getDefaultLogFile() });
  }
  return defaultLogger;
}

/**
 * Create a new logger instance
 */
export function createLogger(options?: Partial<LoggerOptions>): Logger {
  return new Logger(options);
}

/**
 * Reset the default logger (for testing)
 */
export function resetLogger(): void {
  defaultLogger = null;
}

// Convenience exports for direct use
export const logger = {
  debug: (message: string, context?: LogContext) => getLogger().debug(message, context),
  info: (message: string, context?: LogContext) => getLogger().info(message, context),
  warn: (message: string, context?: LogContext) => getLogger().warn(message, context),
  error: (message: string, errorOrContext?: Error | LogContext, context?: LogContext) => {
    if (errorOrContext instanceof Error) {
      getLogger().error(message, errorOrContext, context);
    } else {
      getLogger().error(message, errorOrContext);
    }
  },
  isDebugEnabled: () => getLogger().isDebugEnabled(),
  setLevel: (level: LogLevel) => getLogger().setLevel(level),
  // Exposé pour que l'appelant qui abaisse le niveau puisse RESTAURER le précédent.
  // `setLevel` seul invitait à supposer « c'était info » — ce qui est faux dès que
  // l'utilisateur a posé LOG_LEVEL ou DEBUG.
  getLevel: () => getLogger().getLevel(),
  time: (label: string) => getLogger().time(label),
  child: (source: string) => getLogger().child(source),
};

/**
 * Check if debug mode is enabled (for use outside logger)
 */
export { isDebugEnabled };

/**
 * Debug utility - only logs if DEBUG is enabled
 * Usage: debug('message') or debug('message', { context })
 */
export function debug(message: string, context?: LogContext): void {
  if (isDebugEnabled()) {
    getLogger().debug(message, context);
  }
}
