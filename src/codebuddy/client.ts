import type {
  ChatCompletionMessageParam,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat";
import { validateModel, getModelInfo } from "../utils/model-utils.js";
import { getModelToolConfig } from "../config/model-tools.js";
import { logger } from "../utils/logger.js";
import { normalizeBaseURL, DEFAULT_BASE_URL } from "../utils/base-url.js";
import type { CircuitBreakerConfig } from "../providers/circuit-breaker.js";
import { GeminiNativeProvider } from "./providers/provider-gemini-native.js";
import { OpenAICompatProvider } from "./providers/provider-openai-compat.js";
import { ChatGptResponsesProvider } from "./providers/provider-chatgpt-responses.js";
import { GeminiCliProvider } from "./providers/provider-gemini-cli.js";
import { AgyCliProvider } from './providers/provider-agy-cli.js';
import { withStreamRetry } from "./stream-retry.js";
import {
  recordRuntimeFallbackFailure,
  recordRuntimeFallbackSuccess,
  resolveRuntimeCredentialPoolProviders,
  resolveRuntimeFallbackProviders,
  type RuntimeFallbackProvider,
} from "../providers/provider-fallback.js";
export { hasToolCalls } from './message-guards.js';
export type { CodeBuddyMessageWithToolCalls } from './message-guards.js';

/** Sentinel apiKey for the ChatGPT OAuth path — auto-detect chain in
 *  `src/index.ts` passes this when `~/.codebuddy/codex-auth.json` exists. */
export const CHATGPT_OAUTH_SENTINEL = 'oauth-chatgpt';
/** Canonical baseURL for the ChatGPT Codex Responses backend. */
export const CHATGPT_RESPONSES_BASE_URL = 'https://chatgpt.com/backend-api/codex';
/** Sentinel apiKey selecting the local `gemini` CLI subprocess strategy.
 *  Set by the fleet peer-chat factory when env declares
 *  `CODEBUDDY_PEER_PROVIDER=gemini-cli`. */
export const GEMINI_CLI_SENTINEL = 'gemini-cli';
/** Synthetic baseURL marker for the Gemini CLI subprocess strategy. */
export const GEMINI_CLI_BASE_URL = 'gemini-cli://local';
/** Sentinel apiKey selecting the local Antigravity CLI subprocess strategy. */
export const AGY_CLI_SENTINEL = 'agy-cli';
/** Synthetic baseURL marker for the Antigravity CLI subprocess strategy. */
export const AGY_CLI_BASE_URL = 'agy-cli://local';

export type CodeBuddyMessage = ChatCompletionMessageParam;

/** JSON Schema property definition */
export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  default?: unknown;
  additionalProperties?: boolean | JsonSchemaProperty;
}

export interface CodeBuddyTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, JsonSchemaProperty>;
      required: string[];
      additionalProperties?: boolean | JsonSchemaProperty;
    };
  };
}

/** Chat completion request payload - extends OpenAI types with Grok-specific fields */
export interface ChatRequestPayload extends Omit<ChatCompletionCreateParamsNonStreaming, 'tools' | 'tool_choice'> {
  tools?: CodeBuddyTool[];
  tool_choice?: "auto" | "none" | "required";
  search_parameters?: SearchParameters;
  thinking?: { type: 'enabled'; budget_tokens: number };
  /** Anthropic/OpenAI service tier for latency vs quality trade-off */
  service_tier?: 'auto' | 'default' | 'flex';
}

/** Streaming chat completion request payload */
export interface ChatRequestPayloadStreaming extends Omit<ChatCompletionCreateParamsStreaming, 'tools' | 'tool_choice'> {
  tools?: CodeBuddyTool[];
  tool_choice?: "auto" | "none" | "required";
  search_parameters?: SearchParameters;
  thinking?: { type: 'enabled'; budget_tokens: number };
  /** Anthropic/OpenAI service tier for latency vs quality trade-off */
  service_tier?: 'auto' | 'default' | 'flex';
}

