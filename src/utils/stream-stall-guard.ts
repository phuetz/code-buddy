/**
 * Stall guard for LLM streams.
 *
 * Some backends (observed repeatedly with the ChatGPT/Codex OAuth endpoint)
 * accept the connection and then never send a byte — the reader's
 * `for await` then hangs FOREVER, freezing agent turns and headless waves
 * for hours. This wrapper bounds the wait BETWEEN chunks: no activity for
 * `timeoutMs` → the underlying stream is closed and a clear LlmStallError is
 * thrown, so the turn fails fast and honestly instead of hanging.
 *
 * Tunable via CODEBUDDY_LLM_STALL_TIMEOUT_MS (default 120000; <=0 disables).
 */

import { isLocalLlmProvider } from '../config/headless-local-prompt.js';

export class LlmStallError extends Error {
  constructor(timeoutMs: number) {
    super(
      `LLM stream stalled: no data received for ${Math.round(timeoutMs / 1000)}s ` +
        `(backend accepted the request but stopped responding). ` +
        `Retry the turn; tune with CODEBUDDY_LLM_STALL_TIMEOUT_MS.`,
    );
    this.name = 'LlmStallError';
  }
}

const DEFAULT_STALL_TIMEOUT_MS = 120_000;
const DEFAULT_LOCAL_PROMPT_MS_PER_TOKEN = 200;
const DEFAULT_STALL_MAX_MS = 20 * 60 * 1000;

function parseEnvNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Resolve the configured inactivity budget (<=0 or NaN disables the guard). */
export function resolveStallTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CODEBUDDY_LLM_STALL_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_STALL_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_STALL_TIMEOUT_MS;
  return parsed;
}

/**
 * First-token budget for LOCAL runtimes only (Ollama / LM Studio / vLLM /
 * Lemonade, see `isLocalLlmProvider`): `max(120s, promptTokens × ms/token)`
 * capped at `CODEBUDDY_STALL_MAX_MS` (default 20 min). Cloud providers keep
 * the plain 120 s window. After the first token the regular 120 s
 * inactivity window applies.
 *
 * `CODEBUDDY_LOCAL_PROMPT_MS_PER_TOKEN` defaults to 200.
 */
export function resolveFirstTokenStallTimeoutMs(
  promptTokens: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const afterFirst = resolveStallTimeoutMs(env);
  if (afterFirst <= 0) return afterFirst;
  // Adaptive prompt-eval budget is a LOCAL-runtime concern (iGPU prompt eval
  // can take minutes). A silent cloud provider must still fail in 120 s —
  // byte-identical behaviour for Gemini/ChatGPT/xAI and interactive sessions.
  if (!isLocalLlmProvider(env)) return afterFirst;
  const msPerToken = Math.max(0, parseEnvNumber(
    env.CODEBUDDY_LOCAL_PROMPT_MS_PER_TOKEN,
    DEFAULT_LOCAL_PROMPT_MS_PER_TOKEN,
  ));
  const maxMs = Math.max(afterFirst, parseEnvNumber(
    env.CODEBUDDY_STALL_MAX_MS,
    DEFAULT_STALL_MAX_MS,
  ));
  const tokens = Number.isFinite(promptTokens) ? Math.max(0, promptTokens) : 0;
  return Math.min(Math.max(afterFirst, Math.ceil(tokens * msPerToken)), maxMs);
}

export interface StallGuardOptions {
  /** Inactivity budget until the first chunk. Defaults to `timeoutMs`. */
  firstTokenTimeoutMs?: number;
}

/**
 * Yield the stream's chunks, failing fast when the gap between two chunks
 * exceeds `timeoutMs`. The wait for the first token uses
 * `firstTokenTimeoutMs` when provided (adaptive local prompt eval).
 */
export async function* withStallGuard<T>(
  stream: AsyncIterable<T>,
  timeoutMs: number = resolveStallTimeoutMs(),
  options?: StallGuardOptions,
): AsyncGenerator<T, void, undefined> {
  if (timeoutMs <= 0) {
    yield* stream;
    return;
  }

  const firstTimeout = options?.firstTokenTimeoutMs ?? timeoutMs;
  const iterator = stream[Symbol.asyncIterator]();
  let awaitingFirst = true;
  try {
    while (true) {
      const budget = awaitingFirst ? firstTimeout : timeoutMs;
      if (budget <= 0) {
        const rest = await iterator.next();
        if (rest.done) return;
        awaitingFirst = false;
        yield rest.value;
        continue;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stall = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LlmStallError(budget)), budget);
      });
      let result: IteratorResult<T>;
      try {
        result = await Promise.race([iterator.next(), stall]);
      } finally {
        clearTimeout(timer);
      }
      if (result.done) return;
      awaitingFirst = false;
      yield result.value;
    }
  } catch (error) {
    // Close the underlying stream (aborts the network request when the
    // provider wires return() to its AbortController). Best effort.
    try {
      await iterator.return?.();
    } catch {
      /* already dead */
    }
    throw error;
  }
}
