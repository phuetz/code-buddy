import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionChunk, ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming } from "openai/resources/chat";
import { validateModel, getModelInfo } from "../utils/model-utils.js";
import { logger } from "../utils/logger.js";
import { retry, RetryStrategies, RetryPredicates } from "../utils/retry.js";

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
interface ChatRequestPayload extends Omit<ChatCompletionCreateParamsNonStreaming, 'tools' | 'tool_choice'> {
  tools?: CodeBuddyTool[];
  tool_choice?: "auto" | "none" | "required";
  search_parameters?: SearchParameters;
}

/** Streaming chat completion request payload */
interface ChatRequestPayloadStreaming extends Omit<ChatCompletionCreateParamsStreaming, 'tools' | 'tool_choice'> {
  tools?: CodeBuddyTool[];
  tool_choice?: "auto" | "none" | "required";
  search_parameters?: SearchParameters;
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

export interface ChatOptions {
  model?: string;
  temperature?: number;
  searchOptions?: SearchOptions;
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
  };
}

export class CodeBuddyClient {
  private client: OpenAI;
  private currentModel: string = "grok-code-fast-1";
  private defaultMaxTokens: number;
  private baseURL: string;
  private toolSupportProbed: boolean = false;
  private toolSupportDetected: boolean | null = null;
  private probePromise: Promise<boolean> | null = null;

  constructor(apiKey: string, model?: string, baseURL?: string) {
    // Validate API key
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('API key is required and must be a non-empty string');
    }
    if (apiKey.trim().length === 0) {
      throw new Error('API key cannot be empty or whitespace only');
    }