export interface CodeBuddyToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface SearchParameters {
  mode?: "auto" | "on" | "off";
  // sources removed - let API use default sources to avoid format issues
}

export interface SearchOptions {
  search_parameters?: SearchParameters;
}

export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface ChatOptions {
  model?: string;
  temperature?: number;
  /** Optional per-call output-token cap. Providers fall back to their model default when omitted. */
  maxTokens?: number;
  searchOptions?: SearchOptions;
  /** Optional request timeout override (ms) for Gemini native API calls */
  timeoutMs?: number;
  /** Gemini 3.x thinkingLevel — controls reasoning depth. Never mix with budget_tokens. */
  thinkingLevel?: GeminiThinkingLevel;
  /** ChatGPT Codex reasoning effort. Sol additionally supports max/ultra. */
  codexReasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
  /** Internal: retry counter for Gemini malformed function-call recovery */
  geminiMalformedRetryCount?: number;
  /** Internal: guard against infinite model fallback loops on Gemini */
  geminiModelFallbackTried?: boolean;
  /** Service tier for latency/quality trade-off (Anthropic/OpenAI fast mode) */
  service_tier?: 'auto' | 'default' | 'flex';
  /** Enable circuit breaker for this call (opt-in). Wraps the API call with provider-level circuit breaker. */
  circuitBreaker?: boolean;
  /** Response format: 'text' (default) or 'json' for structured JSON output */
  responseFormat?: 'text' | 'json';
  /** tool_choice override for this request */
  tool_choice?: 'auto' | 'none' | 'required';
  /** Disable Hermes-style cross-provider fallback for this one request. */
  disableProviderFallback?: boolean;
  /**
   * Abort this request mid-flight (barge-in / cancellation). Threaded to the
   * transport (undici/fetch) via the OpenAI SDK's per-request `RequestOptions.signal`
   * on the OpenAI-compat strategy. Additive: when omitted, the call is unchanged.
   * (Gemini-native / ChatGPT-Responses / Gemini-CLI strategies currently ignore it.)
   */
  signal?: AbortSignal;
  /**
   * Enable Gemini's native server-side Google Search grounding for this
   * request. Only affects the GeminiNativeProvider — ignored by the
   * OpenAI-compat path. When on, the response includes citation metadata
   * which we surface as a "Sources:" footer in the assistant content.
   *
   * Defaults to the provider-level default (set via
   * `setDefaultGoogleSearch` or env var `GEMINI_GOOGLE_SEARCH=1`).
   * Pass `false` here to force off even when the default is on.
   */
  googleSearch?: boolean;
  /**
   * Mid-stream retry on network errors (ECONNRESET, "socket hang up",
   * undici stream terminated, etc.). Wraps `chatStream()` with the
   * `withStreamRetry` helper.
   *
   * - `true` → use defaults (4 attempts, 1s initial delay, 8s cap)
   * - object → granular override of any field
   * - `undefined` → no retry (default, backward-compat)
   *
   * Can also be enabled globally via env var `CODEBUDDY_STREAM_RETRY=1`.
   * Per-call option takes precedence over the env var when explicitly set
   * (including `false`, which forces no retry even if the env var is on).
   *
   * Trade-off: a retried stream restarts from the beginning, so callers
   * may see duplicated chunks across the retry boundary. See
   * `src/codebuddy/stream-retry.ts` for the full helper documentation.
   */
  streamRetry?: boolean | {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  };
}

export interface CodeBuddyClientOptions {
  /** Enable env-configured fallback providers. Default: true. */
  enableFallbacks?: boolean;
  /** Enable same-provider auth profile rotation before cross-provider fallback. Default: true. */
  enableCredentialPool?: boolean;
  /** Explicit same-provider credential pool candidates, mainly for tests and controlled embedding. */
  credentialPoolProviders?: RuntimeFallbackProvider[];
  /** Explicit fallback providers, mainly for tests and controlled embedding. */
  fallbackProviders?: RuntimeFallbackProvider[];
}

