
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
  signal?: AbortSignal,
): Promise<{ promptTokens: number; effectiveContext: number }> {
  const requestBound = assertOllamaRequestBound(body);
  if (!Number.isSafeInteger(promptTokens) || !promptTokens || promptTokens <= 0) {
    throw new Error('Ollama supplied no usable real prompt token count; request admission refused.');
  }
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
  const response = await fetcher(`${origin}/api/ps`, { signal: requestSignal });
  if (!response.ok) throw new Error(`Ollama effective context probe failed: HTTP ${response.status}`);
  const data = await response.json() as { models?: Array<{ name?: string; model?: string; context_length?: number }> };
  const loaded = data.models?.find(model => model.name === body.model || model.model === body.model);
  const effective = loaded?.context_length;
  if (!Number.isSafeInteger(effective) || !effective || effective <= 0) throw new Error('Ollama supplied no effective context window; request admission refused.');
  if (promptTokens >= effective || requestBound > effective) {
    throw new Error(`Ollama effective num_ctx ${effective} cannot safely fit ${promptTokens} measured request tokens (byte bound ${requestBound}); silent truncation refused.`);
  }
  return { promptTokens, effectiveContext: effective };
}
