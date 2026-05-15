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
import { hasToolCalls } from '../client.js';
import { logger } from '../../utils/logger.js';
import { retry, RetryStrategies, RetryPredicates } from '../../utils/retry.js';
import { getCircuitBreaker, CircuitOpenError } from '../../providers/circuit-breaker.js';
import type { CircuitBreakerConfig } from '../../providers/circuit-breaker.js';
import { parseRateLimitHeaders, storeRateLimitInfo } from '../../utils/rate-limit-display.js';
import { mapProviderError } from '../../errors/index.js';
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
}

interface ChatRequestPayloadStreaming extends Omit<ChatCompletionCreateParamsStreaming, 'tools' | 'tool_choice'> {
  tools?: CodeBuddyTool[];
  tool_choice?: 'auto' | 'none' | 'required';
  search_parameters?: SearchParameters;
  thinking?: { type: 'enabled'; budget_tokens: number };
  service_tier?: 'auto' | 'default' | 'flex';
}

function hasUsefulAssistantOutput(response: CodeBuddyResponse): boolean {
  const message = response.choices?.[0]?.message;
  return (
    (typeof message?.content === 'string' && message.content.trim().length > 0) ||
    Boolean(message?.tool_calls && message.tool_calls.length > 0)
  );
}

function chunkHasUsefulAssistantOutput(chunk: ChatCompletionChunk): boolean {
  const delta = chunk.choices?.[0]?.delta;
  return (
    (typeof delta?.content === 'string' && delta.content.trim().length > 0) ||
    Boolean(delta?.tool_calls && delta.tool_calls.length > 0)
  );
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
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      timeout: 360000,
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

      const message = response.choices[0].message;
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

    if (this.isXaiProvider()) {
      logger.debug('Skipping deprecated search_parameters for xAI provider', {
        source: 'OpenAICompatProvider',
      });
      return false;
    }

    return true;
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
        max_tokens: this.defaultMaxTokens,
      };

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

      const response = await this.withCircuitBreaker(opts.circuitBreaker, () =>
        retry(
          async () => {
            return await this.client.chat.completions.create(
              requestPayload as unknown as ChatCompletionCreateParamsNonStreaming,
            );
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

      if (!hasUsefulAssistantOutput(codeBuddyResponse)) {
        throw new Error('OpenAI-compatible provider returned no assistant content or tool calls');
      }

      return codeBuddyResponse;
    } catch (error: unknown) {
      if (error instanceof CircuitOpenError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(mapProviderError(message, this.detectProviderLabel()));
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
        max_tokens: this.defaultMaxTokens,
      };

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
            return await this.client.chat.completions.create(
              streamingPayload as unknown as ChatCompletionCreateParamsStreaming,
            );
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

      let emittedUsefulOutput = false;
      for await (const chunk of stream) {
        if (chunkHasUsefulAssistantOutput(chunk)) {
          emittedUsefulOutput = true;
        }
        if (chunk.choices?.[0]?.finish_reason && !emittedUsefulOutput) {
          throw new Error('OpenAI-compatible provider returned no assistant content or tool calls');
        }
        yield chunk;
      }
      if (!emittedUsefulOutput) {
        throw new Error('OpenAI-compatible provider returned no assistant content or tool calls');
      }
    } catch (error: unknown) {
      if (error instanceof CircuitOpenError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(mapProviderError(message, this.detectProviderLabel()));
    }
  }
}
