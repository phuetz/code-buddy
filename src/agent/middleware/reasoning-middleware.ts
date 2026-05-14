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
import type { KnowledgeGraph } from '../../knowledge/knowledge-graph.js';
import { detectProviderFromEnv, selectModelForDetectedProvider } from '../../utils/provider-detector.js';

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

// ── Graph-aware complexity signals ──────────────────────────────────────

/** Lazy graph provider for structural complexity signals */
let _reasoningGraphProvider: (() => KnowledgeGraph | null) | null = null;

/**
 * Wire the graph provider into the reasoning middleware.
 * Called from codebuddy-agent.ts during initialization.
 */
export function setReasoningGraphProvider(provider: () => KnowledgeGraph | null): void {
  _reasoningGraphProvider = provider;
}

/** Docs context provider for complexity scoring (wired from codebuddy-agent) */
let _docsContextProvider: ((message: string) => string | null) | null = null;
export function setReasoningDocsProvider(provider: (message: string) => string | null): void {
  _docsContextProvider = provider;
}

/** Cached entity extractor — loaded lazily from context provider */
let _extractEntities: ((msg: string) => string[]) | null = null;
import('../../knowledge/code-graph-context-provider.js')
  .then(mod => { _extractEntities = mod.extractEntities; })
  .catch(() => { /* optional */ });

/**
 * Compute graph-based complexity signals for a message.
 * Returns additional score points to add to the textual score.
 */
function computeGraphComplexitySignals(message: string, graph: KnowledgeGraph): number {
  if (!_extractEntities) return 0;

  const candidates = _extractEntities(message);
  if (candidates.length === 0) return 0;

  let graphScore = 0;
  const communities = new Set<string>();
  const resolvedFiles = new Set<string>();

  for (const candidate of candidates.slice(0, 6)) {
    const entity = graph.findEntity(candidate);
    if (!entity) continue;

    // Track files for multi-file detection
    const definedIn = graph.query({ subject: entity, predicate: 'definedIn' });
    for (const t of definedIn) resolvedFiles.add(t.object);
    // Module entities are files themselves
    if (entity.startsWith('mod:')) resolvedFiles.add(entity);

    // High PageRank entity = architecturally important = risky to change
    const rank = graph.getEntityRank(entity);
    if (rank > 0.3) graphScore += 2;

    // Track community membership
    const modPath = entity.replace(/^(mod|cls|fn|iface):/, '').split('/').slice(0, 2).join('/');
    if (modPath) communities.add(modPath);

    // Check for circular dependencies
    const callers = graph.query({ predicate: 'calls', object: entity });
    for (const caller of callers.slice(0, 3)) {
      const reverseCall = graph.query({ predicate: 'calls', object: caller.subject, subject: entity });
      if (reverseCall.length > 0) {
        graphScore += 2; // circular dependency detected
        break;
      }
    }
  }

  // Entities touch >3 files
  if (resolvedFiles.size > 3) graphScore += 2;

  // Cross-community (>1 cluster)
  if (communities.size > 1) graphScore += 3;

  return graphScore;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Analyse the complexity of a user message and recommend a reasoning level.
 *
 * Scoring rubric (0-15 text + graph signals):
 *   - Distinct action verbs (max 8):  1 pt each
 *   - Constraint language (max 6):    1 pt each (capped at 3)
 *   - Exploration language (max 7):   1 pt each (capped at 3)
 *   - Multi-step indicators (max 6):  0.5 pt each (capped at 2)
 *   - Length bonus (> 100 words):     1 pt
 *   - Graph: entities touch >3 files: +2
 *   - Graph: entity PageRank > 0.3:   +2
 *   - Graph: cross-community:         +3
 *   - Graph: circular dependency:     +2
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

  // Graph-based structural complexity signals
  let graphBonus = 0;
  if (_reasoningGraphProvider) {
    try {
      const graph = _reasoningGraphProvider();
      if (graph && graph.getStats().tripleCount > 0) {
        graphBonus = computeGraphComplexitySignals(message, graph);
      }
    } catch { /* graph not available — degrade gracefully */ }
  }

  // Docs-based complexity signal: tasks touching documented critical subsystems score higher
  let docsBonus = 0;
  if (_docsContextProvider) {
    try {
      const ctx = _docsContextProvider(message);
      if (ctx) {
        if (/architecture|security|cross-subsystem|migration/i.test(ctx)) docsBonus += 1.5;
        else if (ctx.length > 100) docsBonus += 0.5;
      }
    } catch { /* docs optional */ }
  }

  const score =
    actionVerbs +
    constraintLanguage +
    explorationLanguage +
    multiStepIndicators +
    lengthBonus +
    graphBonus +
    docsBonus;

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

          // Auto-enable extended thinking for complex queries
          try {
            const provider = detectProviderFromEnv();
            if (provider) {
              const { getExtendedThinkingEngine } = await import('../thinking/extended-thinking.js');
              const et = getExtendedThinkingEngine(provider.apiKey, provider.baseURL, {
                model: selectModelForDetectedProvider(provider),
              });
              et.setDepth(complexity.level === 'mcts' ? 'deep' : 'extended');
            }
          } catch { /* extended thinking module optional */ }
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
