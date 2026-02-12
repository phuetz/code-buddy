/**
 * Gemini Provider (Google)
 *
 * LLM provider implementation for Google Gemini API.
 */

import { BaseProvider } from './base-provider.js';
import type {
  ProviderType,
  ProviderConfig,
  CompletionOptions,
  LLMResponse,
  StreamChunk,
  ToolCall,
  ProviderFeature,
  LLMMessage,
} from './types.js';
import { retry, RetryStrategies, RetryPredicates } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

/**
 * Implementation of the Google Gemini provider.
 * Uses `fetch` to interact with the REST API directly, avoiding the need for heavy SDKs.
 */
// Keywords that indicate the user needs real-time information (tools required)
const TOOL_TRIGGER_KEYWORDS = [
  // News & current events
  'actualités', 'actualité', 'news', 'nouvelles',
  // TV & entertainment
  'programme tv', 'télé ce soir', 'france 2', 'tf1', 'émission',
  // Weather
  'météo', 'temps qu\'il fait', 'temperature', 'température',
  // Time-sensitive
  'aujourd\'hui', 'ce soir', 'demain', 'cette semaine',
  // Prices & availability
  'prix de', 'coût de', 'combien coûte', 'tarif',
  // Search queries
  'cherche', 'recherche', 'trouve', 'où trouver',
];

export class GeminiProvider extends BaseProvider {
  readonly type: ProviderType = 'gemini';
  readonly name = 'Gemini (Google)';
  readonly defaultModel = 'gemini-2.5-flash';

  private client: unknown = null;