export interface CodeBuddyResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: CodeBuddyToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /** Cached prompt tokens (OpenAI/xAI automatic prefix caching) */
    cached_tokens?: number;
  };
}

export class CodeBuddyClient {
  private currentModel: string = "grok-code-fast-1";
  private defaultMaxTokens: number;
  private baseURL: string;
  private apiKey: string;
  private isGeminiProvider: boolean = false;
  private geminiRequestTimeoutMs: number;
  private circuitBreakerConfig: Partial<CircuitBreakerConfig> | undefined;
  private defaultThinkingLevel: GeminiThinkingLevel | undefined;
  private defaultGoogleSearch: boolean | undefined;
  /** Strategy for native Gemini API calls — non-null only when isGeminiProvider. */
  private geminiProvider: GeminiNativeProvider | null = null;
  /** Strategy for OpenAI-compat backends — non-null only when NOT isGeminiProvider. */
  private openaiCompatProvider: OpenAICompatProvider | null = null;
  /** Strategy for ChatGPT Codex Responses backend (OAuth, Patrice's plan). */
  private chatgptProvider: ChatGptResponsesProvider | null = null;
  /** True when routed through ChatGPT Responses (apiKey sentinel or matching baseURL). */
  private isChatGptProvider: boolean = false;
  /** Strategy that wraps the local `gemini` CLI binary as a subprocess. */
  private geminiCliProvider: GeminiCliProvider | null = null;
  /** True when routed through the Gemini CLI subprocess. */
  private isGeminiCliProvider: boolean = false;
  /** Strategy that wraps the local Antigravity (`agy`) CLI. */
  private agyCliProvider: AgyCliProvider | null = null;
  /** True when routed through the Antigravity CLI subprocess. */
  private isAgyCliProvider: boolean = false;
  /** Same-provider auth profile candidates, tried before cross-provider fallback. */
  private credentialPoolProviders: RuntimeFallbackProvider[] = [];
  /** Hermes-style cross-provider fallback candidates, tried per failed chat turn. */
  private fallbackProviders: RuntimeFallbackProvider[] = [];

  /**
   * Configure the circuit breaker for this client.
   * Once configured, calls with `circuitBreaker: true` in ChatOptions
   * will be wrapped with the circuit breaker for the provider.
   */
  /**
   * Set default thinking level for Gemini 3.x models (from settings).
   */
  setDefaultThinkingLevel(level: GeminiThinkingLevel): void {
    this.defaultThinkingLevel = level;
    this.geminiProvider?.setDefaultThinkingLevel(level);
    this.chatgptProvider?.setDefaultReasoningEffort(level);
    logger.debug('Default Gemini thinkingLevel set from settings', { level });
  }

  /**
   * Enable Gemini's native server-side Google Search grounding by default
   * for every request through this client. Per-call `ChatOptions.googleSearch`
   * still takes precedence (including `false` to force off).
   */
  setDefaultGoogleSearch(enabled: boolean): void {
    this.defaultGoogleSearch = enabled;
    this.geminiProvider?.setDefaultGoogleSearch(enabled);
    logger.debug('Default Gemini googleSearch grounding set', { enabled });
  }

  setCircuitBreakerConfig(config: Partial<CircuitBreakerConfig>): void {
    this.circuitBreakerConfig = config;
    // Provider reads via getter at call-time, so no propagation needed.
  }

  /**
   * Override the cross-provider fallback list after construction. Used by the
   * active-LLM registry to auto-populate failover from the user's live logins.
   * `chatWithProviderFallback` reads this per-call, so it takes effect immediately.
   */
  setRuntimeFallbackProviders(providers: RuntimeFallbackProvider[]): void {
    this.fallbackProviders = providers;
  }

