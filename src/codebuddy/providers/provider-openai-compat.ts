/**
 * OpenAI-compatible provider — Vague 2 Phase C2.
 *
 * Strategy class for every backend reachable through the OpenAI Chat
 * Completions API: GPT, Grok, Anthropic (via OpenRouter / proxy), OpenRouter,
 * Together, Fireworks, Groq, Ollama, vLLM, LM Studio. Bedrock and Azure are
 * served from `src/plugins/bundled/` and remain out of scope here.
 *
 * Migrated verbatim from `client.ts` (rev eb922f3). Behavior changes are
 * limited to:
 *   - logger sources renamed `'CodeBuddyClient'` → `'OpenAICompatProvider'`
 *   - Anthropic message hooks now imported from
 *     `provider-openai-compat-hooks.ts` (Phase C1) instead of inlined
 *   - `circuitBreakerConfig` is read via a getter at call-time so updates
 *     made by `client.setCircuitBreakerConfig()` after construction
 *     propagate (advisor catch — guards against snapshot staleness)
 *
 * Known gap preserved (will close in Phase C4 if Patrice opts in):
 *   - chatStream() does NOT call the Anthropic hooks. The chat() side
 *     does. Same asymmetry as before extraction. Documented in commit
 *     7f6853b's body.
 */

import OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat';
import type {
  CodeBuddyMessage,
  CodeBuddyTool,
  CodeBuddyToolCall,
  CodeBuddyResponse,
  ChatOptions,
  SearchOptions,
  SearchParameters,
} from '../client.js';
import { hasToolCalls } from '../message-guards.js';
import { logger } from '../../utils/logger.js';
import { retry, RetryStrategies, RetryPredicates } from '../../utils/retry.js';
import { getCircuitBreaker, CircuitOpenError } from '../../providers/circuit-breaker.js';
import type { CircuitBreakerConfig } from '../../providers/circuit-breaker.js';
import { parseRateLimitHeaders, storeRateLimitInfo } from '../../utils/rate-limit-display.js';
import { mapProviderError } from '../../errors/index.js';
import { preserveProviderErrorMetadata } from '../provider-error-classifier.js';
import { getModelInfo } from '../../utils/model-utils.js';
import {
  injectAnthropicCacheBreakpoints,
  injectJsonSystemPromptForAnthropic,
} from './provider-openai-compat-hooks.js';
import type { Provider } from './provider-interface.js';

/** Chat completion request payload — OpenAI-shaped with a few provider-specific fields. */
interface ChatRequestPayload extends Omit<ChatCompletionCreateParamsNonStreaming, 'tools' | 'tool_choice'> {
  tools?: CodeBuddyTool[];
  tool_choice?: 'auto' | 'none' | 'required';
  search_parameters?: SearchParameters;
  thinking?: { type: 'enabled'; budget_tokens: number };
  service_tier?: 'auto' | 'default' | 'flex';
  chat_template_kwargs?: { enable_thinking: boolean };
}

interface ChatRequestPayloadStreaming extends Omit<ChatCompletionCreateParamsStreaming, 'tools' | 'tool_choice'> {
  tools?: CodeBuddyTool[];
  tool_choice?: 'auto' | 'none' | 'required';
  search_parameters?: SearchParameters;
  thinking?: { type: 'enabled'; budget_tokens: number };
  service_tier?: 'auto' | 'default' | 'flex';
  chat_template_kwargs?: { enable_thinking: boolean };
}

export interface OpenAICompatProviderOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  defaultMaxTokens: number;
  /**
   * Read at call-time (not snapshot at construction) so changes via
   * `client.setCircuitBreakerConfig()` after construction propagate.
   */
  getCircuitBreakerConfig: () => Partial<CircuitBreakerConfig> | undefined;
}

// Transport-managed headers that extra-header config may never override —
// clobbering these breaks the HTTP layer itself, not just a provider quirk.
const FORBIDDEN_EXTRA_HEADERS = new Set(['host', 'content-length', 'content-type', 'connection', 'transfer-encoding']);

/**
 * Extra HTTP headers applied to every OpenAI-compat LLM API call, for
 * API gateways and observability proxies (Helicone, Portkey, LiteLLM, corp
 * proxies with header-based auth).
 *
 * Source: `CODEBUDDY_LLM_EXTRA_HEADERS` — a JSON object of string values,
 * e.g. `{"Helicone-Auth": "Bearer sk-...", "X-Proxy-Tag": "codebuddy"}`.
 * Transport-managed headers are dropped (warned once); invalid JSON or a
 * non-object disables the feature with a warning rather than failing chat.
 */
