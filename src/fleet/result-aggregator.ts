/**
 * Fleet — Result aggregator (Fleet P4).
 *
 * After all parallel dispatch lanes of a saga complete, this module
 * synthesises the N answers into a single final result via a small
 * extra LLM call. The aggregator prompt is configurable per saga;
 * the default below works for most "ask the same question to N
 * models, give me the best synthesis" workflows.
 *
 * When a saga has no parallel lanes (just primary + optional
 * fallback), the aggregator is a no-op — `finaliseFromSingle()`
 * just copies the primary lane's result to `finalResult`.
 *
 * @module fleet/result-aggregator
 */

import type { CodeBuddyClient } from '../codebuddy/client.js';
import { logger } from '../utils/logger.js';
import type { SagaRecord, SagaStep } from './saga-store.js';

const DEFAULT_AGGREGATOR_PROMPT = `Voici plusieurs réponses indépendantes au même prompt utilisateur, chacune produite par un modèle différent.

Synthétise une réponse finale en :
1. Identifiant les points de consensus (où ≥2 modèles s'accordent)
2. Notant les désaccords majeurs avec le pourquoi
3. Produisant une réponse unique cohérente, factuelle, prête pour l'utilisateur final

Ne mentionne pas l'existence des sources individuelles dans la réponse finale ; rends juste le résultat utile.`;

/**
 * Closure that returns the LLM client to use for the aggregator
 * call. Same pattern as `peer-chat-bridge.ts:PeerChatClientGetter`.
 */
export type AggregatorClientGetter = () => CodeBuddyClient | null;

let cachedGetter: AggregatorClientGetter | null = null;

/**
 * Wire the aggregator's LLM client. Called once from server boot.
 * The client is captured lazily via `getter()` so callers can swap
 * it without re-wiring.
 */
export function wireAggregatorClient(getter: AggregatorClientGetter): void {
  cachedGetter = getter;
}

/** Test-only reset. */
export function _unwireAggregatorClient(): void {
  cachedGetter = null;
}

/**
 * Synthesise a final answer from completed parallel steps. Returns
 * the final string. Throws when:
 *   - no client is wired
 *   - fewer than 1 step has a usable result
 *
 * The caller (saga executor) is expected to write the result back
 * via `SagaStore.finalise()`.
 */
export async function aggregateParallelResults(
  saga: SagaRecord,
  options: { systemPrompt?: string } = {},
): Promise<string> {
  const completed = saga.steps.filter(
    (s) => s.status === 'completed' && typeof s.result === 'string',
  );
  if (completed.length === 0) {
    throw new Error(
      'aggregateParallelResults: no completed steps with a result',
    );
  }
  if (completed.length === 1) {
    // Nothing to synthesise — just return the single answer.
    return completed[0].result!;
  }

  const client = cachedGetter?.() ?? null;
  if (!client) {
    // Graceful fallback: concatenate with separators so the saga
    // doesn't dead-end. The user gets explicitly labelled raw content
    // rather than a synthetic synthesis.
    logger.warn?.('[result-aggregator] no client wired, falling back to concat');
    return concatenateAsFallback(completed);
  }

  const userPrompt = buildUserPrompt(saga, completed);
  const systemPrompt = options.systemPrompt ?? DEFAULT_AGGREGATOR_PROMPT;

  try {
    const response = await client.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      [], // no tools
    );
    const text = response?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.trim().length === 0) {
      logger.warn?.('[result-aggregator] LLM returned empty content, falling back');
      return concatenateAsFallback(completed);
    }
    return text;
  } catch (err) {
    logger.warn?.('[result-aggregator] LLM call failed, falling back', {
      err: err instanceof Error ? err.message : String(err),
    });
    return concatenateAsFallback(completed);
  }
}

/**
 * For non-parallel sagas (primary + optional fallback), no synthesis
 * is needed — just return the primary lane's result. Returns null
 * when neither lane succeeded.
 */
export function finaliseFromSingle(saga: SagaRecord): string | null {
  const primary = saga.steps.find((s) => s.lane === 'primary');
  if (primary?.status === 'completed' && primary.result) {
    return primary.result;
  }
  const fallback = saga.steps.find((s) => s.lane === 'fallback');
  if (fallback?.status === 'completed' && fallback.result) {
    return fallback.result;
  }
  return null;
}

/**
 * Build the user-side prompt for the aggregator from the saga's
 * goal + the N parallel results. Each source is labelled `peer×model`
 * so the LLM can spot disagreements per-source if it wants — the
 * default system prompt asks it not to expose those labels in the
 * output, but they're useful debugging context for the LLM.
 */
function buildUserPrompt(
  saga: SagaRecord,
  completed: SagaStep[],
): string {
  const lines: string[] = [
    `Goal de l'utilisateur :\n${saga.goal}\n`,
    `\n${completed.length} réponses indépendantes :\n`,
  ];
  for (const [i, step] of completed.entries()) {
    lines.push(
      `\n--- Source ${i + 1} (${step.peerId} × ${step.model}) ---\n${step.result}\n`,
    );
  }
  return lines.join('');
}

function concatenateAsFallback(steps: SagaStep[]): string {
  return [
    'Aggregation unavailable; raw completed results follow.',
    '',
    steps
      .map((s, i) => `Source ${i + 1} (${s.peerId} × ${s.model}):\n${s.result}\n`)
      .join('\n---\n'),
  ].join('\n');
}