  /**
   * Initializes the Gemini provider.
   * Sets up the API configuration.
   */
  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);

    // Gemini uses REST API directly or google-generativeai SDK
    // For simplicity, we'll use fetch with the REST API
    this.client = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta',
      model: config.model || this.defaultModel,
    };
  }

  /**
   * Sends a completion request to the Gemini REST API.
   * Transforms the request to Gemini's specific JSON format.
   * Maps response candidates and tool calls back to standard types.
   */
  async complete(options: CompletionOptions): Promise<LLMResponse> {
    if (!this.client || !this.config) {
      throw new Error('Gemini provider not initialized. Call initialize() with a valid GOOGLE_API_KEY before making requests.');
    }

    const client = this.client as { apiKey: string; baseUrl: string; model: string };
    const model = this.config.model || this.defaultModel;
    const url = `${client.baseUrl}/models/${model}:generateContent?key=${client.apiKey}`;

    const body = this.formatRequest(options);

    // Log request details for debugging tool calling
    logger.debug('Gemini API request', {
      source: 'GeminiProvider',
      model,
      contentsCount: (body.contents as unknown[])?.length ?? 0,
      hasTools: !!body.tools,
      toolCount: (body.tools as unknown[])?.length > 0 ? ((body.tools as Array<{ functionDeclarations?: unknown[] }>)[0]?.functionDeclarations?.length ?? 0) : 0,
      toolConfigMode: (body.toolConfig as { functionCallingConfig?: { mode?: string } })?.functionCallingConfig?.mode ?? 'none',
      systemPromptLength: (body.systemInstruction as { parts?: Array<{ text?: string }> })?.parts?.[0]?.text?.length ?? 0,
    });

    // Use retry with exponential backoff for API calls
    const response = await retry(
      async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const error = new Error(`Gemini API request failed with status ${res.status}. ${res.status === 401 ? 'Check your GOOGLE_API_KEY.' : res.status === 403 ? 'API access forbidden - verify your API key permissions.' : res.status === 429 ? 'Rate limit exceeded, please try again later.' : res.statusText}`);
          (error as Error & { status: number }).status = res.status;
          throw error;
        }

        return res;
      },
      {
        ...RetryStrategies.llmApi,
        isRetryable: RetryPredicates.llmApiError,
        onRetry: (error, attempt, delay) => {
          logger.warn(`Gemini API call failed, retrying (attempt ${attempt}) in ${delay}ms...`, {
            source: 'GeminiProvider',
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

    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts) {
      throw new Error('Gemini API returned empty candidates');
    }
    const toolCalls: ToolCall[] = [];
    let content = '';

    for (const part of candidate.content.parts) {
      if (part.text) {
        content += part.text;
      } else if (part.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
        });
      }
    }

    // Log response details for debugging tool calling
    logger.debug('Gemini API response', {
      source: 'GeminiProvider',
      hasFunctionCall: toolCalls.length > 0,
      toolCallCount: toolCalls.length,
      toolNames: toolCalls.map(tc => tc.function.name),
      finishReason: candidate.finishReason,
      textPreview: content ? content.slice(0, 100) + (content.length > 100 ? '...' : '') : null,
      promptTokens: data.usageMetadata?.promptTokenCount || 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
    });

    return {
      id: `gemini_${Date.now()}`,
      content: content || null,
      toolCalls,
      finishReason: candidate.finishReason === 'STOP' ? 'stop' : 'tool_calls',
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
      model,
      provider: this.type,
    };
  }

  /**
   * Streams the response from the Gemini REST API via SSE (Server-Sent Events).
   * Decodes the chunked JSON response and maps it to standard StreamChunks. *
   */
  async *stream(options: CompletionOptions): AsyncIterable<StreamChunk> {
    yield* this.trackStreamLatency(this.streamInternal(options));
  }

  /**
   * Internal streaming implementation.
   */
  private async *streamInternal(options: CompletionOptions): AsyncIterable<StreamChunk> {
    if (!this.client || !this.config) {
      throw new Error('Gemini provider not initialized. Call initialize() with a valid GOOGLE_API_KEY before making requests.');
    }

    const client = this.client as { apiKey: string; baseUrl: string; model: string };
    const model = this.config.model || this.defaultModel;
    const url = `${client.baseUrl}/models/${model}:streamGenerateContent?key=${client.apiKey}&alt=sse`;

    const body = this.formatRequest(options);

    // Use retry with exponential backoff for stream initialization
    const response = await retry(
      async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const error = new Error(`Gemini API request failed with status ${res.status}. ${res.status === 401 ? 'Check your GOOGLE_API_KEY.' : res.status === 403 ? 'API access forbidden - verify your API key permissions.' : res.status === 429 ? 'Rate limit exceeded, please try again later.' : res.statusText}`);
          (error as Error & { status: number }).status = res.status;
          throw error;
        }

        return res;
      },
      {
        ...RetryStrategies.llmApi,
        isRetryable: RetryPredicates.llmApiError,
        onRetry: (error, attempt, delay) => {
          logger.warn(`Gemini stream initialization failed, retrying (attempt ${attempt}) in ${delay}ms...`, {
            source: 'GeminiProvider',
            error: error instanceof Error ? error.message : String(error),
          });
        },
      }
    );

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Gemini API returned empty response body. The request may have been interrupted or the service is unavailable.');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            if (jsonStr === '[DONE]') {
              yield { type: 'done' };
              continue;
            }

            try {
              const data = JSON.parse(jsonStr) as {
                candidates?: Array<{
                  content?: {
                    parts?: Array<{ text?: string; functionCall?: { name: string; args: unknown } }>;
                  };
                }>;
              };
              const parts = data.candidates?.[0]?.content?.parts || [];

              for (const part of parts) {
                if (part.text) {
                  yield { type: 'content', content: part.text };
                } else if (part.functionCall) {
                  yield {
                    type: 'tool_call',
                    toolCall: {
                      id: `call_${Date.now()}`,
                      type: 'function',
                      function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args),
                      },
                    },
                  };
                }
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Returns a list of supported Gemini models.
   */
  async getModels(): Promise<string[]> {
    return [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
      'gemini-2.0-flash-thinking',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ];
  }

  /**
   * Returns the pricing information for the Gemini 2.0 Flash model.
   * Pricing is per 1M tokens.
   */
  getPricing(): { input: number; output: number } {
    // Gemini 2.0 Flash pricing per 1M tokens
    return { input: 0.075, output: 0.30 };
  }

  /**
   * Checks if the Gemini provider supports a given feature.
   * Gemini supports 'vision' (multimodal) and 'json_mode'.
   */
  supports(feature: ProviderFeature): boolean {
    switch (feature) {
      case 'vision':
        return true; // Gemini is multimodal
      case 'json_mode':
        return true;
      default:
        return super.supports(feature);
    }
  }

  /**
   * Formats the request body for Gemini API.
   * - Maps roles (assistant -> model).
   * - Structures tool calls as functionResponse parts.
   * - Sets generation config.
   */
  private formatRequest(options: CompletionOptions): Record<string, unknown> {
    const contents: Array<{ role: string; parts: Array<{ text?: string; functionResponse?: { name: string; response: unknown } }> }> = [];

    // Add system instruction if provided
    const systemInstruction = options.systemPrompt
      ? { parts: [{ text: options.systemPrompt }] }
      : undefined;

    // Convert messages
    for (const msg of options.messages) {
      if (msg.role === 'system') {
        // System messages are handled via systemInstruction
        continue;
      }

      const role = msg.role === 'assistant' ? 'model' : 'user';

      if (msg.role === 'tool') {
        // Gemini expects functionResponse with { name, content } structure
        contents.push({
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: msg.name || 'unknown',
                response: {
                  name: msg.name || 'unknown',
                  content: msg.content,
                },
              },
            },
          ],
        });
      } else {
        contents.push({
          role,
          parts: [{ text: msg.content }],
        });
      }
    }

    const request: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? this.config?.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? this.config?.maxTokens ?? 8192,
      },
    };

    if (systemInstruction) {
      request.systemInstruction = systemInstruction;
    }

    if (options.tools && options.tools.length > 0) {
      // Convert parameter types to UPPERCASE as required by Gemini API
      request.tools = [
        {
          functionDeclarations: options.tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: this.convertParameterTypes(tool.parameters),
          })),
        },
      ];

      // Determine tool calling mode:
      // - ANY: Force tool use (first iteration when query needs tools)
      // - AUTO: Let Gemini decide (subsequent iterations or normal queries)
      const isFirstIteration = (options.toolCallIteration ?? 0) === 0;
      const shouldForce = options.forceToolUse || (isFirstIteration && this.shouldForceToolUse(options.messages));

      request.toolConfig = {
        functionCallingConfig: {
          mode: shouldForce ? 'ANY' : 'AUTO',
        },
      };

      logger.debug('Gemini tool config', {
        source: 'GeminiProvider',
        mode: shouldForce ? 'ANY' : 'AUTO',
        forceToolUse: options.forceToolUse,
        isFirstIteration,
        toolCount: options.tools.length,
      });
    }

    return request;
  }

  /**
   * Detects if the user's query requires tool use (real-time information).
   * Returns true for queries about news, weather, TV, prices, etc.
   */
  private shouldForceToolUse(messages: LLMMessage[]): boolean {
    // Get the last user message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    if (!lastUserMessage) return false;

    const content = lastUserMessage.content.toLowerCase();
    return TOOL_TRIGGER_KEYWORDS.some(trigger => content.includes(trigger));
  }

  /**
   * Converts parameter types to UPPERCASE as required by Gemini API.
   * Example: { type: 'string' } -> { type: 'STRING' }
   */
  private convertParameterTypes(parameters: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(parameters)) {
      if (key === 'type' && typeof value === 'string') {
        result[key] = value.toUpperCase();
      } else if (key === 'properties' && typeof value === 'object' && value !== null) {
        const properties: Record<string, unknown> = {};
        for (const [propKey, propValue] of Object.entries(value as Record<string, unknown>)) {
          if (typeof propValue === 'object' && propValue !== null) {
            properties[propKey] = this.convertParameterTypes(propValue as Record<string, unknown>);
          } else {
            properties[propKey] = propValue;
          }
        }
        result[key] = properties;
      } else if (key === 'items' && typeof value === 'object' && value !== null) {
        result[key] = this.convertParameterTypes(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}
