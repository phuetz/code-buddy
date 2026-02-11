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
  private client: OpenAI | null;
  private currentModel: string = "grok-code-fast-1";
  private defaultMaxTokens: number;
  private baseURL: string;
  private apiKey: string;
  private toolSupportProbed: boolean = false;
  private toolSupportDetected: boolean | null = null;
  private probePromise: Promise<boolean> | null = null;
  private isGeminiProvider: boolean = false;

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
    this.apiKey = apiKey;

    // Detect Gemini provider
    this.isGeminiProvider = this.baseURL.includes('generativelanguage.googleapis.com');

    // Only create OpenAI client for non-Gemini providers
    if (!this.isGeminiProvider) {
      this.client = new OpenAI({
        apiKey,
        baseURL: this.baseURL,
        timeout: 360000,
      });
    } else {
      // Gemini uses native API, no OpenAI client needed
      this.client = null;
      logger.info('Using native Gemini API');
    }
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

      const response = await this.client!.chat.completions.create({
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
    if (this.baseURL.match(/172\.\d+\.\d+\.\d+:1234/)) return true; // WSL/Docker IP with LM Studio port
    if (this.baseURL.match(/192\.168\.\d+\.\d+:1234/)) return true; // Private network with LM Studio port
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

  /**
   * Check if using Gemini provider
   */
  isGemini(): boolean {
    return this.isGeminiProvider;
  }

  /**
   * Gemini-specific chat implementation
   */
  private async geminiChat(
    messages: CodeBuddyMessage[],
    tools?: CodeBuddyTool[],
    opts?: ChatOptions
  ): Promise<CodeBuddyResponse> {
    const model = opts?.model || this.currentModel;
    const url = `${this.baseURL}/models/${model}:generateContent?key=${this.apiKey}`;

    // Convert messages to Gemini format
    const contents: Array<{
      role: string;
      parts: Array<{ text?: string; functionResponse?: { name: string; response: unknown }; inlineData?: { mimeType: string; data: string } }>;
    }> = [];

    let systemInstruction: { parts: Array<{ text: string }> } | undefined;

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Gemini uses systemInstruction instead of system message
        systemInstruction = { parts: [{ text: String(msg.content) }] };
      } else if (msg.role === 'user') {
        const parts = this.convertContentToGeminiParts(msg.content);
        contents.push({ role: 'user', parts });
      } else if (msg.role === 'assistant') {
        const assistantMsg = msg as { content?: string | null; tool_calls?: CodeBuddyToolCall[] };
        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
          // Assistant with tool calls
          const parts: Array<{ functionCall?: { name: string; args: unknown }; text?: string }> = [];
          if (assistantMsg.content) {
            parts.push({ text: assistantMsg.content });
          }
          for (const tc of assistantMsg.tool_calls) {
            parts.push({
              functionCall: {
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments),
              },
            });
          }
          contents.push({ role: 'model', parts: parts as Array<{ text?: string; functionResponse?: { name: string; response: unknown } }> });
        } else {
          contents.push({
            role: 'model',
            parts: [{ text: String(msg.content || '') }],
          });
        }
      } else if (msg.role === 'tool') {
        const toolMsg = msg as { tool_call_id?: string; name?: string; content?: string };
        const functionName = toolMsg.name || toolMsg.tool_call_id || 'unknown';

        logger.debug('Adding functionResponse to Gemini request', {
          source: 'CodeBuddyClient',
          functionName,
          hasName: !!toolMsg.name,
          toolCallId: toolMsg.tool_call_id,
          contentLength: toolMsg.content?.length || 0,
        });

        const part = {
          functionResponse: {
            name: functionName,
            response: { result: toolMsg.content },
          },
        };
        // Merge consecutive tool results into a single 'function' turn
        // (Gemini requires strict role alternation)
        const lastContent = contents[contents.length - 1];
        if (lastContent && lastContent.role === 'function') {
          lastContent.parts.push(part);
        } else {
          contents.push({ role: 'function', parts: [part] });
        }
      }
    }

    // Build request body
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: opts?.temperature ?? 0.7,
        maxOutputTokens: this.defaultMaxTokens,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    // Add tools if provided
    if (tools && tools.length > 0) {
      const functionDeclarations = tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: this.sanitizeSchemaForGemini(tool.function.parameters),
      }));
      body.tools = [{ functionDeclarations }];
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };

      // Log first tool's sanitized schema for debugging
      if (functionDeclarations.length > 0) {
        logger.debug('Gemini tool schema sample (first tool)', {
          source: 'CodeBuddyClient',
          toolName: functionDeclarations[0].name,
          parametersType: (functionDeclarations[0].parameters as Record<string, unknown>)?.type,
        });
      }
    }

    // Log request for debugging
    logger.debug('Gemini request', {
      source: 'CodeBuddyClient',
      model: opts?.model || this.currentModel,
      contentsCount: contents.length,
      hasTools: !!(tools && tools.length > 0),
      toolCount: tools?.length || 0,
      toolNames: tools?.slice(0, 10).map(t => t.function.name).join(', ') || 'none',
    });

    // Make request with retry
    const response = await retry(
      async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errorText = await res.text();
          logger.error('Gemini API error', {
            source: 'CodeBuddyClient',
            status: res.status,
            statusText: res.statusText,
            errorBody: errorText?.substring(0, 500),
          });
          throw new Error(`${res.status} ${errorText || res.statusText}`);
        }

        return res;
      },
      {
        ...RetryStrategies.llmApi,
        isRetryable: RetryPredicates.llmApiError,
        onRetry: (error, attempt, delay) => {
          logger.warn(`Gemini API call failed, retrying (attempt ${attempt}) in ${delay}ms...`, {
            source: 'CodeBuddyClient',
            error: error instanceof Error ? error.message : String(error),
          });
        },
      }
    );

    const data = await response.json() as {
      candidates: Array<{
        content: {
          parts: Array<{ text?: string; functionCall?: { name: string; args: unknown } }>;
        };
        finishReason: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    // Convert response to CodeBuddy format
    const candidate = data.candidates?.[0];
    if (!candidate || !candidate.content) {
      logger.error('Gemini response missing candidate or content', {
        source: 'CodeBuddyClient',
        hasCandidates: !!data.candidates,
        candidatesLength: data.candidates?.length,
        rawResponse: JSON.stringify(data).substring(0, 500),
      });
      throw new Error('Invalid Gemini response: missing candidate content');
    }

    // Handle empty content (Gemini may return content without parts for certain queries)
    if (!candidate.content.parts || candidate.content.parts.length === 0) {
      logger.warn('Gemini returned empty content parts', {
        source: 'CodeBuddyClient',
        finishReason: candidate.finishReason,
      });
      // Return a graceful response instead of throwing
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: "Je ne peux pas répondre à cette question. Il s'agit peut-être d'une requête nécessitant des données en temps réel (météo, actualités) auxquelles je n'ai pas accès, ou d'une question que le modèle ne peut pas traiter.",
            tool_calls: undefined,
          },
          finish_reason: candidate.finishReason || 'stop',
        }],
        usage: {
          prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
          completion_tokens: 0,
          total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
        },
      };
    }

    const toolCalls: CodeBuddyToolCall[] = [];
    let content = '';

    for (const part of candidate.content.parts) {
      if (part.text) {
        content += part.text;
      } else if (part.functionCall) {
        const toolCall = {
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          type: 'function' as const,
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
        };
        toolCalls.push(toolCall);
        logger.debug('Gemini tool call extracted', {
          source: 'CodeBuddyClient',
          toolName: part.functionCall.name,
          args: JSON.stringify(part.functionCall.args).substring(0, 200),
        });
      }
    }

    // Log response summary
    logger.debug('Gemini response parsed', {
      source: 'CodeBuddyClient',
      hasContent: !!content,
      contentLength: content.length,
      toolCallCount: toolCalls.length,
      finishReason: candidate.finishReason,
    });

    return {
      choices: [{
        message: {
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: candidate.finishReason === 'STOP' ? 'stop' : candidate.finishReason.toLowerCase(),
      }],
      usage: data.usageMetadata ? {
        prompt_tokens: data.usageMetadata.promptTokenCount || 0,
        completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata.totalTokenCount || 0,
      } : undefined,
    };
  }

  private convertContentToGeminiParts(
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null | undefined
  ): Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> {
    if (!content) {
      return [{ text: '' }];
    }
    if (typeof content === 'string') {
      return [{ text: content }];
    }
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
    for (const part of content) {
      if (part.type === 'text' && part.text) {
        parts.push({ text: part.text });
      } else if (part.type === 'image_url' && part.image_url) {
        const { mimeType, data } = this.parseDataUrl(part.image_url.url);
        parts.push({ inlineData: { mimeType, data } });
      }
    }
    return parts.length > 0 ? parts : [{ text: '' }];
  }

  private parseDataUrl(url: string): { mimeType: string; data: string } {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { mimeType: match[1], data: match[2] };
    }
    return { mimeType: 'image/png', data: url };
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

      // Route to Gemini if using Gemini provider
      if (this.isGeminiProvider) {
        return await this.geminiChat(messages, tools, opts);
      }

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
          return await this.client!.chat.completions.create(
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
   * Gemini type mapping: lowercase OpenAI types to uppercase Gemini types
   */
  private static readonly GEMINI_TYPE_MAP: Record<string, string> = {
    'string': 'STRING',
    'number': 'NUMBER',
    'integer': 'INTEGER',
    'boolean': 'BOOLEAN',
    'array': 'ARRAY',
    'object': 'OBJECT',
  };

  /**
   * Sanitize JSON Schema for Gemini API compatibility
   * - Converts lowercase types to uppercase (string -> STRING, object -> OBJECT)
   * - Ensures all array types have 'items' defined
   */
  private sanitizeSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    const result: Record<string, unknown> = { ...schema };

    // Convert lowercase type to uppercase for Gemini
    if (typeof result.type === 'string') {
      const upperType = CodeBuddyClient.GEMINI_TYPE_MAP[result.type.toLowerCase()];
      if (upperType) {
        result.type = upperType;
      }
    }

    // If this is an array type without items, add default items (use uppercase for Gemini)
    if (result.type === 'ARRAY' && !result.items) {
      result.items = { type: 'OBJECT' };
      logger.debug('Added missing items to array schema', {
        source: 'CodeBuddyClient',
      });
    }

    // Recursively sanitize properties
    if (result.properties && typeof result.properties === 'object') {
      const props = result.properties as Record<string, Record<string, unknown>>;
      const sanitizedProps: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        sanitizedProps[key] = this.sanitizeSchemaForGemini(value);
      }
      result.properties = sanitizedProps;
    }

    // Recursively sanitize items if present
    if (result.items && typeof result.items === 'object') {
      result.items = this.sanitizeSchemaForGemini(result.items as Record<string, unknown>);
    }

    // Recursively sanitize enum values (keep as-is, just ensure array items are sanitized)
    if (result.enum && Array.isArray(result.enum)) {
      // Enum values stay as-is (they're string values, not types)
    }

    return result;
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

  /**
   * Gemini-specific streaming (falls back to non-streaming for simplicity)
   */
  private async *geminiChatStream(
    messages: CodeBuddyMessage[],
    tools?: CodeBuddyTool[],
    opts?: ChatOptions
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    // For Gemini, use non-streaming and emit as single chunk
    // TODO: Implement proper streaming with streamGenerateContent API
    const response = await this.geminiChat(messages, tools, opts);

    const choice = response.choices[0];

    // Emit content chunk
    if (choice.message.content) {
      yield {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk' as const,
        created: Math.floor(Date.now() / 1000),
        model: opts?.model || this.currentModel,
        choices: [{
          index: 0,
          delta: {
            role: 'assistant' as const,
            content: choice.message.content,
          },
          finish_reason: null,
        }],
      };
    }

    // Emit tool calls if present
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      for (const toolCall of choice.message.tool_calls) {
        yield {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk' as const,
          created: Math.floor(Date.now() / 1000),
          model: opts?.model || this.currentModel,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: toolCall.id,
                type: 'function' as const,
                function: {
                  name: toolCall.function.name,
                  arguments: toolCall.function.arguments,
                },
              }],
            },
            finish_reason: null,
          }],
        };
      }
    }

    // Final chunk with finish_reason
    yield {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk' as const,
      created: Math.floor(Date.now() / 1000),
      model: opts?.model || this.currentModel,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: choice.finish_reason as 'stop' | 'tool_calls' | 'length' | 'content_filter' | null,
      }],
    };
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

      // Route to Gemini if using Gemini provider
      if (this.isGeminiProvider) {
        yield* this.geminiChatStream(messages, tools, opts);
        return;
      }

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
          return await this.client!.chat.completions.create(
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
