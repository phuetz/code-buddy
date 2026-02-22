/**
 * Self-Healing
 *
 * Recognizes error patterns and applies automatic fix strategies.
 * Escalates after max attempts.
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ErrorPattern {
  name: string;
  pattern: RegExp;
  strategy: HealingStrategy;
  priority: number;
}

export type HealingStrategy =
  | 'retry'
  | 'retry_with_backoff'
  | 'change_permissions'
  | 'install_dependency'
  | 'fix_syntax'
  | 'escalate'
  | 'custom';

export interface HealingResult {
  healed: boolean;
  strategy: HealingStrategy;
  attempts: number;
  error?: string;
  fixApplied?: string;
}

export interface ToolContext {
  toolName: string;
  args: Record<string, unknown>;
  workingDirectory: string;
}

// ============================================================================
// Built-in Error Patterns
// ============================================================================

const BUILTIN_PATTERNS: ErrorPattern[] = [
  {
    name: 'FileNotFound',
    pattern: /ENOENT|no such file or directory|file not found/i,
    strategy: 'retry',
    priority: 10,
  },
  {
    name: 'PermissionDenied',
    pattern: /EACCES|permission denied|access denied/i,
    strategy: 'change_permissions',
    priority: 20,
  },
  {
    name: 'SyntaxError',
    pattern: /SyntaxError|unexpected token|parse error/i,
    strategy: 'fix_syntax',
    priority: 15,
  },
  {
    name: 'ModuleNotFound',
    pattern: /Cannot find module|MODULE_NOT_FOUND|not found.*module/i,
    strategy: 'install_dependency',
    priority: 25,
  },
  {
    name: 'NetworkError',
    pattern: /ECONNREFUSED|ETIMEDOUT|network error|fetch failed/i,
    strategy: 'retry_with_backoff',
    priority: 5,
  },
  {
    name: 'OutOfMemory',
    pattern: /ENOMEM|out of memory|heap out of memory/i,
    strategy: 'escalate',
    priority: 30,
  },
];

// ============================================================================
// Self-Healing Engine
// ============================================================================

export class SelfHealing extends EventEmitter {
  private patterns: ErrorPattern[];
  private customStrategies: Map<string, (error: Error, context: ToolContext) => Promise<boolean>> = new Map();

  constructor() {
    super();
    this.patterns = [...BUILTIN_PATTERNS];
  }

  /**
   * Add a custom error pattern
   */
  addPattern(pattern: ErrorPattern): void {
    this.patterns.push(pattern);
    this.patterns.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Register a custom healing strategy
   */
  registerStrategy(name: string, handler: (error: Error, context: ToolContext) => Promise<boolean>): void {
    this.customStrategies.set(name, handler);
  }

  /**
   * Attempt to heal an error
   */
  async attemptHeal(
    error: Error,
    context: ToolContext,
    maxAttempts: number = 3,
    retryAction?: () => Promise<unknown>
  ): Promise<HealingResult> {
    const message = error.message || String(error);
    let attempts = 0;

    // Match error to pattern
    const matched = this.patterns.find(p => p.pattern.test(message));

    if (!matched) {
      return { healed: false, strategy: 'escalate', attempts: 0, error: 'No matching pattern' };
    }

    this.emit('healing:start', { pattern: matched.name, strategy: matched.strategy });

    while (attempts < maxAttempts) {
      attempts++;

      try {
        let healed = false;

        switch (matched.strategy) {
          case 'retry':
            if (retryAction) {
              await retryAction();
              healed = true;
            }
            break;

          case 'retry_with_backoff':
            if (retryAction) {
              await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempts - 1)));
              await retryAction();
              healed = true;
            }
            break;

          case 'custom': {
            const handler = this.customStrategies.get(matched.name);
            if (handler) {
              healed = await handler(error, context);
            }
            break;
          }

          case 'escalate':
            this.emit('healing:escalate', { pattern: matched.name, error: message, attempts });
            return { healed: false, strategy: 'escalate', attempts, error: 'Escalated' };

          default:
            // For strategies that need external implementation
            this.emit('healing:needs-action', { strategy: matched.strategy, context });
            return { healed: false, strategy: matched.strategy, attempts, fixApplied: matched.strategy };
        }

        if (healed) {
          this.emit('healing:success', { pattern: matched.name, attempts });
          return { healed: true, strategy: matched.strategy, attempts };
        }

      } catch (retryError) {
        logger.debug(`Healing attempt ${attempts} failed`, { error: String(retryError) });
      }
    }

    this.emit('healing:failed', { pattern: matched.name, attempts });
    return { healed: false, strategy: matched.strategy, attempts, error: 'Max attempts reached' };
  }

  /**
   * Match an error to a pattern (without healing)
   */
  matchPattern(error: Error): ErrorPattern | null {
    const message = error.message || String(error);
    return this.patterns.find(p => p.pattern.test(message)) || null;
  }

  /**
   * Get all registered patterns
   */
  getPatterns(): ErrorPattern[] {
    return [...this.patterns];
  }
}

// ============================================================================
// Singleton
// ============================================================================

let healingInstance: SelfHealing | null = null;

export function getSelfHealing(): SelfHealing {
  if (!healingInstance) {
    healingInstance = new SelfHealing();
  }
  return healingInstance;
}

export function resetSelfHealing(): void {
  healingInstance = null;
}