export function resolveLlmExtraHeaders(
  raw: string | undefined = process.env.CODEBUDDY_LLM_EXTRA_HEADERS,
): Record<string, string> | undefined {
  if (!raw || !raw.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn('CODEBUDDY_LLM_EXTRA_HEADERS is not valid JSON; ignoring');
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.warn('CODEBUDDY_LLM_EXTRA_HEADERS must be a JSON object of string values; ignoring');
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string' || !key.trim()) continue;
    if (FORBIDDEN_EXTRA_HEADERS.has(key.trim().toLowerCase())) {
      logger.warn(`CODEBUDDY_LLM_EXTRA_HEADERS: dropping transport-managed header "${key}"`);
      continue;
    }
    out[key.trim()] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export class OpenAICompatProvider implements Provider {
  private client: OpenAI;
  private apiKey: string;
  private baseURL: string;
  private currentModel: string;
  private defaultMaxTokens: number;
  private getCircuitBreakerConfig: () => Partial<CircuitBreakerConfig> | undefined;

  // Tool-support probe state (managed by `probeToolSupport()` — single-flight via `probePromise`)
  private toolSupportProbed: boolean = false;
  private toolSupportDetected: boolean | null = null;
  private probePromise: Promise<boolean> | null = null;

  // Prompt cache stats (OpenAI/xAI surface `cached_tokens`; provider-specific)
  private _promptCacheHits: number = 0;
  private _promptCacheMisses: number = 0;

  /**
   * Models known to support function calling / tool use.
   */
  private static readonly FUNCTION_CALLING_MODELS = [
    'hermes',        // Hermes 2 Pro, Hermes 3, Hermes 4
    'functionary',   // MeetKai Functionary
    'gorilla',       // Gorilla OpenFunctions
    'nexusraven',    // NexusRaven
    'firefunction',  // FireFunction
    'toolllama',     // ToolLLaMA
    'glaive',        // Glaive function calling
    'llama-3.1',     // Llama 3.1 has native tool support
    'llama-3.2',     // Llama 3.2 has native tool support
    'llama3.1',      // Alternative naming
    'llama3.2',      // Alternative naming
    'qwen2.5',       // Qwen 2.5 supports tools
    'qwen-2.5',      // Alternative naming
    'mistral',       // Mistral models support function calling
    'mixtral',       // Mixtral supports function calling
    'command-r',     // Cohere Command-R
  ];

  constructor(opts: OpenAICompatProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseURL = opts.baseURL;
    this.currentModel = opts.model;
    this.defaultMaxTokens = opts.defaultMaxTokens;
    this.getCircuitBreakerConfig = opts.getCircuitBreakerConfig;
    const extraHeaders = resolveLlmExtraHeaders();
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      timeout: 360000,
      ...(extraHeaders ? { defaultHeaders: extraHeaders } : {}),
    });
  }

  setModel(model: string): void {
    this.currentModel = model;
  }

  /**
   * Derive a human-readable provider name from the base URL.
   */
  getProviderName(): string {
    const url = this.baseURL.toLowerCase();
    if (url.includes('api.x.ai') || url.includes('xai')) return 'xAI';
    if (url.includes('openai.com')) return 'OpenAI';
    if (url.includes('anthropic.com')) return 'Anthropic';
    if (url.includes('generativelanguage.googleapis.com')) return 'Gemini';
    if (url.includes('openrouter.ai')) return 'OpenRouter';
    if (url.includes('groq.com')) return 'Groq';
    if (url.includes('together.xyz')) return 'Together';
    if (url.includes('fireworks.ai')) return 'Fireworks';
    if (url.includes('localhost') || url.includes('127.0.0.1')) return 'Local';
    return 'API';
  }

  private getOpenRouterProviderRouting(): Record<string, unknown> | undefined {
    if (!this.baseURL.toLowerCase().includes('openrouter.ai')) return undefined;

    const provider: Record<string, unknown> = {};
    this.setListProviderOption(provider, 'only', 'OPENROUTER_PROVIDER_ONLY', 'CODEBUDDY_OPENROUTER_PROVIDER_ONLY');
    this.setListProviderOption(provider, 'ignore', 'OPENROUTER_PROVIDER_IGNORE', 'CODEBUDDY_OPENROUTER_PROVIDER_IGNORE');
    this.setListProviderOption(provider, 'order', 'OPENROUTER_PROVIDER_ORDER', 'CODEBUDDY_OPENROUTER_PROVIDER_ORDER');

    const sort = this.readEnv('OPENROUTER_PROVIDER_SORT', 'CODEBUDDY_OPENROUTER_PROVIDER_SORT')?.toLowerCase();
    if (sort && ['price', 'throughput', 'latency'].includes(sort)) {
      provider.sort = sort;
    }

    const dataCollection = this.readEnv(
      'OPENROUTER_PROVIDER_DATA_COLLECTION',
      'CODEBUDDY_OPENROUTER_PROVIDER_DATA_COLLECTION',
    )?.toLowerCase();
    if (dataCollection && ['allow', 'deny'].includes(dataCollection)) {
      provider.data_collection = dataCollection;
    }

    const requireParameters = this.readBooleanEnv(
      'OPENROUTER_PROVIDER_REQUIRE_PARAMETERS',
      'CODEBUDDY_OPENROUTER_PROVIDER_REQUIRE_PARAMETERS',
    );
    if (requireParameters !== undefined) {
      provider.require_parameters = requireParameters;
    }

    const allowFallbacks = this.readBooleanEnv(
      'OPENROUTER_PROVIDER_ALLOW_FALLBACKS',
      'CODEBUDDY_OPENROUTER_PROVIDER_ALLOW_FALLBACKS',
    );
    if (allowFallbacks !== undefined) {
      provider.allow_fallbacks = allowFallbacks;
    }

    return Object.keys(provider).length > 0 ? provider : undefined;
  }

  private setListProviderOption(provider: Record<string, unknown>, field: string, ...keys: string[]): void {
    const value = this.readEnv(...keys);
    if (!value) return;
    const items = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length > 0) {
      provider[field] = items;
    }
  }

  private readBooleanEnv(...keys: string[]): boolean | undefined {
    const value = this.readEnv(...keys)?.toLowerCase();
    if (!value) return undefined;
    if (['1', 'true', 'yes', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'off'].includes(value)) return false;
    return undefined;
  }

  private readEnv(...keys: string[]): string | undefined {
    for (const key of keys) {
      const value = process.env[key]?.trim();
      if (value) return value;
    }
    return undefined;
  }

  /**
   * Qwen reasoning models served by Lemonade enable hidden thinking by
   * default. That is useful for deep work but disastrous for a conversational
   * fast path: a short answer can spend tens of seconds in reasoning before
   * emitting visible text. Disable it by default on Lemonade; an operator can
   * opt back in for deliberate jobs with CODEBUDDY_LEMONADE_THINKING=1.
   */
  private getLemonadeChatTemplateKwargs(): { enable_thinking: boolean } | undefined {
    const url = this.baseURL.toLowerCase().replace(/\/+$/, '');
    const configured = process.env.LEMONADE_HOST?.trim().toLowerCase().replace(/\/+$/, '');
    const isLemonade = /:13305(?:\/|$)/.test(url) || Boolean(configured && url.startsWith(configured));
    if (!isLemonade) return undefined;
    return {
      enable_thinking: this.readBooleanEnv('CODEBUDDY_LEMONADE_THINKING') ?? false,
    };
  }

  /**
   * Get prompt cache statistics
   */
  getPromptCacheStats(): { hits: number; misses: number; hitRatio: number } {
    const total = this._promptCacheHits + this._promptCacheMisses;
    return {
      hits: this._promptCacheHits,
      misses: this._promptCacheMisses,
      hitRatio: total > 0 ? this._promptCacheHits / total : 0,
    };
  }

  // ===========================================================================
  // Circuit breaker
  // ===========================================================================

  private getCircuitBreakerKey(): string {
    return `provider:${this.baseURL}`;
  }

  private async withCircuitBreaker<T>(
    enabled: boolean | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!enabled) {
      return fn();
    }
    const key = this.getCircuitBreakerKey();
    const cb = getCircuitBreaker(key, this.getCircuitBreakerConfig());
    return cb.execute(fn);
  }

  // ===========================================================================
  // Tool support probing
  // ===========================================================================

  /**
   * Probe the model to check if it supports function calling.
   * Promise-based locking prevents concurrent probes (single API request).
   */
  async probeToolSupport(): Promise<boolean> {
    if (this.toolSupportProbed && this.toolSupportDetected !== null) {
      return this.toolSupportDetected;
    }

    if (this.probePromise) {
      return this.probePromise;
    }

    const modelInfo = getModelInfo(this.currentModel);
    if (['xai', 'anthropic', 'google', 'ollama'].includes(modelInfo.provider)) {
      this.toolSupportProbed = true;
      this.toolSupportDetected = true;
      return true;
    }

    if (process.env.GROK_FORCE_TOOLS === 'true') {
      this.toolSupportProbed = true;
      this.toolSupportDetected = true;
      return true;
    }

    if (this.modelSupportsFunctionCalling()) {
      this.toolSupportProbed = true;
      this.toolSupportDetected = true;
      return true;
    }

    // Synchronous assignment of probePromise BEFORE any await closes the race
    // window — concurrent callers see the same in-flight promise.
    const probe = this.performToolProbe();
    this.probePromise = probe;
    return probe;
  }

  private async performToolProbe(): Promise<boolean> {
    try {
      const testTool: CodeBuddyTool = {
        type: 'function',
        function: {
          name: 'get_current_time',
          description: 'Get the current time',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      };

      const response = await this.client.chat.completions.create({
        model: this.currentModel,
        messages: [{ role: 'user', content: 'What time is it? Use the get_current_time tool.' }],
        tools: [testTool as unknown as OpenAI.ChatCompletionTool],
        tool_choice: 'auto',
        max_tokens: 50,
      });

      if (!response.choices || response.choices.length === 0) {
        logger.warn('Tool support probe returned empty choices array');
        this.toolSupportProbed = true;
        this.toolSupportDetected = false;
        return false;
      }

      const message = response.choices[0]?.message;
      const hasToolCall = !!(message?.tool_calls && message.tool_calls.length > 0);

      this.toolSupportProbed = true;
      this.toolSupportDetected = hasToolCall;

      if (hasToolCall) {
        logger.debug('Tool support detected: model supports function calling');
      }

      return hasToolCall;
    } catch (_error) {
      this.toolSupportProbed = true;
      this.toolSupportDetected = false;
      return false;
    }
  }

  private modelSupportsFunctionCalling(): boolean {
    const modelLower = this.currentModel.toLowerCase();
    return OpenAICompatProvider.FUNCTION_CALLING_MODELS.some(pattern =>
      modelLower.includes(pattern),
    );
  }

  // ===========================================================================
  // Local-inference / xAI gating
  // ===========================================================================

  /**
   * Check if using LM Studio or other local inference server.
   * Can be overridden with GROK_FORCE_TOOLS=true for models that support function calling.
   * Auto-enables tools for models known to support function calling.
   */
  private isLocalInference(): boolean {
    if (process.env.GROK_FORCE_TOOLS === 'true') {
      return false;
    }

    if (this.toolSupportProbed && this.toolSupportDetected === true) {
      return false;
    }

    if (this.modelSupportsFunctionCalling()) {
      return false;
    }

    const modelInfo = getModelInfo(this.currentModel);
    if (modelInfo.provider === 'ollama') return false;
    if (this.baseURL.includes('localhost:11434')) return false;
    if (this.baseURL.includes('127.0.0.1:11434')) return false;
    if (modelInfo.provider === 'lmstudio') return true;
    if (this.baseURL.includes('localhost:1234')) return true;
    if (this.baseURL.includes('127.0.0.1:1234')) return true;
    if (this.baseURL.match(/10\.\d+\.\d+\.\d+:1234/)) return true;
    if (this.baseURL.match(/172\.\d+\.\d+\.\d+:1234/)) return true;
    if (this.baseURL.match(/192\.168\.\d+\.\d+:1234/)) return true;
    return false;
  }

  /** xAI no longer accepts legacy search_parameters payloads. */
  private isXaiProvider(): boolean {
    return this.baseURL.includes('api.x.ai');
  }

  /** Gate legacy search_parameters by provider compatibility. */
  private shouldIncludeSearchParameters(searchParams?: SearchParameters): boolean {
    if (!searchParams) {
      return false;
    }

    if (this.isLocalInference()) {
      return false;
    }

    // `search_parameters` is an xAI/Grok-specific field. Sending it to other
    // OpenAI-compatible providers (Mistral, Groq, Together, Fireworks, …)
    // is rejected with HTTP 422. When search is off (the default) there is
    // nothing to send anyway, so omit the field — a plain request must never
    // carry a disabled-search config that breaks the upstream.
    if (!searchParams.mode || searchParams.mode === 'off') {
      return false;
    }

    if (this.isXaiProvider()) {
      logger.debug('Skipping deprecated search_parameters for xAI provider', {
        source: 'OpenAICompatProvider',
      });
      return false;
    }

    return true;
  }

  private getOllamaReasoningEffort(model: string): string | undefined {
    const modelInfo = getModelInfo(model);
    const isOllama =
      modelInfo.provider === 'ollama' ||
      this.baseURL.includes('localhost:11434') ||
      this.baseURL.includes('127.0.0.1:11434');
    if (!isOllama) return undefined;

    return process.env.CODEBUDDY_OLLAMA_REASONING_EFFORT?.trim() || 'none';
  }

  private isAsyncIterableStream(value: unknown): value is AsyncIterable<ChatCompletionChunk> {
    return !!value
      && typeof value === 'object'
      && typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function';
  }

  private isNonStreamingChatResponse(value: unknown): value is CodeBuddyResponse {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const choices = (value as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return false;
    }
    return choices.every(choice =>
      !!choice
      && typeof choice === 'object'
      && 'message' in choice
      && typeof (choice as { message?: unknown }).message === 'object'
    );
  }

  private *nonStreamingResponseToChunks(response: CodeBuddyResponse): Generator<ChatCompletionChunk, void, unknown> {
    const created = Math.floor(Date.now() / 1000);

    for (const [index, choice] of response.choices.entries()) {
      const message = choice.message;
      const delta: Record<string, unknown> = {
        role: message.role || 'assistant',
      };

      if (message.content !== null && message.content !== undefined) {
        delta.content = message.content;
      }
      if (message.tool_calls && message.tool_calls.length > 0) {
        delta.tool_calls = message.tool_calls.map((toolCall, toolIndex) => ({
          index: toolIndex,
          ...toolCall,
        }));
      }

      yield {
        id: `chatcmpl-fallback-${created}-${index}`,
        object: 'chat.completion.chunk',
        created,
        model: this.currentModel,
        choices: [{
          index,
          delta,
          finish_reason: choice.finish_reason as ChatCompletionChunk.Choice['finish_reason'],
        }],
        ...(response.usage ? { usage: response.usage } : {}),
      } as ChatCompletionChunk;
    }
  }

  // ===========================================================================
  // Prompt cache tracking
  // ===========================================================================

  private trackPromptCache(usage?: { prompt_tokens?: number; cached_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }): void {
    if (!usage) return;
    let cachedTokens = usage.cached_tokens ?? 0;
    if (cachedTokens === 0 && usage.prompt_tokens_details) {
      cachedTokens = usage.prompt_tokens_details.cached_tokens ?? 0;
    }

    const promptTokens = usage.prompt_tokens ?? 0;
    if (cachedTokens > 0) {
      this._promptCacheHits += cachedTokens;
      this._promptCacheMisses += Math.max(0, promptTokens - cachedTokens);
      logger.debug(`Prompt cache: ${cachedTokens} cached / ${promptTokens} total tokens`, {
        source: 'OpenAICompatProvider',
        hitRatio: promptTokens > 0 ? (cachedTokens / promptTokens * 100).toFixed(1) + '%' : '0%',
      });
    } else if (promptTokens > 0) {
      this._promptCacheMisses += promptTokens;
    }
  }

  // ===========================================================================
  // Local-model tool message conversion
  // ===========================================================================

  /**
   * Convert tool messages to user messages for models that don't support the tool role.
   * LM Studio and some local models require this transformation.
   */
  private convertToolMessagesForLocalModels(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
    const hasToolMessages = messages.some((m: CodeBuddyMessage) => m.role === 'tool');
    if (!hasToolMessages) return messages;

    const needsConversion = this.baseURL.includes(':1234') ||
                            this.baseURL.includes('lmstudio') ||
                            process.env.GROK_CONVERT_TOOL_MESSAGES === 'true';
    if (!needsConversion) return messages;

    return messages.map((msg: CodeBuddyMessage) => {
      if (msg.role === 'tool') {
        return {
          role: 'user' as const,
          content: `[Tool Result]\n${msg.content}`,
        };
      }
      if (hasToolCalls(msg)) {
        const toolCallsDesc = msg.tool_calls.map((tc: CodeBuddyToolCall) =>
          `Called ${tc.function.name}(${tc.function.arguments})`,
        ).join('\n');
        return {
          role: 'assistant' as const,
          content: msg.content ? `${msg.content}\n\n[Tools Used]\n${toolCallsDesc}` : `[Tools Used]\n${toolCallsDesc}`,
        };
      }
      return msg;
    });
  }

  /**
   * Derive a short provider label from the current model for error messages.
   * E.g. "grok-code-fast-1" → "grok", "claude-sonnet-4-6" → "anthropic".
   */
  private detectProviderLabel(): string {
    const m = this.currentModel.toLowerCase();
    if (m.startsWith('grok')) return 'grok';
    if (m.startsWith('claude')) return 'anthropic';
    if (m.startsWith('gemini')) return 'gemini';
    if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai';
    if (m.startsWith('ollama') || m.includes(':ollama')) return 'ollama';
    if (m.startsWith('deepseek')) return 'deepseek';
    if (m.startsWith('qwen')) return 'qwen';
    if (m.startsWith('mistral')) return 'mistral';
    return 'provider';
  }

  // ===========================================================================
  // chat() / chatStream()
  // ===========================================================================

  async chat(
    messages: CodeBuddyMessage[],
    tools?: CodeBuddyTool[],
    opts: ChatOptions = {},
    searchOptions?: SearchOptions,
  ): Promise<CodeBuddyResponse> {
    try {
      const useTools = !this.isLocalInference() && tools && tools.length > 0;

      // Inject Anthropic prompt-cache breakpoints (Manus AI #20).
      let finalMessages: CodeBuddyMessage[] = messages;
      const modelInfo = getModelInfo(this.currentModel);
      if (modelInfo.provider === 'anthropic') {
        finalMessages = injectAnthropicCacheBreakpoints(messages) as CodeBuddyMessage[];
      }

      const requestPayload: ChatRequestPayload = {
        model: opts.model || this.currentModel,
        messages: finalMessages,
        tools: useTools ? tools : [],
        tool_choice: useTools ? 'auto' : undefined,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? this.defaultMaxTokens,
      };
      requestPayload.chat_template_kwargs = this.getLemonadeChatTemplateKwargs();
      const openRouterProviderRouting = this.getOpenRouterProviderRouting();
      if (openRouterProviderRouting) {
        (requestPayload as unknown as Record<string, unknown>).provider = openRouterProviderRouting;
      }
      const ollamaReasoningEffort = this.getOllamaReasoningEffort(requestPayload.model);
      if (ollamaReasoningEffort) {
        (requestPayload as unknown as Record<string, unknown>).reasoning_effort = ollamaReasoningEffort;
      }

      const searchOpts = opts.searchOptions || searchOptions;
      const searchParameters = searchOpts?.search_parameters;
      if (this.shouldIncludeSearchParameters(searchParameters)) {
        requestPayload.search_parameters = searchParameters;
      }

      const { getExtendedThinking } = await import('../../agent/extended-thinking.js');
      const thinkingConfig = getExtendedThinking().getThinkingConfig();
      if (thinkingConfig.thinking) {
        requestPayload.thinking = thinkingConfig.thinking;
      }

      if (opts.service_tier) {
        requestPayload.service_tier = opts.service_tier;
      }

      // JSON mode for OpenAI-compat providers; Anthropic also gets a system-prompt instruction.
      if (opts.responseFormat === 'json') {
        (requestPayload as unknown as Record<string, unknown>).response_format = { type: 'json_object' };
        if (modelInfo.provider === 'anthropic') {
          finalMessages = injectJsonSystemPromptForAnthropic(finalMessages);
        }
      }
      // Re-sync — injectJsonSystemPromptForAnthropic returns a new array and
      // requestPayload.messages would otherwise keep the pre-hook reference.
      requestPayload.messages = finalMessages;

      if (opts.tool_choice && useTools) {
        requestPayload.tool_choice = opts.tool_choice;
      }

      const performCall = async (messagesPayload: CodeBuddyMessage[]) => {
        requestPayload.messages = messagesPayload;
        const response = await this.withCircuitBreaker(opts.circuitBreaker, () =>
          retry(
            async () => {
              const payload = requestPayload as unknown as ChatCompletionCreateParamsNonStreaming;
              // Preserve the one-argument SDK call when there is no signal. Apart
              // from keeping existing adapters compatible, this avoids presenting
              // `undefined` as an intentional transport-options override.
              return opts.signal
                ? await this.client.chat.completions.create(payload, { signal: opts.signal })
                : await this.client.chat.completions.create(payload);
            },
            {
              ...RetryStrategies.llmApi,
              isRetryable: RetryPredicates.llmApiError,
              onRetry: (error, attempt, delay) => {
                logger.warn(`API call failed, retrying (attempt ${attempt}) in ${delay}ms...`, {
                  source: 'OpenAICompatProvider',
                  error: error instanceof Error ? error.message : String(error),
                });
              },
            },
          ),
        );

        // Track rate limit headers (best-effort).
        try {
          const rawResponse = (response as unknown as { _response?: { headers?: Record<string, string> } })._response;
          if (rawResponse?.headers) {
            const providerName = this.getProviderName();
            const rateLimitInfo = parseRateLimitHeaders(rawResponse.headers, providerName);
            if (rateLimitInfo.remainingRequests !== undefined || rateLimitInfo.remainingTokens !== undefined) {
              storeRateLimitInfo(rateLimitInfo);
            }
          }
        } catch {
          // Non-critical
        }

        const codeBuddyResponse = response as unknown as CodeBuddyResponse;
        const rawUsage = (response as unknown as Record<string, unknown>).usage as Record<string, unknown> | undefined;
        if (rawUsage) {
          this.trackPromptCache(rawUsage as { prompt_tokens?: number; cached_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } });

          if (codeBuddyResponse.usage) {
            const cachedTokens = (rawUsage.cached_tokens as number | undefined)
              ?? ((rawUsage.prompt_tokens_details as { cached_tokens?: number } | undefined)?.cached_tokens);
            if (cachedTokens !== undefined) {
              codeBuddyResponse.usage.cached_tokens = cachedTokens;
            }
          }
        }
        return codeBuddyResponse;
      };

      if (opts.responseFormat === 'json') {
        const { generateJsonWithRetry } = await import('../../utils/llm-retry.js');
        const generateFn = async (promptUpdate: string): Promise<string> => {
          const callMessages = [...finalMessages];
          if (promptUpdate !== 'initial') {
            callMessages.push({ role: 'user', content: promptUpdate });
          }
          const response = await performCall(callMessages);
          return response.choices[0]?.message?.content || '';
        };

        const parsed = await generateJsonWithRetry<unknown>(generateFn, 'initial');
        const finalString = JSON.stringify(parsed);
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: finalString,
            },
            finish_reason: 'stop',
          }],
        };
      }

      return await performCall(finalMessages);
    } catch (error: unknown) {
      if (error instanceof CircuitOpenError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      // Re-wrap for an actionable message, but PRESERVE the retry-relevant
      // metadata (HTTP status, error code/type, parsed Retry-After) from the
      // raw SDK error — otherwise the downstream `withStreamRetry` classifier
      // sees only a string and can't tell a fatal quota 429 from a transient
      // one, nor honour Retry-After.
      throw preserveProviderErrorMetadata(
        new Error(mapProviderError(message, this.detectProviderLabel())),
        error,
      );
    }
  }

  async *chatStream(
    messages: CodeBuddyMessage[],
    tools?: CodeBuddyTool[],
    opts: ChatOptions = {},
    searchOptions?: SearchOptions,
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    try {
      const useTools = !this.isLocalInference() && tools && tools.length > 0;

      // Convert tool messages for local models that don't support tool role.
      let finalMessages = this.convertToolMessagesForLocalModels(messages);

      // Anthropic message hooks — symmetry with chat() (Phase C4).
      // The pre-C4 chatStream() never called these, so Claude streams missed
      // both the cache_control breakpoint and the IMPORTANT JSON instruction.
      const modelInfo = getModelInfo(this.currentModel);
      if (modelInfo.provider === 'anthropic') {
        finalMessages = injectAnthropicCacheBreakpoints(finalMessages) as CodeBuddyMessage[];
        if (opts.responseFormat === 'json') {
          finalMessages = injectJsonSystemPromptForAnthropic(finalMessages);
        }
      }

      const requestPayload = {
        model: opts.model || this.currentModel,
        messages: finalMessages,
        tools: useTools ? tools : [],
        tool_choice: useTools ? 'auto' as const : undefined,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? this.defaultMaxTokens,
      };
      const lemonadeChatTemplateKwargs = this.getLemonadeChatTemplateKwargs();
      if (lemonadeChatTemplateKwargs) {
        (requestPayload as unknown as Record<string, unknown>).chat_template_kwargs =
          lemonadeChatTemplateKwargs;
      }
      const openRouterProviderRouting = this.getOpenRouterProviderRouting();
      if (openRouterProviderRouting) {
        (requestPayload as unknown as Record<string, unknown>).provider = openRouterProviderRouting;
      }
      const ollamaReasoningEffort = this.getOllamaReasoningEffort(requestPayload.model);
      if (ollamaReasoningEffort) {
        (requestPayload as unknown as Record<string, unknown>).reasoning_effort = ollamaReasoningEffort;
      }

      const searchOpts = opts.searchOptions || searchOptions;
      const searchParameters = searchOpts?.search_parameters;
      const searchParams = this.shouldIncludeSearchParameters(searchParameters)
        ? { search_parameters: searchParameters }
        : {};

      const { getExtendedThinking } = await import('../../agent/extended-thinking.js');
      const thinkingConfig = getExtendedThinking().getThinkingConfig();

      const streamingPayload: ChatRequestPayloadStreaming = {
        ...requestPayload,
        ...searchParams,
        stream: true,
        ...(thinkingConfig.thinking ? { thinking: thinkingConfig.thinking } : {}),
        ...(opts.service_tier ? { service_tier: opts.service_tier } : {}),
        ...(opts.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      };

      const stream = await this.withCircuitBreaker(opts.circuitBreaker, () =>
        retry(
          async () => {
            const payload = streamingPayload as unknown as ChatCompletionCreateParamsStreaming;
            return opts.signal
              ? await this.client.chat.completions.create(payload, { signal: opts.signal })
              : await this.client.chat.completions.create(payload);
          },
          {
            ...RetryStrategies.llmApi,
            isRetryable: RetryPredicates.llmApiError,
            onRetry: (error, attempt, delay) => {
              logger.warn(`Stream initialization failed, retrying (attempt ${attempt}) in ${delay}ms...`, {
                source: 'OpenAICompatProvider',
                error: error instanceof Error ? error.message : String(error),
              });
            },
          },
        ),
      );

      if (!this.isAsyncIterableStream(stream)) {
        if (this.isNonStreamingChatResponse(stream)) {
          logger.debug('Streaming request returned a non-streaming chat response; adapting it to chunks', {
            source: 'OpenAICompatProvider',
          });
          yield* this.nonStreamingResponseToChunks(stream);
          return;
        }

        logger.debug('Streaming request returned no async iterator; retrying as non-streaming chat', {
          source: 'OpenAICompatProvider',
        });
        const response = await this.chat(messages, tools, opts, searchOptions);
        yield* this.nonStreamingResponseToChunks(response);
        return;
      }

      let yieldedChunks = 0;
      for await (const chunk of stream) {
        yieldedChunks++;
        yield chunk;
      }

      if (yieldedChunks === 0) {
        logger.debug('Streaming request yielded zero chunks; retrying as non-streaming chat', {
          source: 'OpenAICompatProvider',
        });
        const response = await this.chat(messages, tools, opts, searchOptions);
        yield* this.nonStreamingResponseToChunks(response);
      }
    } catch (error: unknown) {
      if (error instanceof CircuitOpenError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      // Re-wrap for an actionable message, but PRESERVE the retry-relevant
      // metadata (HTTP status, error code/type, parsed Retry-After) from the
      // raw SDK error — otherwise the downstream `withStreamRetry` classifier
      // sees only a string and can't tell a fatal quota 429 from a transient
      // one, nor honour Retry-After.
      throw preserveProviderErrorMetadata(
        new Error(mapProviderError(message, this.detectProviderLabel())),
        error,
      );
    }
  }
}
