/**
 * Error Recovery System for Code Buddy
 *
 * Provides intelligent error handling with:
 * - Error classification and categorization
 * - Automatic recovery strategies
 * - User-friendly error messages
 * - Debugging context collection
 */

import { EventEmitter } from 'events';

export type ErrorCategory =
  | 'network'
  | 'api'
  | 'authentication'
  | 'rate_limit'
  | 'validation'
  | 'file_system'
  | 'permission'
  | 'timeout'
  | 'internal'
  | 'unknown';

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ClassifiedError {
  original: Error;
  category: ErrorCategory;
  severity: ErrorSeverity;
  recoverable: boolean;
  userMessage: string;
  technicalMessage: string;
  suggestedActions: string[];
  context: Record<string, unknown>;
  timestamp: Date;
}

export interface RecoveryStrategy {
  name: string;
  canRecover: (error: ClassifiedError) => boolean;
  recover: (error: ClassifiedError) => Promise<boolean>;
  maxAttempts: number;
}

/**
 * Error patterns for classification
 */
const ERROR_PATTERNS: Array<{
  pattern: RegExp | ((msg: string) => boolean);
  category: ErrorCategory;
  severity: ErrorSeverity;
  recoverable: boolean;
  userMessage: string;
  suggestedActions: string[];
}> = [
  // Network errors
  {
    pattern: /ECONNREFUSED|ENOTFOUND|ENETUNREACH|ECONNRESET|socket hang up/i,
    category: 'network',
    severity: 'medium',
    recoverable: true,
    userMessage: 'Unable to connect to the server. Please check your internet connection.',
    suggestedActions: [
      'Check your internet connection',
      'Verify the API endpoint is correct',
      'Try again in a few moments',
    ],
  },
  // Timeout
  {
    pattern: /timeout|ETIMEDOUT|timed out/i,
    category: 'timeout',
    severity: 'medium',
    recoverable: true,
    userMessage: 'The request took too long to complete.',
    suggestedActions: [
      'Try a simpler request',
      'Check your internet speed',
      'The server might be under heavy load',
    ],
  },
  // Rate limiting
  {
    pattern: /429|rate limit|too many requests|throttl/i,
    category: 'rate_limit',
    severity: 'low',
    recoverable: true,
    userMessage: 'Rate limit reached. Please wait before making more requests.',
    suggestedActions: [
      'Wait a few seconds before retrying',
      'Reduce request frequency',
      'Consider upgrading your API plan',
    ],
  },
  // Authentication
  {
    pattern: /401|unauthorized|invalid.*key|authentication|api.?key/i,
    category: 'authentication',
    severity: 'high',
    recoverable: false,
    userMessage: 'Authentication failed. Please check your API key.',
    suggestedActions: [
      'Verify your API key is correct',
      'Check if the API key has expired',
      'Ensure the API key has proper permissions',
    ],
  },
  // Permission
  {
    pattern: /403|forbidden|permission denied|access denied|EACCES/i,
    category: 'permission',
    severity: 'high',
    recoverable: false,
    userMessage: 'Permission denied. You do not have access to this resource.',
    suggestedActions: [
      'Check file permissions',
      'Verify you have the right access level',
      'Contact support if this persists',
    ],
  },
  // File system
  {
    pattern: /ENOENT|file not found|no such file|directory not found/i,
    category: 'file_system',
    severity: 'medium',
    recoverable: false,
    userMessage: 'File or directory not found.',
    suggestedActions: [
      'Check if the path is correct',
      'Verify the file exists',
      'Check for typos in the path',
    ],
  },
  // Validation
  {
    pattern: /invalid|malformed|bad request|400|validation/i,
    category: 'validation',
    severity: 'low',
    recoverable: false,
    userMessage: 'The request contains invalid data.',
    suggestedActions: [
      'Check your input parameters',
      'Review the request format',
      'Ensure all required fields are provided',
    ],
  },
  // API errors
  {
    pattern: /5\d\d|internal server error|service unavailable|bad gateway/i,
    category: 'api',
    severity: 'medium',
    recoverable: true,
    userMessage: 'The API service is temporarily unavailable.',
    suggestedActions: [
      'Wait a moment and try again',
      'Check the API status page',
      'Contact support if this persists',
    ],
  },
];

/**
 * Classify an error based on patterns
 */
export function classifyError(
  error: unknown,
  context: Record<string, unknown> = {}
): ClassifiedError {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message.toLowerCase();

  // Find matching pattern
  for (const pattern of ERROR_PATTERNS) {
    const matches =
      typeof pattern.pattern === 'function'
        ? pattern.pattern(message)
        : pattern.pattern.test(message);

    if (matches) {
      return {
        original: err,
        category: pattern.category,
        severity: pattern.severity,
        recoverable: pattern.recoverable,
        userMessage: pattern.userMessage,
        technicalMessage: err.message,
        suggestedActions: pattern.suggestedActions,
        context,
        timestamp: new Date(),
      };
    }
  }

  // Default classification
  return {
    original: err,
    category: 'unknown',
    severity: 'medium',
    recoverable: false,
    userMessage: 'An unexpected error occurred.',
    technicalMessage: err.message,
    suggestedActions: ['Try again', 'Check the logs for more details'],
    context,
    timestamp: new Date(),
  };
}

