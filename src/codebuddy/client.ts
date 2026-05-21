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
import { withStreamRetry } from "./stream-retry.js";

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

/** Message with tool calls (assistant message that requested tool use) */
export interface CodeBuddyMessageWithToolCalls {
  role: 'assistant';
  content: string | null;
  tool_calls: CodeBuddyToolCall[];
}

/** Type guard for messages with tool calls */
export function hasToolCalls(msg: CodeBuddyMessage): msg is CodeBuddyMessageWithToolCalls {
  return msg.role === 'assistant' && 'tool_calls' in msg && Array.isArray((msg as CodeBuddyMessageWithToolCalls).tool_calls);
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
  searchOptions?: SearchOptions;
  /** Optional request timeout override (ms) for Gemini native API calls */
  timeoutMs?: number;
  /** Gemini 3.x thinkingLevel — controls reasoning depth. Never mix with budget_tokens. */
  thinkingLevel?: GeminiThinkingLevel;
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

  private static isGeminiModelName(model: string): boolean {
    return model.toLowerCase().includes('gemini');
  }

  constructor(apiKey: string, model?: string, baseURL?: string) {
    // Validate API key
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('API key is required and must be a non-empty string');
    }
    if (apiKey.trim().length === 0) {
      throw new Error('API key cannot be empty or whitespace only');
    }

    const selectedBaseURL = baseURL ?? process.env.GROK_BASE_URL ?? DEFAULT_BASE_URL;
    // Subprocess providers (gemini-cli) use synthetic baseURL strings that
    // don't pass URL validation. Skip normalization in that case — the
    // baseURL is informational only, the actual transport is the local
    // child process.
    const isSubprocessProvider =
      apiKey === GEMINI_CLI_SENTINEL || selectedBaseURL.startsWith('gemini-cli://');
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
          // After a 401 we re-pull from disk — getChatGptAuth handles the
          // refresh dance itself when last_refresh is stale.
          const { getChatGptAuth } = await import('../providers/codex-oauth.js');
          return getChatGptAuth();
        },
        model: model || this.currentModel,
        defaultMaxTokens: this.defaultMaxTokens,
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
  }

  getCurrentModel(): string {
    return this.currentModel;
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
    if (this.geminiProvider) {
      return this.geminiProvider.chat(messages, tools, opts);
    }
    if (this.chatgptProvider) {
      return this.chatgptProvider.chat(messages, tools, opts);
    }
    if (this.geminiCliProvider) {
      return this.geminiCliProvider.chat(messages, tools, opts);
    }
    return this.openaiCompatProvider!.chat(messages, tools, opts, searchOptions);
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

    // Dispatch to the active strategy. Wrapped in a factory so we can
    // re-invoke it inside `withStreamRetry` when opt-in retry is enabled.
    const factory = (): AsyncGenerator<ChatCompletionChunk, void, unknown> => {
      if (this.geminiProvider) {
        return this.geminiProvider.chatStream(messages, tools, opts);
      }
      if (this.chatgptProvider) {
        return this.chatgptProvider.chatStream(messages, tools, opts);
      }
      if (this.geminiCliProvider) {
        return this.geminiCliProvider.chatStream(messages, tools, opts);
      }
      return this.openaiCompatProvider!.chatStream(messages, tools, opts, searchOptions);
    };

    // Resolve retry opt-in. Per-call `streamRetry` wins over env var when
    // explicitly set (including `false`, which forces no retry).
    const envOptIn = process.env.CODEBUDDY_STREAM_RETRY === '1';
    const callOptIn = opts.streamRetry;
    const retryEnabled = callOptIn !== undefined ? !!callOptIn : envOptIn;

    if (!retryEnabled) {
      yield* factory();
      return;
    }

    const retryOpts = typeof callOptIn === 'object' && callOptIn !== null ? callOptIn : {};
    yield* withStreamRetry(factory, retryOpts);
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
