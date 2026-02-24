/**
 * Reasoning Middleware
 *
 * Auto-detects complex queries and injects reasoning context.
 * Priority: 42 (runs before workflow-guard at 45)
 *
 * Based on:
 * - Tree of Thoughts (Yao et al., 2023, arXiv 2305.10601)
 * - MCTSr (arXiv 2406.07394)
 * - RethinkMCTS (arXiv 2409.09584)
 */

import type {
  ConversationMiddleware,
  MiddlewareContext,
  MiddlewareResult,
} from './types.js';
import { getActiveThinkingMode } from '../../commands/handlers/think-handlers.js';

// ── Complexity scoring ──────────────────────────────────────────────────

/**
 * Recommended reasoning level based on complexity analysis.
 */
export type ComplexityLevel = 'none' | 'cot' | 'tot' | 'mcts';

/**
 * Result of a complexity analysis.
 */
export interface ComplexityScore {
  /** Raw numeric score (0-15) */
  score: number;
  /** Mapped reasoning level */
  level: ComplexityLevel;
  /** Individual signal contributions (for debugging / tests) */
  signals: {
    actionVerbs: number;
    constraintLanguage: number;
    explorationLanguage: number;
    multiStepIndicators: number;
    lengthBonus: number;
  };
}

// ── Word lists ──────────────────────────────────────────────────────────

const ACTION_VERBS = new Set([
  'refactor',
  'implement',
  'design',
  'optimize',
  'debug',
  'migrate',
  'architect',
  'plan',
]);

const CONSTRAINT_WORDS = new Set([
  'must',
  'require',
  'ensure',
  'without',
  'except',
  'constraint',
]);

const EXPLORATION_WORDS = new Set([
  'explore',
  'compare',
  'evaluate',
  'trade-off',
  'tradeoff',
  'alternative',
  'best approach',
]);

const MULTI_STEP_INDICATORS = new Set([
  'then',
  'after that',
  'next',
  'finally',
  'also',
  'additionally',
]);

// ── Helpers ─────────────────────────────────────────────────────────────

function countWordSetMatches(text: string, wordSet: Set<string>): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const term of wordSet) {
    // Support multi-word phrases (e.g. "after that", "best approach")
    if (term.includes(' ') || term.includes('-')) {
      if (lower.includes(term)) {
        count++;
      }
    } else {
      // Match whole words only
      const re = new RegExp(`\\b${term}\\b`, 'i');
      if (re.test(lower)) {
        count++;
      }
    }
  }
  return count;
}

function wordCount(text: string): number {
  return (text.match(/\b\w+\b/g) ?? []).length;
}

function mapScoreToLevel(score: number): ComplexityLevel {
  if (score >= 10) return 'mcts';
  if (score >= 6) return 'tot';
  if (score >= 3) return 'cot';
  return 'none';
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Analyse the complexity of a user message and recommend a reasoning level.
 *
 * Scoring rubric (0-15):
 *   - Distinct action verbs (max 8):  1 pt each
 *   - Constraint language (max 6):    1 pt each (capped at 3)
 *   - Exploration language (max 7):   1 pt each (capped at 3)
 *   - Multi-step indicators (max 6):  0.5 pt each (capped at 2)
 *   - Length bonus (> 100 words):     1 pt
 *
 * Mapping:
 *   0-2  → none
 *   3-5  → cot  (chain-of-thought)
 *   6-9  → tot  (tree-of-thought)
 *   10+  → mcts (full MCTS search)
 */
export function detectComplexity(message: string): ComplexityScore {
  const actionVerbs = countWordSetMatches(message, ACTION_VERBS);
  const constraintLanguage = Math.min(
    countWordSetMatches(message, CONSTRAINT_WORDS),
    3,
  );
  const explorationLanguage = Math.min(
    countWordSetMatches(message, EXPLORATION_WORDS),
    3,
  );
  const multiStepRaw = countWordSetMatches(message, MULTI_STEP_INDICATORS);
  const multiStepIndicators = Math.min(multiStepRaw * 0.5, 2);
  const lengthBonus = wordCount(message) > 100 ? 1 : 0;

  const score =
    actionVerbs +
    constraintLanguage +
    explorationLanguage +
    multiStepIndicators +
    lengthBonus;

  return {
    score,
    level: mapScoreToLevel(score),
    signals: {
      actionVerbs,
      constraintLanguage,
      explorationLanguage,
      multiStepIndicators,
      lengthBonus,
    },
  };
}

// ── Reasoning guidance template ─────────────────────────────────────────

const REASONING_GUIDANCE =
  '<reasoning_guidance>Based on complexity analysis, this task benefits ' +
  'from structured reasoning. The agent has access to the \'reason\' tool ' +
  'for Tree-of-Thought problem solving.</reasoning_guidance>';

// ── Middleware class ────────────────────────────────────────────────────

/**
 * Middleware that auto-detects complex queries and injects reasoning context
 * into the message stream so the LLM is aware of available reasoning tools.
 */
export class ReasoningMiddleware implements ConversationMiddleware {
  readonly name = 'reasoning';
  readonly priority = 42;

  /** Whether auto-detection is enabled (defaults to true). */
  private autoDetect: boolean;

  constructor(options?: { autoDetect?: boolean }) {
    this.autoDetect = options?.autoDetect ?? true;
  }

  /**
   * Toggle auto-detection at runtime.
   */
  setAutoDetect(enabled: boolean): void {
    this.autoDetect = enabled;
  }

  // ── beforeTurn ──────────────────────────────────────────────────────

  async beforeTurn(context: MiddlewareContext): Promise<MiddlewareResult> {
    const explicitMode = getActiveThinkingMode();

    // Case 1: Explicit thinking mode set via /think — always inject
    if (explicitMode !== null) {
      this.injectGuidance(context);
      return { action: 'continue' };
    }

    // Case 2: Auto-detect enabled — check last user message
    if (this.autoDetect) {
      const lastUserMessage = this.extractLastUserMessage(context);
      if (lastUserMessage) {
        const complexity = detectComplexity(lastUserMessage);
        if (complexity.level === 'tot' || complexity.level === 'mcts') {
          this.injectGuidance(context);
        }
      }
    }

    return { action: 'continue' };
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Extract the most recent user message from the middleware context.
   */
  private extractLastUserMessage(context: MiddlewareContext): string | null {
    // Walk messages backwards to find the last user message
    for (let i = context.messages.length - 1; i >= 0; i--) {
      const msg = context.messages[i];
      if (msg.role === 'user' && typeof msg.content === 'string') {
        return msg.content;
      }
    }
    return null;
  }

  /**
   * Inject a reasoning guidance system message into the context messages
   * so the LLM receives structured reasoning hints.
   */
  private injectGuidance(context: MiddlewareContext): void {
    // Avoid duplicate injection — check if guidance already present
    const alreadyInjected = context.messages.some(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        m.content.includes('<reasoning_guidance>'),
    );

    if (!alreadyInjected) {
      context.messages.push({
        role: 'system',
        content: REASONING_GUIDANCE,
      });
    }
  }
}

/**
 * Create and return a ReasoningMiddleware instance.
 */
export function createReasoningMiddleware(
  options?: { autoDetect?: boolean },
): ReasoningMiddleware {
  return new ReasoningMiddleware(options);
}