/**
 * Error Recovery Manager
 */
export class ErrorRecoveryManager extends EventEmitter {
  private strategies: RecoveryStrategy[] = [];
  private errorHistory: ClassifiedError[] = [];
  private maxHistory: number = 100;

  constructor() {
    super();
    this.registerDefaultStrategies();
  }

  /**
   * Register default recovery strategies
   */
  private registerDefaultStrategies(): void {
    // Retry strategy for network/API errors
    this.registerStrategy({
      name: 'retry',
      canRecover: (error) =>
        error.recoverable &&
        ['network', 'api', 'timeout'].includes(error.category),
      recover: async (_error) => {
        // Wait before retry (caller should implement actual retry)
        await this.sleep(1000);
        return true; // Signal that retry is possible
      },
      maxAttempts: 3,
    });

    // Wait strategy for rate limits
    this.registerStrategy({
      name: 'wait',
      canRecover: (error) => error.category === 'rate_limit',
      recover: async (_error) => {
        // Wait longer for rate limits
        await this.sleep(5000);
        return true;
      },
      maxAttempts: 5,
    });
  }

  /**
   * Register a recovery strategy
   */
  registerStrategy(strategy: RecoveryStrategy): void {
    this.strategies.push(strategy);
  }

  /**
   * Handle an error with automatic recovery
   */
  async handleError(
    error: unknown,
    context: Record<string, unknown> = {}
  ): Promise<{
    classified: ClassifiedError;
    recovered: boolean;
    strategy?: string;
  }> {
    const classified = classifyError(error, context);

    // Add to history
    this.errorHistory.push(classified);
    if (this.errorHistory.length > this.maxHistory) {
      this.errorHistory = this.errorHistory.slice(-this.maxHistory);
    }

    this.emit('error', classified);

    // Try recovery strategies
    if (classified.recoverable) {
      for (const strategy of this.strategies) {
        if (strategy.canRecover(classified)) {
          try {
            const recovered = await strategy.recover(classified);
            if (recovered) {
              this.emit('recovered', { error: classified, strategy: strategy.name });
              return { classified, recovered: true, strategy: strategy.name };
            }
          } catch {
            // Strategy failed, try next
          }
        }
      }
    }

    this.emit('unrecoverable', classified);
    return { classified, recovered: false };
  }

  /**
   * Format error for user display
   */
  formatError(classified: ClassifiedError): string {
    const lines: string[] = [];

    // Header with severity
    const severityIcon =
      classified.severity === 'critical'
        ? '[!!!]'
        : classified.severity === 'high'
          ? '[!!]'
          : classified.severity === 'medium'
            ? '[!]'
            : '[i]';

    lines.push(`${severityIcon} ${classified.userMessage}`);
    lines.push('');

    // Suggested actions
    if (classified.suggestedActions.length > 0) {
      lines.push('Suggested actions:');
      classified.suggestedActions.forEach((action, i) => {
        lines.push(`  ${i + 1}. ${action}`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Format error for debugging
   */
  formatDebug(classified: ClassifiedError): string {
    const lines = [
      '═══ ERROR DEBUG INFO ═══',
      `Category: ${classified.category}`,
      `Severity: ${classified.severity}`,
      `Recoverable: ${classified.recoverable}`,
      `Timestamp: ${classified.timestamp.toISOString()}`,
      '',
      'Technical Message:',
      classified.technicalMessage,
      '',
      'Stack Trace:',
      classified.original.stack || 'Not available',
      '',
      'Context:',
      JSON.stringify(classified.context, null, 2),
      '═══════════════════════════',
    ];

    return lines.join('\n');
  }

  /**
   * Get error statistics
   */
  getStats(): {
    total: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<ErrorSeverity, number>;
    recoveryRate: number;
  } {
    const stats = {
      total: this.errorHistory.length,
      byCategory: {} as Record<ErrorCategory, number>,
      bySeverity: {} as Record<ErrorSeverity, number>,
      recoveryRate: 0,
    };

    let recoverable = 0;

    for (const error of this.errorHistory) {
      stats.byCategory[error.category] = (stats.byCategory[error.category] || 0) + 1;
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
      if (error.recoverable) recoverable++;
    }

    stats.recoveryRate = stats.total > 0 ? (recoverable / stats.total) * 100 : 0;

    return stats;
  }

  /**
   * Get recent errors
   */
  getRecentErrors(count: number = 10): ClassifiedError[] {
    return this.errorHistory.slice(-count);
  }

  /**
   * Clear error history
   */
  clearHistory(): void {
    this.errorHistory = [];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.strategies = [];
    this.errorHistory = [];
    this.removeAllListeners();
  }
}

// Singleton instance
let errorRecoveryManager: ErrorRecoveryManager | null = null;

/**
 * Get or create the error recovery manager
 */
export function getErrorRecoveryManager(): ErrorRecoveryManager {
  if (!errorRecoveryManager) {
    errorRecoveryManager = new ErrorRecoveryManager();
  }
  return errorRecoveryManager;
}

/**
 * Reset the error recovery manager
 */
export function resetErrorRecoveryManager(): void {
  if (errorRecoveryManager) {
    errorRecoveryManager.dispose();
    errorRecoveryManager = null;
  }
}