  private static isGeminiModelName(model: string): boolean {
    return model.toLowerCase().includes('gemini');
  }

  constructor(apiKey: string, model?: string, baseURL?: string, options: CodeBuddyClientOptions = {}) {
    // Validate API key
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('API key is required and must be a non-empty string');
    }
    if (apiKey.trim().length === 0) {
      throw new Error('API key cannot be empty or whitespace only');
    }

    const selectedBaseURL = baseURL ?? process.env.GROK_BASE_URL ?? DEFAULT_BASE_URL;
    // Subprocess providers use synthetic baseURL strings that
    // don't pass URL validation. Skip normalization in that case — the
    // baseURL is informational only, the actual transport is the local
    // child process.
    const isSubprocessProvider =
      apiKey === GEMINI_CLI_SENTINEL ||
      selectedBaseURL.startsWith('gemini-cli://') ||
      apiKey === AGY_CLI_SENTINEL ||
      selectedBaseURL.startsWith('agy-cli://');
    this.baseURL = isSubprocessProvider
      ? selectedBaseURL.replace(/\/$/, '')
      : normalizeBaseURL(selectedBaseURL);
    this.apiKey = apiKey;

    // Detect Gemini provider
    this.isGeminiProvider = this.baseURL.includes('generativelanguage.googleapis.com');
    // Detect ChatGPT Codex (OAuth subscription auth). Either the sentinel
    // apiKey set by the auto-detect chain, or an explicit baseURL pointing
    // at the Codex Responses backend.
    this.isChatGptProvider =
      apiKey === CHATGPT_OAUTH_SENTINEL ||
      this.baseURL.includes('chatgpt.com/backend-api/codex');
    // Detect Gemini CLI subprocess provider. Sentinel apiKey or the
    // synthetic `gemini-cli://` baseURL prefix select this strategy.
    this.isGeminiCliProvider =
      apiKey === GEMINI_CLI_SENTINEL ||
      this.baseURL.startsWith('gemini-cli://');
    this.isAgyCliProvider =
      apiKey === AGY_CLI_SENTINEL ||
      this.baseURL.startsWith('agy-cli://');
    const envGeminiTimeout = Number(
      process.env.CODEBUDDY_GEMINI_TIMEOUT_MS || process.env.CODEBUDDY_REQUEST_TIMEOUT_MS
    );
    this.geminiRequestTimeoutMs =
      Number.isFinite(envGeminiTimeout) && envGeminiTimeout >= 5000
        ? envGeminiTimeout
        : 60000;

    // Env var opt-in for default Google Search grounding (only meaningful
    // for Gemini-native; OpenAI-compat path ignores it).
    if (process.env.GEMINI_GOOGLE_SEARCH === '1') {
      this.defaultGoogleSearch = true;
    }

    const envMax = Number(process.env.CODEBUDDY_MAX_TOKENS);
    if (Number.isFinite(envMax) && envMax > 0) {
      this.defaultMaxTokens = envMax;
    } else {
      const toolConfig = getModelToolConfig(model || this.currentModel);
      this.defaultMaxTokens = toolConfig.maxOutputTokens ?? 16384;
    }

