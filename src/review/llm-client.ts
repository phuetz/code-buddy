/**
 * Default reviewer client — resolves a real LLM from the active pool for
 * `full`-mode reviews when the caller didn't inject one (the apply_patch
 * bridge). Strong-model name heuristic, dead models skipped via the
 * scoreboard's trailing-failure streak (same discipline as the council
 * judge). Lazy imports keep this graph out of the tool's off path; any
 * failure → null → the engine fails closed.
 *
 * Pinning: `CODEBUDDY_DIFF_REVIEW_MODEL` wins, then `GROK_MODEL` if it is in
 * the pool. Local strong models (qwen3.5+/devstral/…) beat a cloud gateway
 * so `CODEBUDDY_DIFF_REVIEW=full` works on an Ollama-only box.
 *
 * @module review/llm-client
 */

import type { CouncilChatClient } from '../council/types.js';
import type { ActiveLlmModelPoolEntry } from '../providers/active-llm-model-pool.js';

/**
 * Cloud frontier names plus local models that reliably emit the JSON verdict
 * the gate requires. Deliberately excludes tiny chat-only tags (`llama3`,
 * `gemma*`, `qwen3:4b`, embedders) — those hallucinate prose and would
 * fail-closed every review.
 */
export const STRONG_REVIEWER_PATTERN =
  /gpt-5|opus|sonnet|fable|gemini|grok-[34]|qwen3\.[5-9]|devstral|glm-4\.5|glm-5|kimi-k[23]|nemotron-3|deepseek-r1|deepseek-v3/;
const DEAD_AFTER_FAILURES = 2;

export function isStrongReviewerModel(model: string): boolean {
  return STRONG_REVIEWER_PATTERN.test(model.toLowerCase());
}

function matchPoolModel(
  pool: ActiveLlmModelPoolEntry[],
  wanted: string,
): ActiveLlmModelPoolEntry | undefined {
  const needle = wanted.toLowerCase();
  return (
    pool.find((p) => p.model.toLowerCase() === needle) ??
    pool.find((p) => p.model.toLowerCase().startsWith(needle)) ??
    pool.find((p) => p.model.toLowerCase().includes(needle))
  );
}

function isAlive(
  entry: ActiveLlmModelPoolEntry,
  consecutiveRecentFailures: (model: string) => number,
): boolean {
  return Boolean(entry.apiKey) && consecutiveRecentFailures(entry.model) < DEAD_AFTER_FAILURES;
}

/**
 * Pure pool picker (no I/O) — the default full-mode reviewer.
 * `env` is injectable so tests don't mutate process.env.
 */
export function pickReviewerPoolEntry(
  pool: ActiveLlmModelPoolEntry[],
  env: NodeJS.ProcessEnv = process.env,
  consecutiveRecentFailures: (model: string) => number = () => 0,
): ActiveLlmModelPoolEntry | null {
  const alive = pool.filter((p) => isAlive(p, consecutiveRecentFailures));
  const pin = env.CODEBUDDY_DIFF_REVIEW_MODEL?.trim();
  if (pin) {
    const pinned = matchPoolModel(alive, pin);
    if (pinned) return pinned;
    if (consecutiveRecentFailures(pin) < DEAD_AFTER_FAILURES) {
      const donor =
        alive.find((p) => p.provider === 'ollama') ?? alive.find((p) => p.egress === 'local');
      if (donor) return { ...donor, model: pin };
    }
  }

  const grok = env.GROK_MODEL?.trim();
  if (grok) {
    const named = matchPoolModel(alive, grok);
    if (named) return named;
  }

  const strongLocal = alive.find((p) => p.egress === 'local' && isStrongReviewerModel(p.model));
  if (strongLocal) return strongLocal;

  return alive.find((p) => isStrongReviewerModel(p.model)) ?? null;
}

export async function resolveDefaultReviewClient(): Promise<CouncilChatClient | null> {
  try {
    const [{ listActiveLlmModelPool }, { CodeBuddyClient }, { getModelScoreboard }] = await Promise.all([
      import('../providers/active-llm-model-pool.js'),
      import('../codebuddy/client.js'),
      import('../fleet/model-scoreboard.js'),
    ]);
    const pool = await listActiveLlmModelPool();
    const scoreboard = getModelScoreboard();
    const pick = pickReviewerPoolEntry(pool, process.env, (model) =>
      scoreboard.consecutiveRecentFailures(model),
    );
    if (!pick?.apiKey) return null;

    const raw = new CodeBuddyClient(pick.apiKey, pick.model, pick.baseURL);
    return {
      async chat(messages) {
        // Cap output: qwen3.8's model default is 16 384 tokens, which lets
        // hidden thinking fill the review timeout without ever emitting JSON.
        // Temperature 0 + no cross-provider fallback keep the verdict local.
        const resp = await raw.chat(messages, [], {
          temperature: 0,
          maxTokens: 1024,
          disableProviderFallback: true,
        });
        return {
          content: resp?.choices?.[0]?.message?.content ?? '',
          promptTokens: resp?.usage?.prompt_tokens ?? 0,
          totalTokens: resp?.usage?.total_tokens ?? 0,
        };
      },
    };
  } catch {
    return null;
  }
}
