/**
 * Ollama transport that can actually carry a context limit.
 *
 * `CODEBUDDY_MAX_CONTEXT` is documented as overriding the context window "for
 * every consumer", and every Code Buddy consumer honours it — but the SERVER
 * never heard about it. Ollama takes a per-request context size only as
 * `options.num_ctx` on its NATIVE `/api/chat` endpoint; the OpenAI-compatible
 * `/v1/chat/completions` silently drops unknown fields (measured on Ollama
 * 0.30.7: `options.num_ctx`, a top-level `num_ctx` and `context_length` all
 * ignored) and the runner is then loaded at the model's full declared window —
 * 262 144 tokens and 24 GB of VRAM for a 2.5 GB model.
 *
 * So for Ollama, and only for Ollama, the already-built OpenAI-compatible
 * payload is translated to the native endpoint and the native answer back to
 * the OpenAI shape. Everything around it — retry, circuit breaker, extended
 * thinking, JSON retry, turn metrics, error classification — stays on the one
 * pipeline it always used.
 *
 * @module codebuddy/providers/ollama-native-transport
 */

import type { ChatCompletionChunk } from 'openai/resources/chat/completions';

import { getModelToolConfig } from '../../config/model-tools.js';

/** Native `/api/chat` tool call: `arguments` is an object, not a JSON string. */
interface OllamaNativeToolCall {
  id?: string;
  function?: { name?: string; arguments?: unknown };
}

export interface OllamaNativeChatResponse {
  model?: string;
  created_at?: string;
  message?: { role?: string; content?: string; thinking?: string; tool_calls?: OllamaNativeToolCall[] };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** The OpenAI-compat payload this module knows how to translate. */
export interface OpenAiChatPayload {
  model: string;
  messages: Array<Record<string, unknown>>;
  tools?: unknown[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
  response_format?: { type?: string };
  reasoning_effort?: string;
}

/**
 * `true` when this base URL is served by Ollama.
 *
 * Deliberately URL-only. `getModelInfo(model).provider` answers "ollama" for
 * any qwen/llama/gemma tag, and those same weights are routinely served by
 * LM Studio or vLLM, which have no `/api/chat` — routing those to the native
 * endpoint would turn a memory bug into a 404. An unrecognised Ollama host
 * simply keeps today's behavior.
 */
export function isOllamaEndpoint(baseURL: string): boolean {
  const url = baseURL.toLowerCase();
  return url.includes(':11434') || url.includes('ollama');
}

/**
 * Opt-out for an operator who would rather keep the OpenAI-compat endpoint
 * (and its 262 144-token default) than the native one.
 */
export function isOllamaNativeChatEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CODEBUDDY_OLLAMA_NATIVE_CHAT?.trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

/** `http://host:11434/v1` → `http://host:11434/api/chat`. */
export function ollamaNativeChatUrl(baseURL: string): string {
  return `${baseURL.replace(/\/v1\/?$/i, '').replace(/\/+$/, '')}/api/chat`;
}

/**
 * The context window the server must honour. Read through
 * `getModelToolConfig`, so `CODEBUDDY_MAX_CONTEXT` — applied there at call
 * time, above the declared table AND above runtime discovery — wins here too.
 */
export function resolveOllamaNumCtx(model: string): number | undefined {
  const { contextWindow } = getModelToolConfig(model);
  return Number.isSafeInteger(contextWindow) && (contextWindow ?? 0) > 0 ? contextWindow : undefined;
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/**
 * OpenAI messages → native messages. Two shapes genuinely differ: assistant
 * `tool_calls[].function.arguments` is a JSON string upstream and an object
 * here, and a `tool` result is bound by `tool_call_id` upstream but by
 * `tool_name` here — resolved from the assistant turn that requested it, so a
 * multi-turn tool loop keeps its pairing.
 */
export function toOllamaNativeMessages(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const nameByCallId = new Map<string, string>();
  for (const message of messages) {
    for (const call of (message.tool_calls as OllamaNativeToolCall[] | undefined) ?? []) {
      if (call.id && call.function?.name) nameByCallId.set(call.id, call.function.name);
    }
  }

  return messages.map((message) => {
    const { tool_call_id: toolCallId, tool_calls: toolCalls, ...rest } = message;
    const next: Record<string, unknown> = { ...rest };
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      next.tool_calls = (toolCalls as OllamaNativeToolCall[]).map((call) => ({
        ...(call.id ? { id: call.id } : {}),
        function: { name: call.function?.name ?? '', arguments: parseArguments(call.function?.arguments) },
      }));
    }
    if (message.role === 'tool') {
      const toolName = typeof toolCallId === 'string' ? nameByCallId.get(toolCallId) : undefined;
      if (toolName) next.tool_name = toolName;
    }
    return next;
  });
}

/** Ollama's `think` accepts a level or a boolean; `none` means "do not think". */
function toOllamaThink(reasoningEffort?: string): boolean | string | undefined {
  const effort = reasoningEffort?.trim().toLowerCase();
  if (!effort) return undefined;
  if (effort === 'none' || effort === 'off' || effort === 'minimal') return false;
  if (effort === 'low' || effort === 'medium' || effort === 'high') return effort;
  return undefined;
}

/** OpenAI-compat payload → native `/api/chat` body, carrying `num_ctx`. */
export function toOllamaNativeRequest(
  payload: OpenAiChatPayload,
  numCtx: number | undefined,
): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (numCtx !== undefined) options.num_ctx = numCtx;
  if (typeof payload.max_tokens === 'number') options.num_predict = payload.max_tokens;
  if (typeof payload.temperature === 'number') options.temperature = payload.temperature;
  if (typeof payload.top_p === 'number') options.top_p = payload.top_p;
  if (payload.stop !== undefined) options.stop = Array.isArray(payload.stop) ? payload.stop : [payload.stop];