    // Instantiate the active strategy. Exactly one of geminiProvider /
    // openaiCompatProvider / chatgptProvider is non-null. defaultMaxTokens
    // is resolved first so the provider gets the same value the legacy
    // methods used.
    if (this.isGeminiProvider) {
      this.geminiProvider = new GeminiNativeProvider({
        apiKey: this.apiKey,
        baseURL: this.baseURL,
        model: model || this.currentModel,
        defaultMaxTokens: this.defaultMaxTokens,
        geminiRequestTimeoutMs: this.geminiRequestTimeoutMs,
        defaultThinkingLevel: this.defaultThinkingLevel,
        defaultGoogleSearch: this.defaultGoogleSearch,
      });
    } else if (this.isChatGptProvider) {
      // Lazy-imported via dynamic require to avoid circular init in tests.
      // The auth provider closure runs on every request → opportunistic
      // refresh stays automatic.
      this.chatgptProvider = new ChatGptResponsesProvider({
        authProvider: async () => {
          const { getChatGptAuth } = await import('../providers/codex-oauth.js');
          return getChatGptAuth();
        },
        refreshAuth: async () => {
          // A 401 is authoritative even when last_refresh is recent: force
          // token rotation instead of retrying the same rejected bearer.
          const { refreshChatGptAuth } = await import('../providers/codex-oauth.js');
          return refreshChatGptAuth();
        },
        modelCatalogProvider: async (auth) => {
          const { discoverChatGptModels } = await import('../providers/chatgpt-models.js');
          return discoverChatGptModels(auth);
        },
        model: model || this.currentModel,
        defaultMaxTokens: this.defaultMaxTokens,
        defaultReasoningEffort: process.env.CODEBUDDY_CODEX_REASONING_EFFORT,
      });
    } else if (this.isGeminiCliProvider) {
      // Wrap the local `gemini` binary as a subprocess. The path comes
      // from `GEMINI_CLI_PATH` (env), with `gemini` in PATH as fallback —
      // when the binary is missing the constructor throws so the failure
      // surfaces immediately at fleet boot rather than at first dispatch.
      const binaryPath = process.env.GEMINI_CLI_PATH || 'gemini';
      this.geminiCliProvider = new GeminiCliProvider({
        binaryPath,
        model: model || this.currentModel,
        defaultMaxTokens: this.defaultMaxTokens,
      });
    } else if (this.isAgyCliProvider) {
      const binaryPath = process.env.AGY_CLI_PATH || 'agy';
      const configuredTimeout = Number(process.env.CODEBUDDY_AGY_TIMEOUT_MS);
      this.agyCliProvider = new AgyCliProvider({
        binaryPath,
        model: model || this.currentModel,
        defaultMaxTokens: this.defaultMaxTokens,
        requestTimeoutMs:
          Number.isFinite(configuredTimeout) && configuredTimeout >= 5_000
            ? configuredTimeout
            : undefined,
      });
    } else {
      this.openaiCompatProvider = new OpenAICompatProvider({
        apiKey: this.apiKey,
        baseURL: this.baseURL,
        model: model || this.currentModel,
        defaultMaxTokens: this.defaultMaxTokens,
        // Read at call-time so changes from setCircuitBreakerConfig() propagate.
        getCircuitBreakerConfig: () => this.circuitBreakerConfig,
      });
    }
    if (model) {
      // Validate model type
      if (typeof model !== 'string') {
        throw new Error('Model name must be a string');
      }
      // Validate model (non-strict to allow custom models)
      validateModel(model, false);

      // Guard against provider/model mismatch: using a Grok model with Gemini API
      // leads to hard 404 errors at runtime.
      if (this.isGeminiProvider && !CodeBuddyClient.isGeminiModelName(model)) {
        logger.warn(
          `Model '${model}' is incompatible with Gemini provider. Falling back to 'gemini-2.5-flash'.`
        );
        this.currentModel = 'gemini-2.5-flash';
      } else {
        this.currentModel = model;
      }

      // Log warning if model is not officially supported
      const modelInfo = getModelInfo(model);
      if (!modelInfo.isSupported) {
        logger.warn(
          `Model '${model}' is not officially supported. Using default token limits.`
        );
      }
    }

