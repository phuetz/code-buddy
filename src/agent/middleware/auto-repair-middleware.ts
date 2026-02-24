/**
 * Auto-Repair Middleware
 *
 * Detects tool execution failures (tests, bash) and automatically
 * invokes the repair engine to generate fixes. Injects repair
 * suggestions into the conversation context for the next iteration.
 *
 * Priority 150 — runs after implementation, before quality gates.
 */

import type {
  ConversationMiddleware,
  MiddlewareContext,
  MiddlewareResult,
} from './types.js';
import { logger } from '../../utils/logger.js';

// ── Configuration ──────────────────────────────────────────────────

export interface AutoRepairConfig {
  /** Enable/disable auto-repair (default: true) */
  enabled: boolean;
  /** Maximum repair attempts per session (default: 3) */
  maxRepairAttempts: number;
  /** Tool names whose failures trigger repair */
  triggerToolNames: string[];
  /** Regex patterns that indicate repairable errors */
  errorPatterns: RegExp[];
}

export const DEFAULT_AUTO_REPAIR_CONFIG: AutoRepairConfig = {
  enabled: true,
  maxRepairAttempts: 3,
  triggerToolNames: ['bash', 'run_tests', 'run_script'],
  errorPatterns: [
    /error/i,
    /FAIL/,
    /failed/i,
    /exception/i,
    /SyntaxError/,
    /TypeError/,
    /ReferenceError/,
    /Cannot find module/i,
    /exit code [1-9]/i,
    /non-zero exit/i,
  ],
};

// ── Middleware ──────────────────────────────────────────────────────

export class AutoRepairMiddleware implements ConversationMiddleware {
  readonly name = 'auto-repair';
  readonly priority = 150;

  private config: AutoRepairConfig;
  private repairAttempts = 0;

  constructor(config: Partial<AutoRepairConfig> = {}) {
    this.config = { ...DEFAULT_AUTO_REPAIR_CONFIG, ...config };
  }

  async afterTurn(context: MiddlewareContext): Promise<MiddlewareResult> {
    if (!this.config.enabled) {
      return { action: 'continue' };
    }

    // Check if max attempts reached
    if (this.repairAttempts >= this.config.maxRepairAttempts) {
      return { action: 'continue' };
    }

    // Scan recent history for tool failures
    const failure = this.detectFailure(context);
    if (!failure) {
      // Reset attempts on success (consecutive successes reset the counter)
      if (this.repairAttempts > 0 && this.hasRecentSuccess(context)) {
        this.repairAttempts = 0;
      }
      return { action: 'continue' };
    }

    this.repairAttempts++;

    // Try to invoke repair engine
    let repairSuggestion: string | null = null;
    try {
      repairSuggestion = await this.invokeRepair(failure);
    } catch (error) {
      logger.warn('Auto-repair invocation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Always warn when a failure is detected, with or without a specific repair suggestion
    const suggestion = repairSuggestion
      || `Error detected in \`${failure.toolName}\` output. Please review the error and fix the issue.`;

    logger.info(
      `Auto-repair attempt ${this.repairAttempts}/${this.config.maxRepairAttempts}: ` +
      `detected failure in ${failure.toolName}, suggesting fix`
    );

    return {
      action: 'warn',
      message: `[Auto-Repair ${this.repairAttempts}/${this.config.maxRepairAttempts}] ` +
        `Detected error in \`${failure.toolName}\` output. ` +
        `Repair suggestion:\n${suggestion}\n\n` +
        `Please apply this fix and re-run the failing command.`,
    };
  }

  // ── Failure detection ──────────────────────────────────────────

  private detectFailure(
    context: MiddlewareContext,
  ): { toolName: string; errorOutput: string } | null {
    // Scan last few history entries for tool results with errors
    const recent = context.history.slice(-6);

    for (let i = recent.length - 1; i >= 0; i--) {
      const entry = recent[i];
      if (entry.type !== 'tool_result') continue;

      const content = typeof entry.content === 'string' ? entry.content : '';
      if (!content) continue;

      // Check if this is from a trigger tool
      const toolName = entry.toolCall?.function?.name || 'bash';
      if (!this.config.triggerToolNames.includes(toolName)) continue;

      // Check if content matches any error pattern
      const hasError = this.config.errorPatterns.some(pattern => pattern.test(content));
      if (hasError) {
        return { toolName, errorOutput: content.slice(0, 3000) };
      }
    }

    return null;
  }

  private hasRecentSuccess(context: MiddlewareContext): boolean {
    const recent = context.history.slice(-3);
    return recent.some(entry => {
      if (entry.type !== 'tool_result') return false;
      const content = typeof entry.content === 'string' ? entry.content : '';
      return content.includes('"success": true') || content.includes('passed');
    });
  }

  // ── Repair engine invocation ───────────────────────────────────

  private async invokeRepair(
    failure: { toolName: string; errorOutput: string },
  ): Promise<string | null> {
    try {
      const { RepairEngine } = await import('../repair/repair-engine.js');
      const { createFaultLocalizer } = await import('../repair/fault-localization.js');

      // Localize fault
      const localizer = createFaultLocalizer();
      const locResult = await localizer.localize(failure.errorOutput);

      if (locResult.faults.length === 0) {
        return null;
      }

      // Format fault info as repair suggestion (without running full repair
      // which requires file I/O — just provide diagnostic info to the agent)
      const fault = locResult.faults[0];
      const lines = [
        `**Fault Localized:**`,
        `- File: ${fault.location?.file || 'unknown'}`,
        `- Line: ${fault.location?.startLine || 'unknown'}`,
        `- Type: ${fault.type || 'unknown'}`,
        `- Message: ${fault.message || failure.errorOutput.slice(0, 200)}`,
        '',
        '**Suggested action:** Fix the error at the indicated location and re-run tests.',
      ];

      return lines.join('\n');
    } catch {
      // Repair module not available — return generic suggestion
      return `Error detected in \`${failure.toolName}\` output. ` +
        `Please review the error output above and fix the issue.`;
    }
  }

  // ── Public API ─────────────────────────────────────────────────

  /** Reset repair attempt counter (e.g., on new task) */
  resetAttempts(): void {
    this.repairAttempts = 0;
  }

  /** Get current repair attempt count */
  getAttemptCount(): number {
    return this.repairAttempts;
  }

  /** Get configuration */
  getConfig(): AutoRepairConfig {
    return { ...this.config };
  }
}

/**
 * Factory function for creating the auto-repair middleware.
 */
export function createAutoRepairMiddleware(
  config?: Partial<AutoRepairConfig>,
): AutoRepairMiddleware {
  return new AutoRepairMiddleware(config);
}
