import { isHeadlessPromptCompact, HEADLESS_LOCAL_COMPACT_MAX_TOKENS } from '../../config/headless-local-prompt.js';

import { logger } from '../../utils/logger.js';
import type { OllamaNativeRequest } from './ollama-native-transport.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Independently written, inspired by Hermes' real token floor and window check
 * (agent/conversation_loop.py). Validate bounds before calling, then validate
 * real usage and /api/ps before returning an answer or executing any tool.
 * No synthetic generation: it perturbed real-model results in the paired QA.
 * Byte bounds are conservative admission bounds, NOT tokenizer measurements.
 */
export function assertOllamaRequestBound(body: OllamaNativeRequest): number {
  const requested = Number(body.options?.num_ctx);
  const requestBound = Buffer.byteLength(JSON.stringify({ messages: body.messages, tools: body.tools ?? [] }), 'utf8') + body.messages.length * 64 + 256;
  if (!Number.isSafeInteger(requested) || requested <= 0 || requestBound > requested) {
    throw new Error(`Ollama window cannot safely admit request byte bound ${requestBound} with num_ctx=${requested}; silent truncation refused. Reduce context or increase the window.`);
  }
  return requestBound;
}

export async function checkOllamaRequest(
  origin: string, body: OllamaNativeRequest, promptTokens: number | undefined, fetcher: Fetch = fetch,
  signal?: AbortSignal, allowMissingContext = false,
): Promise<{ promptTokens: number; effectiveContext?: number }> {
  const requestBound = assertOllamaRequestBound(body);
  if (!Number.isSafeInteger(promptTokens) || !promptTokens || promptTokens <= 0) {
    throw new Error('Ollama supplied no usable real prompt token count; request admission refused.');
  }
  if (isHeadlessPromptCompact() && promptTokens > HEADLESS_LOCAL_COMPACT_MAX_TOKENS) {
    throw new Error(`Ollama compact assembled prompt exceeds ${HEADLESS_LOCAL_COMPACT_MAX_TOKENS} tokens: ${promptTokens} real tokens including system, tools and context; response refused.`);
  }
  const effective = await probeOllamaContext(origin, body, fetcher, signal, allowMissingContext);
  if (effective === undefined) return { promptTokens };
  if (promptTokens >= effective || requestBound > effective) {
    throw new Error(`Ollama effective num_ctx ${effective} cannot safely fit ${promptTokens} measured request tokens (byte bound ${requestBound}); silent truncation refused.`);
  }
  return { promptTokens, effectiveContext: effective };
}


/** Native response headers arrive after model loading. Interactive streams
 * check the conservative bound before yielding; missing optional metadata is
 * a visible warning. Headless still checks real usage before accepting output.
 */
export async function probeOllamaContext(
  origin: string, body: OllamaNativeRequest, fetcher: Fetch = fetch,
  signal?: AbortSignal, allowMissingContext = false, checkBound = false,
): Promise<number | undefined> {
  const requestBound = assertOllamaRequestBound(body);
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
  const response = await fetcher(`${origin}/api/ps`, { signal: requestSignal });
  if (!response.ok) throw new Error(`Ollama effective context probe failed: HTTP ${response.status}`);
  const data = await response.json() as { models?: Array<{ name?: string; model?: string; context_length?: number }> };
  const loaded = data.models?.find(model => model.name === body.model || model.model === body.model);
  const effective = loaded?.context_length;
  if (!Number.isSafeInteger(effective) || !effective || effective <= 0) {
    if (!allowMissingContext) throw new Error('Ollama supplied no effective context window; request admission refused.');
    // Older daemons omit this optional field. Only interactive calls may
    // continue on the requested-window bound; never invent an effective size.
    logger.warn('Ollama omitted optional effective context metadata; interactive request uses the requested-window bound. Headless admission still requires proof.');
    return undefined;
  }
  if (checkBound && requestBound > effective) {
    throw new Error(`Ollama effective num_ctx ${effective} cannot safely fit request byte bound ${requestBound}; silent truncation refused.`);
  }
  return effective;
}
