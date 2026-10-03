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

/** Resolve inactivity, including locally buffered tool arguments when requested. */
export function resolveStallTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
  options?: { targetIsLocal?: boolean; toolOutputTokens?: number },
): number {
  const raw = env.CODEBUDDY_LLM_STALL_TIMEOUT_MS;
  // An explicit operator setting takes precedence, including disabling.
  if (raw !== undefined && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  const tokens = options?.toolOutputTokens ?? 0;
  const local = options?.targetIsLocal ?? isLocalLlmProvider(env);
  if (!local || !Number.isFinite(tokens) || tokens <= 0) return DEFAULT_STALL_TIMEOUT_MS;
  // Native local runtimes can buffer the entire tool JSON after streaming
  // reasoning. That silence is generation, not necessarily a dead backend.
  const ceiling = Math.max(DEFAULT_STALL_TIMEOUT_MS,
    parseEnvNumber(env.CODEBUDDY_STALL_MAX_MS, DEFAULT_STALL_MAX_MS));
  return Math.min(ceiling, Math.max(DEFAULT_STALL_TIMEOUT_MS,
    Math.ceil(tokens * DEFAULT_LOCAL_PROMPT_MS_PER_TOKEN)));
}

/**
 * First-token budget for LOCAL runtimes only (Ollama / LM Studio / vLLM /
 * Lemonade, see `isLocalLlmProvider`): `max(120s, promptTokens × ms/token)`
 * capped at `CODEBUDDY_STALL_MAX_MS` (default 20 min). Cloud providers keep
 * the plain 120 s window. The caller may separately allow buffered local
 * tool generation after the first token through inactivityTimeoutMs.
 *
 * `CODEBUDDY_LOCAL_PROMPT_MS_PER_TOKEN` defaults to 200.
 */
export function resolveFirstTokenStallTimeoutMs(
  promptTokens: number,
  env: NodeJS.ProcessEnv = process.env,
  options?: { targetIsLocal?: boolean },
): number {
  const afterFirst = resolveStallTimeoutMs(env);
  if (afterFirst <= 0) return afterFirst;
  // Adaptive prompt-eval budget is a LOCAL-runtime concern (iGPU prompt eval
  // can take minutes). A silent cloud provider must still fail in 120 s —
  // byte-identical behaviour for Gemini/ChatGPT/xAI and interactive sessions.
  const isLocal = options?.targetIsLocal ?? isLocalLlmProvider(env);
  if (!isLocal) return afterFirst;
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
  firstTokenTimeoutMs?: number | (() => number);
  /** Resolve after each chunk so a provider handoff uses the effective target. */
  inactivityTimeoutMs?: () => number;
  /** Abort the current provider request when its inactivity budget expires. */
  onStall?: (error: LlmStallError) => void;
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

  const resolveFirstTimeout = (): number => {
    const val = typeof options?.firstTokenTimeoutMs === 'function'
      ? options.firstTokenTimeoutMs()
      : options?.firstTokenTimeoutMs;
    return val ?? timeoutMs;
  };
  const iterator = stream[Symbol.asyncIterator]();
  let awaitingFirst = true;
  try {
    while (true) {
      const budget = awaitingFirst ? resolveFirstTimeout() : (options?.inactivityTimeoutMs?.() ?? timeoutMs);
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
    // Async generators queue return() behind a pending next(). Abort the
    // request first, and do not let that queued cleanup hide the deadline.
    if (error instanceof LlmStallError) {
      try { options?.onStall?.(error); } catch { /* preserve the stall error */ }
    }
    try {
      const closing = iterator.return?.();
      if (closing) void Promise.resolve(closing).catch(() => { /* already dead */ });
    } catch {
      /* already dead */
    }
    throw error;
  }
}