    if (options.enableFallbacks !== false) {
      if (options.enableCredentialPool !== false) {
        this.credentialPoolProviders = options.credentialPoolProviders ?? resolveRuntimeCredentialPoolProviders({
          active: {
            apiKey: this.apiKey,
            baseURL: this.baseURL,
            model: this.currentModel,
          },
        });
      }
      this.fallbackProviders = options.fallbackProviders ?? resolveRuntimeFallbackProviders({
        active: {
          apiKey: this.apiKey,
          baseURL: this.baseURL,
          model: this.currentModel,
        },
      });
    }
  }

  /**
   * Probe the model to check if it supports function calling
   * Makes a quick test request with a simple tool
   * Uses promise-based locking to prevent concurrent probes
   */
  /**
   * Probe the model to check if it supports function calling.
   * Delegates to the OpenAI-compat strategy. Gemini doesn't probe — it
   * returns true unconditionally because the native API supports tools.
   */
  async probeToolSupport(): Promise<boolean> {
    if (this.openaiCompatProvider) {
      return this.openaiCompatProvider.probeToolSupport();
    }
    return true;
  }

  setModel(model: string): void {
    // Validate model input
    if (!model || typeof model !== 'string') {
      throw new Error('Model name is required and must be a non-empty string');
    }
    if (model.trim().length === 0) {
      throw new Error('Model name cannot be empty or whitespace only');
    }
    // Validate model (non-strict to allow custom models)
    validateModel(model, false);

    const modelInfo = getModelInfo(model);
    if (!modelInfo.isSupported) {
      logger.warn(
        `Model '${model}' is not officially supported. Using default token limits.`
      );
    }

    this.currentModel = model;
    this.geminiProvider?.setModel(model);
    this.openaiCompatProvider?.setModel(model);
    this.chatgptProvider?.setModel(model);
    this.geminiCliProvider?.setModel(model);
    this.agyCliProvider?.setModel(model);
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  /**
   * True when the active strategy is the ChatGPT Codex OAuth backend, which is
   * billed against the user's flat-fee Plus/Pro plan, not per token. Cost
   * displays should report $0 here regardless of the reported model slug — the
   * client's `currentModel` can lag the actual Codex model. (smoke-test F8)
   */
  isSubscriptionAuth(): boolean {
    return this.isChatGptProvider || this.isGeminiCliProvider || this.isAgyCliProvider;
  }

  getBaseURL(): string {
    return this.baseURL;
  }

  /**
   * Derive a human-readable provider name from the base URL.
   */
  getProviderName(): string {
    if (this.isChatGptProvider) return 'ChatGPT (OAuth)';
    if (this.isGeminiCliProvider) return 'Gemini CLI (Ultra)';
    if (this.isAgyCliProvider) return 'Antigravity CLI (Ultra)';
    const url = this.baseURL.toLowerCase();
    if (url.includes('chatgpt.com')) return 'ChatGPT (OAuth)';
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
   * Get prompt cache statistics. Delegates to the OpenAI-compat strategy.
   * Gemini doesn't surface cached_tokens in usageMetadata so the Gemini
   * branch returns zeros.
   */
  getPromptCacheStats(): { hits: number; misses: number; hitRatio: number } {
    if (this.openaiCompatProvider) {
      return this.openaiCompatProvider.getPromptCacheStats();
    }
    return { hits: 0, misses: 0, hitRatio: 0 };
  }

  /**
   * Check if using Gemini provider
   */
  isGemini(): boolean {
    return this.isGeminiProvider;
  }

  async chat(
    messages: CodeBuddyMessage[],
    tools?: CodeBuddyTool[],
    options?: string | ChatOptions,
    searchOptions?: SearchOptions
  ): Promise<CodeBuddyResponse> {
    // Validate messages
    if (!messages || !Array.isArray(messages)) {
      throw new Error('Messages must be a non-empty array');
    }
    if (messages.length === 0) {
      throw new Error('Messages array cannot be empty');
    }
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || typeof msg !== 'object') {
        throw new Error(`Message at index ${i} must be an object`);
      }
      if (!msg.role || typeof msg.role !== 'string') {
        throw new Error(`Message at index ${i} must have a valid 'role' field`);
      }
      if (!['system', 'user', 'assistant', 'tool'].includes(msg.role)) {
        throw new Error(`Message at index ${i} has invalid role '${msg.role}'. Must be one of: system, user, assistant, tool`);
      }
    }

    // Support both old signature (model as string) and new signature (options object)
    const opts: ChatOptions = typeof options === "string"
      ? { model: options, searchOptions }
      : options || {};

    // Dispatch to the active strategy.
    try {
      return await this.dispatchChat(messages, tools, opts, searchOptions);
    } catch (error) {
      return await this.chatWithProviderFallback(error, messages, tools, opts, searchOptions);
    }
  }

  private async dispatchChat(
    messages: CodeBuddyMessage[],
    tools: CodeBuddyTool[] | undefined,
    opts: ChatOptions,
    searchOptions?: SearchOptions,
  ): Promise<CodeBuddyResponse> {
    if (this.geminiProvider) {
      return this.geminiProvider.chat(messages, tools, opts);
    }
    if (this.chatgptProvider) {
      return this.chatgptProvider.chat(messages, tools, opts);
    }
    if (this.geminiCliProvider) {
      return this.geminiCliProvider.chat(messages, tools, opts);
    }
    if (this.agyCliProvider) {
      return this.agyCliProvider.chat(messages, tools, opts);
    }
    return this.openaiCompatProvider!.chat(messages, tools, opts, searchOptions);
  }

  private async chatWithProviderFallback(
    primaryError: unknown,
    messages: CodeBuddyMessage[],
    tools: CodeBuddyTool[] | undefined,
    opts: ChatOptions,
    searchOptions?: SearchOptions,
  ): Promise<CodeBuddyResponse> {
    const fallbackCandidates = [
      ...this.credentialPoolProviders,
      ...this.fallbackProviders,
    ];

    if (opts.disableProviderFallback || fallbackCandidates.length === 0) {
      throw primaryError;
    }

    const fallbackOptsBase: ChatOptions = {
      ...opts,
      disableProviderFallback: true,
    };

    for (const fallback of fallbackCandidates) {
      try {
        logger.warn('Primary provider failed; trying fallback provider', {
          source: 'CodeBuddyClient',
          primaryProvider: this.getProviderName(),
          fallbackProvider: fallback.provider,
          fallbackModel: fallback.model,
          fallbackSource: fallback.fallbackSource,
          profileId: fallback.profileId,
          error: primaryError instanceof Error ? primaryError.message : String(primaryError),
        });

        const fallbackClient = new CodeBuddyClient(
          fallback.apiKey,
          fallback.model,
          fallback.baseURL,
          { enableFallbacks: false },
        );
        if (this.circuitBreakerConfig) {
          fallbackClient.setCircuitBreakerConfig(this.circuitBreakerConfig);
        }

        const response = await fallbackClient.chat(messages, tools, {
          ...fallbackOptsBase,
          model: fallback.model,
        }, searchOptions);
        recordRuntimeFallbackSuccess(fallback);
        return response;
      } catch (fallbackError) {
        recordRuntimeFallbackFailure(fallback, fallbackError);
        logger.warn('Fallback provider failed', {
          source: 'CodeBuddyClient',
          fallbackProvider: fallback.provider,
          fallbackModel: fallback.model,
          fallbackSource: fallback.fallbackSource,
          profileId: fallback.profileId,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }

    throw primaryError;
  }

  async *chatStream(
    messages: CodeBuddyMessage[],
    tools?: CodeBuddyTool[],
    options?: string | ChatOptions,
    searchOptions?: SearchOptions
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    // Support both old signature (model as string) and new signature (options object)
    const opts: ChatOptions = typeof options === "string"
      ? { model: options, searchOptions }
      : options || {};

    // Resolve retry opt-in. Per-call `streamRetry` wins over env var when
    // explicitly set (including `false`, which forces no retry).
    const envOptIn = process.env.CODEBUDDY_STREAM_RETRY === '1';
    const callOptIn = opts.streamRetry;
    const retryEnabled = callOptIn !== undefined ? !!callOptIn : envOptIn;
    const retryOpts = typeof callOptIn === 'object' && callOptIn !== null ? callOptIn : {};
    const primaryFactory = (): AsyncGenerator<ChatCompletionChunk, void, unknown> =>
      this.dispatchChatStream(messages, tools, opts, searchOptions);
    const primaryStream = retryEnabled
      ? withStreamRetry(primaryFactory, retryOpts)
      : primaryFactory();

    let yieldedAnyChunk = false;
    try {
      for await (const chunk of primaryStream) {
        yieldedAnyChunk = true;
        yield chunk;
      }
    } catch (error) {
      if (yieldedAnyChunk) {
        throw error;
      }
      yield* this.chatStreamWithProviderFallback(error, messages, tools, opts, searchOptions);
    }
  }

  private dispatchChatStream(
    messages: CodeBuddyMessage[],
    tools: CodeBuddyTool[] | undefined,
    opts: ChatOptions,
    searchOptions?: SearchOptions,
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    if (this.geminiProvider) {
      return this.geminiProvider.chatStream(messages, tools, opts);
    }
    if (this.chatgptProvider) {
      return this.chatgptProvider.chatStream(messages, tools, opts);
    }
    if (this.geminiCliProvider) {
      return this.geminiCliProvider.chatStream(messages, tools, opts);
    }
    if (this.agyCliProvider) {
      return this.agyCliProvider.chatStream(messages, tools, opts);
    }
    return this.openaiCompatProvider!.chatStream(messages, tools, opts, searchOptions);
  }

  private async *chatStreamWithProviderFallback(
    primaryError: unknown,
    messages: CodeBuddyMessage[],
    tools: CodeBuddyTool[] | undefined,
    opts: ChatOptions,
    searchOptions?: SearchOptions,
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const fallbackCandidates = [
      ...this.credentialPoolProviders,
      ...this.fallbackProviders,
    ];

    if (opts.disableProviderFallback || fallbackCandidates.length === 0) {
      throw primaryError;
    }

    const fallbackOptsBase: ChatOptions = {
      ...opts,
      disableProviderFallback: true,
    };

    for (const fallback of fallbackCandidates) {
      try {
        logger.warn('Primary provider stream failed before first chunk; trying fallback provider', {
          source: 'CodeBuddyClient',
          primaryProvider: this.getProviderName(),
          fallbackProvider: fallback.provider,
          fallbackModel: fallback.model,
          fallbackSource: fallback.fallbackSource,
          profileId: fallback.profileId,
          error: primaryError instanceof Error ? primaryError.message : String(primaryError),
        });

        const fallbackClient = new CodeBuddyClient(
          fallback.apiKey,
          fallback.model,
          fallback.baseURL,
          { enableFallbacks: false },
        );
        if (this.circuitBreakerConfig) {
          fallbackClient.setCircuitBreakerConfig(this.circuitBreakerConfig);
        }

        for await (const chunk of fallbackClient.chatStream(messages, tools, {
          ...fallbackOptsBase,
          model: fallback.model,
        }, searchOptions)) {
          yield chunk;
        }
        recordRuntimeFallbackSuccess(fallback);
        return;
      } catch (fallbackError) {
        recordRuntimeFallbackFailure(fallback, fallbackError);
        logger.warn('Fallback provider stream failed', {
          source: 'CodeBuddyClient',
          fallbackProvider: fallback.provider,
          fallbackModel: fallback.model,
          fallbackSource: fallback.fallbackSource,
          profileId: fallback.profileId,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }

    throw primaryError;
  }

  async search(
    query: string,
    searchParameters?: SearchParameters
  ): Promise<CodeBuddyResponse> {
    const searchMessage: CodeBuddyMessage = {
      role: "user",
      content: query,
    };

    const searchOptions: SearchOptions = {
      search_parameters: searchParameters || { mode: "on" },
    };

    return this.chat([searchMessage], [], undefined, searchOptions);
  }
}
