/**
 * Dynamic Tool Filtering Middleware
 *
 * Filters available tools based on runtime context:
 * 1. Sandbox availability — removes bash/run_script if no sandbox
 * 2. Plan mode — delegates to filterToolsForMode() for read-only restriction
 * 3. Failed tool tracking — warns after 3 consecutive failures of the same tool
 *
 * Priority 50 — runs after context warning (30) but before workflow guard (45).
 */

import type {
  ConversationMiddleware,
  MiddlewareContext,
  MiddlewareResult,
} from './types.js';
import { logger } from '../../utils/logger.js';

// ── Configuration ──────────────────────────────────────────────────

export interface ToolFilterConfig {
  /** Enable sandbox availability check (default: true) */
  checkSandbox: boolean;
  /** Enable plan mode filtering (default: true) */
  checkPlanMode: boolean;
  /** Enable failed tool tracking (default: true) */
  trackFailures: boolean;
  /** Number of consecutive failures before warning (default: 3) */
  failureThreshold: number;
  /** Tool names requiring sandbox */
  sandboxTools: string[];
}

export const DEFAULT_TOOL_FILTER_CONFIG: ToolFilterConfig = {
  checkSandbox: true,
  checkPlanMode: true,
  trackFailures: true,
  failureThreshold: 3,
  sandboxTools: ['bash', 'run_script', 'shell_exec'],
};

// ── Middleware ──────────────────────────────────────────────────────

export class ToolFilterMiddleware implements ConversationMiddleware {
  readonly name = 'tool-filter';
  readonly priority = 50;

  private config: ToolFilterConfig;
  private failureCounts: Map<string, number> = new Map();
  private warnedTools: Set<string> = new Set();

  constructor(config: Partial<ToolFilterConfig> = {}) {
    this.config = { ...DEFAULT_TOOL_FILTER_CONFIG, ...config };
  }

  async beforeTurn(context: MiddlewareContext): Promise<MiddlewareResult> {
    if (!context.tools || context.tools.length === 0) {
      return { action: 'continue' };
    }

    let tools = [...context.tools];
    const warnings: string[] = [];

    // 1. Sandbox availability check
    if (this.config.checkSandbox) {
      const sandboxAvailable = await this.isSandboxAvailable();
      if (!sandboxAvailable) {
        const before = tools.length;
        tools = tools.filter(
          t => !this.config.sandboxTools.includes(t.function.name)
        );
        if (tools.length < before) {
          logger.debug('Tool filter: removed sandbox-requiring tools (no sandbox available)', {
            removed: before - tools.length,
          });
        }
      }
    }

    // 2. Plan mode filtering
    if (this.config.checkPlanMode) {
      try {
        const { filterToolsForMode } = await import('../plan-mode.js');
        tools = filterToolsForMode(tools);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Plan-mode tool filtering is unavailable: ${message}`);
      }
    }

    // 3. Failed tool tracking — check recent results for consecutive failures
    if (this.config.trackFailures && context.lastToolResults) {
      this.updateFailureCounts(context.lastToolResults);

      for (const [toolName, count] of this.failureCounts) {
        if (count >= this.config.failureThreshold && !this.warnedTools.has(toolName)) {
          warnings.push(
            `Tool \`${toolName}\` has failed ${count} consecutive times. ` +
            `Consider using a different approach or tool.`
          );
          this.warnedTools.add(toolName);
        }
      }
    }

    // Update context tools with filtered list
    context.tools = tools;

    if (warnings.length > 0) {
      return { action: 'warn', message: warnings.join('\n') };
    }

    return { action: 'continue' };
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private updateFailureCounts(
    results: Array<{ toolName: string; success: boolean; output: string }>
  ): void {
    for (const result of results) {
      if (!result.success) {
        const current = this.failureCounts.get(result.toolName) || 0;
        this.failureCounts.set(result.toolName, current + 1);
      } else {
        // Reset on success
        this.failureCounts.delete(result.toolName);
        this.warnedTools.delete(result.toolName);
      }
    }
  }

  private async isSandboxAvailable(): Promise<boolean> {
    try {
      const { getActiveSandboxBackend } = await import('../../sandbox/sandbox-registry.js');
      const backend = await getActiveSandboxBackend();
      return backend !== null && backend !== undefined;
    } catch {
      // Sandbox module not available — assume unavailable
      return false;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  /** Reset failure tracking state */
  resetFailures(): void {
    this.failureCounts.clear();
    this.warnedTools.clear();
  }

  /** Get current failure counts */
  getFailureCounts(): Map<string, number> {
    return new Map(this.failureCounts);
  }

  /** Get configuration */
  getConfig(): ToolFilterConfig {
    return { ...this.config };
  }
}

/**
 * Factory function for creating the tool filter middleware.
 */
export function createToolFilterMiddleware(
  config?: Partial<ToolFilterConfig>,
): ToolFilterMiddleware {
  return new ToolFilterMiddleware(config);
}