    // Validate baseURL if provided
    if (baseURL !== undefined && baseURL !== null) {
      if (typeof baseURL !== 'string') {
        throw new Error('Base URL must be a string');
      }
      if (baseURL.trim().length > 0 && !baseURL.match(/^https?:\/\//i)) {
        throw new Error('Base URL must start with http:// or https://');
      }
    }

    this.baseURL = baseURL || process.env.GROK_BASE_URL || "https://api.x.ai/v1";
    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
      timeout: 360000,
    });
    const envMax = Number(process.env.CODEBUDDY_MAX_TOKENS);
    this.defaultMaxTokens = Number.isFinite(envMax) && envMax > 0 ? envMax : 1536;
    if (model) {
      // Validate model type
      if (typeof model !== 'string') {
        throw new Error('Model name must be a string');
      }
      // Validate model (non-strict to allow custom models)
      validateModel(model, false);
      this.currentModel = model;

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
  async probeToolSupport(): Promise<boolean> {
    // Skip if already probed
    if (this.toolSupportProbed && this.toolSupportDetected !== null) {
      return this.toolSupportDetected;
    }

    // Return existing probe if already in progress (prevent race condition)
    if (this.probePromise) {
      return this.probePromise;
    }

    // Skip probe for known providers that support tools
    const modelInfo = getModelInfo(this.currentModel);
    if (['xai', 'anthropic', 'google', 'ollama'].includes(modelInfo.provider)) {
      this.toolSupportProbed = true;
      this.toolSupportDetected = true;
      return true;
    }

    // Skip probe if force tools is enabled
    if (process.env.GROK_FORCE_TOOLS === 'true') {
      this.toolSupportProbed = true;
      this.toolSupportDetected = true;
      return true;
    }

    // Check static list first (fast path)
    if (this.modelSupportsFunctionCalling()) {
      this.toolSupportProbed = true;
      this.toolSupportDetected = true;
      return true;
    }

    // Create and cache the probe promise to prevent concurrent probes
    this.probePromise = this.performToolProbe();
    return this.probePromise;
  }

  /**
   * Perform the actual tool support probe
   */
  private async performToolProbe(): Promise<boolean> {
    try {
      const testTool: CodeBuddyTool = {
        type: "function",
        function: {
          name: "get_current_time",
          description: "Get the current time",
          parameters: {
            type: "object",
            properties: {},
            required: [],
          },
        },
      };

      const response = await this.client.chat.completions.create({
        model: this.currentModel,
        messages: [{ role: "user", content: "What time is it? Use the get_current_time tool." }],
        tools: [testTool as unknown as OpenAI.ChatCompletionTool],
        tool_choice: "auto",
        max_tokens: 50,
      });

      // Check if response has valid choices
      if (!response.choices || response.choices.length === 0) {
        logger.warn("Tool support probe returned empty choices array");
        this.toolSupportProbed = true;
        this.toolSupportDetected = false;
        this.probePromise = null;
        return false;
      }

      // Check if the model attempted to use the tool
      const message = response.choices[0].message;
      const hasToolCall = !!(message?.tool_calls && message.tool_calls.length > 0);

      this.toolSupportProbed = true;
      this.toolSupportDetected = hasToolCall;
      this.probePromise = null;

      if (hasToolCall) {
        logger.debug("Tool support detected: model supports function calling");
      }

      return hasToolCall;
    } catch (_error) {
      // If the request fails (e.g., tools not supported), assume no tool support
      this.toolSupportProbed = true;
      this.toolSupportDetected = false;
      this.probePromise = null;
      return false;
    }
  }

  /**
   * Models known to support function calling / tool use
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

  /**
   * Check if the current model supports function calling based on its name
   */
  private modelSupportsFunctionCalling(): boolean {
    const modelLower = this.currentModel.toLowerCase();
    return CodeBuddyClient.FUNCTION_CALLING_MODELS.some(pattern =>
      modelLower.includes(pattern)
    );
  }

  /**
   * Check if using LM Studio or other local inference server
   * Can be overridden with GROK_FORCE_TOOLS=true for models that support function calling
   * Auto-enables tools for models known to support function calling
   */
  private isLocalInference(): boolean {
    // Allow forcing tools for local models that support function calling
    if (process.env.GROK_FORCE_TOOLS === 'true') {
      return false;
    }

    // Use probed result if available
    if (this.toolSupportProbed && this.toolSupportDetected === true) {
      return false; // Enable tools - probe detected support
    }

    // Auto-detect function calling support based on model name
    if (this.modelSupportsFunctionCalling()) {
      return false; // Enable tools for this model
    }

    const modelInfo = getModelInfo(this.currentModel);
    // Ollama supports tools via OpenAI-compatible API - always enable
    if (modelInfo.provider === 'ollama') return false;
    if (this.baseURL.includes('localhost:11434')) return false;
    if (this.baseURL.includes('127.0.0.1:11434')) return false;
    // Check if provider is lmstudio or if baseURL points to common local servers
    if (modelInfo.provider === 'lmstudio') return true;
    if (this.baseURL.includes('localhost:1234')) return true;
    if (this.baseURL.includes('127.0.0.1:1234')) return true;
    if (this.baseURL.match(/10\.\d+\.\d+\.\d+:1234/)) return true; // LAN IP with LM Studio port
    return false;
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
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  getBaseURL(): string {
    return this.baseURL;
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
    // Validate each message has required fields
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

    try {
      // Support both old signature (model as string) and new signature (options object)
      const opts: ChatOptions = typeof options === "string"
        ? { model: options, searchOptions }
        : options || {};

      // Disable tools for local inference (LM Studio) as they may not support function calling
      const useTools = !this.isLocalInference() && tools && tools.length > 0;

      const requestPayload: ChatRequestPayload = {
        model: opts.model || this.currentModel,
        messages,
        tools: useTools ? tools : [],
        tool_choice: useTools ? "auto" : undefined,
        temperature: opts.temperature ?? 0.7,
        max_tokens: this.defaultMaxTokens,
      };

      // Add search parameters if specified (skip for local inference)
      const searchOpts = opts.searchOptions || searchOptions;
      if (searchOpts?.search_parameters && !this.isLocalInference()) {
        requestPayload.search_parameters = searchOpts.search_parameters;
      }

      // Use retry with exponential backoff for API calls
      const response = await retry(
        async () => {
          return await this.client.chat.completions.create(
            requestPayload as unknown as ChatCompletionCreateParamsNonStreaming
          );
        },
        {
          ...RetryStrategies.llmApi,
          isRetryable: RetryPredicates.llmApiError,
          onRetry: (error, attempt, delay) => {
            logger.warn(`API call failed, retrying (attempt ${attempt}) in ${delay}ms...`, {
              source: 'CodeBuddyClient',
              error: error instanceof Error ? error.message : String(error),
            });
          },
        }
      );

      return response as unknown as CodeBuddyResponse;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`CodeBuddy API error: ${message}`);
    }
  }

  /**
   * Convert tool messages to user messages for models that don't support the tool role
   * LM Studio and some local models require this transformation
   */
  private convertToolMessagesForLocalModels(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
    // Check if we need conversion (has tool role messages and is using a local model)
    const hasToolMessages = messages.some((m: CodeBuddyMessage) => m.role === 'tool');
    if (!hasToolMessages) return messages;

    // Check if model uses local inference that might not support tool role
    const needsConversion = this.baseURL.includes(':1234') ||
                            this.baseURL.includes('lmstudio') ||
                            process.env.GROK_CONVERT_TOOL_MESSAGES === 'true';
    if (!needsConversion) return messages;

    return messages.map((msg: CodeBuddyMessage) => {
      if (msg.role === 'tool') {
        // Convert tool result to user message format
        return {
          role: 'user' as const,
          content: `[Tool Result]\n${msg.content}`,
        };
      }
      // Remove tool_calls from assistant messages for local models that don't support them in history
      if (hasToolCalls(msg)) {
        const toolCallsDesc = msg.tool_calls.map((tc: CodeBuddyToolCall) =>
          `Called ${tc.function.name}(${tc.function.arguments})`
        ).join('\n');
        return {
          role: 'assistant' as const,
          content: msg.content ? `${msg.content}\n\n[Tools Used]\n${toolCallsDesc}` : `[Tools Used]\n${toolCallsDesc}`,
        };
      }
      return msg;
    });
  }

  async *chatStream(
    messages: CodeBuddyMessage[],
    tools?: CodeBuddyTool[],
    options?: string | ChatOptions,
    searchOptions?: SearchOptions
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    try {
      // Support both old signature (model as string) and new signature (options object)
      const opts: ChatOptions = typeof options === "string"
        ? { model: options, searchOptions }
        : options || {};

      // Disable tools for local inference (LM Studio) as they may not support function calling
      const useTools = !this.isLocalInference() && tools && tools.length > 0;

      // Convert tool messages for local models that don't support tool role
      const processedMessages = this.convertToolMessagesForLocalModels(messages);

      const requestPayload = {
        model: opts.model || this.currentModel,
        messages: processedMessages,
        tools: useTools ? tools : [],
        tool_choice: useTools ? "auto" as const : undefined,
        temperature: opts.temperature ?? 0.7,
        max_tokens: this.defaultMaxTokens,
      };

      // Add search parameters if specified (skip for local inference)
      const searchOpts = opts.searchOptions || searchOptions;
      const searchParams = (searchOpts?.search_parameters && !this.isLocalInference())
        ? { search_parameters: searchOpts.search_parameters }
        : {};

      // Create streaming request payload
      const streamingPayload: ChatRequestPayloadStreaming = {
        ...requestPayload,
        ...searchParams,
        stream: true,
      };

      // Use retry with exponential backoff for stream initialization
      const stream = await retry(
        async () => {
          return await this.client.chat.completions.create(
            streamingPayload as unknown as ChatCompletionCreateParamsStreaming
          );
        },
        {
          ...RetryStrategies.llmApi,
          isRetryable: RetryPredicates.llmApiError,
          onRetry: (error, attempt, delay) => {
            logger.warn(`Stream initialization failed, retrying (attempt ${attempt}) in ${delay}ms...`, {
              source: 'CodeBuddyClient',
              error: error instanceof Error ? error.message : String(error),
            });
          },
        }
      );

      for await (const chunk of stream) {
        yield chunk;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`CodeBuddy API error: ${message}`);
    }
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