  const think = toOllamaThink(payload.reasoning_effort);
  return {
    model: payload.model,
    messages: toOllamaNativeMessages(payload.messages),
    stream: payload.stream === true,
    ...(payload.tools && payload.tools.length > 0 ? { tools: payload.tools } : {}),
    ...(payload.response_format?.type === 'json_object' ? { format: 'json' } : {}),
    ...(think === undefined ? {} : { think }),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}

function toOpenAiToolCalls(
  toolCalls: OllamaNativeToolCall[] | undefined,
): Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> {
  return (toolCalls ?? []).flatMap((call, index) => {
    const name = call.function?.name;
    if (!name) return [];
    return [{
      id: call.id || `ollama-tool-${index}`,
      type: 'function' as const,
      function: { name, arguments: JSON.stringify(call.function?.arguments ?? {}) },
    }];
  });
}

function toFinishReason(data: OllamaNativeChatResponse, hasToolCalls: boolean): string {
  if (hasToolCalls) return 'tool_calls';
  return data.done_reason === 'length' ? 'length' : 'stop';
}

function toUsage(data: OllamaNativeChatResponse): Record<string, number> | undefined {
  if (typeof data.prompt_eval_count !== 'number' || typeof data.eval_count !== 'number') return undefined;
  return {
    prompt_tokens: data.prompt_eval_count,
    completion_tokens: data.eval_count,
    total_tokens: data.prompt_eval_count + data.eval_count,
  };
}

/** Native answer → the `chat.completion` object the provider already handles. */
export function fromOllamaNativeResponse(
  data: OllamaNativeChatResponse,
  fallbackModel: string,
): Record<string, unknown> {
  const toolCalls = toOpenAiToolCalls(data.message?.tool_calls);
  return {
    id: `chatcmpl-ollama-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: data.model || fallbackModel,
    choices: [{
      index: 0,
      message: {
        role: data.message?.role || 'assistant',
        content: data.message?.content ?? '',
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toFinishReason(data, toolCalls.length > 0),
    }],
    ...(toUsage(data) ? { usage: toUsage(data) } : {}),
  };
}

/** One NDJSON line → one OpenAI streaming chunk. */
export function toOpenAiChunk(
  data: OllamaNativeChatResponse,
  fallbackModel: string,
  isFirst: boolean,
): ChatCompletionChunk {
  const toolCalls = toOpenAiToolCalls(data.message?.tool_calls);
  const delta: Record<string, unknown> = {};
  if (isFirst || data.message?.role) delta.role = data.message?.role || 'assistant';
  if (data.message?.content) delta.content = data.message.content;
  if (toolCalls.length > 0) {
    delta.tool_calls = toolCalls.map((call, index) => ({ index, ...call }));
  }
  return {
    id: `chatcmpl-ollama-${fallbackModel}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: data.model || fallbackModel,
    choices: [{
      index: 0,
      delta,
      finish_reason: data.done === true ? toFinishReason(data, toolCalls.length > 0) : null,
    }],
    ...(data.done === true && toUsage(data) ? { usage: toUsage(data) } : {}),
  } as unknown as ChatCompletionChunk;
}

/** NDJSON body → OpenAI chunks. A malformed line is skipped, never fatal. */
export async function* streamOllamaNative(
  body: ReadableStream<Uint8Array> | null,
  fallbackModel: string,
): AsyncGenerator<ChatCompletionChunk, void, unknown> {
  const reader = body?.getReader();
  if (!reader) throw new Error('Ollama returned an empty response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let emitted = 0;
  const emit = function* (line: string): Generator<ChatCompletionChunk> {
    if (!line.trim()) return;
    let parsed: OllamaNativeChatResponse;
    try {
      parsed = JSON.parse(line) as OllamaNativeChatResponse;
    } catch {
      return;
    }
    yield toOpenAiChunk(parsed, fallbackModel, emitted === 0);
    emitted++;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) yield* emit(line);
      if (done) break;
    }
    buffer += decoder.decode();
    yield* emit(buffer);
  } finally {
    reader.releaseLock();
  }
}
