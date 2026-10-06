import { getPricingPer1M } from '../config/model-pricing.js';

/**
 * OpenAI Provider (GPT)
 *
 * LLM provider implementation for OpenAI API.
 * Provides access to GPT-4o, GPT-4 Turbo, and O-series models.
 */

import { BaseProvider } from './base-provider.js';
import { getChatGptAuth } from './codex-oauth.js';
import { logger } from '../utils/logger.js';
import type {
  ProviderType,
  ProviderConfig,
  CompletionOptions,
  LLMResponse,
  StreamChunk,
  ToolCall,
  ToolDefinition,
  ProviderFeature,
} from './types.js';

/**
 * Implementation of the OpenAI provider.
 * Uses the official OpenAI SDK.
 */
export class OpenAIProvider extends BaseProvider {
  readonly type: ProviderType = 'openai';
  readonly name = 'GPT (OpenAI)';
  readonly defaultModel = 'gpt-4o';

  private client: unknown = null;

  /**
   * Initializes the OpenAI provider.
   * Dynamically imports the OpenAI SDK.
   */
  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);

    let apiKey = config.apiKey;
    if (apiKey === 'oauth' || !apiKey) {
      // ChatGPT subscription auth fallback. NOTE: this points the OAuth
      // token at api.openai.com/v1/chat/completions, which the Codex
      // bearer token does NOT grant access to. For real ChatGPT-quota
      // chat usage, route via baseURL `chatgpt.com/backend-api/codex`
      // (the CodeBuddyClient picks ChatGptResponsesProvider when it sees
      // that baseURL or the `oauth-chatgpt` apiKey sentinel).
      //
      // This branch is kept for back-compat with consumers that still
      // expect a string token in the OpenAI SDK shape (e.g. the legacy
      // BaseProvider chain pre Phase d.23).
      const auth = await getChatGptAuth();
      if (auth?.access_token) {
        apiKey = auth.access_token;
      } else {
        logger.warn(
          'OpenAIProvider: apiKey="oauth" requested but no ChatGPT credentials found. ' +
            'Run `/login chatgpt` (or use ChatGptResponsesProvider directly via baseURL=chatgpt.com/backend-api/codex).',
        );
      }
    }

    const { default: OpenAI } = await import('openai');
    this.client = new OpenAI({
      apiKey: apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout || 120000,
      maxRetries: config.maxRetries || 3,
    });
  }

  /**
   * Sends a completion request to the OpenAI API.
   * Standardizes tool calls and finish reasons.
   */
  async complete(options: CompletionOptions): Promise<LLMResponse> {
    if (!this.client || !this.config) {
      throw new Error('OpenAI provider not initialized. Call initialize() with a valid API key before making requests.');
    }

    const openai = this.client as import('openai').default;
    const messages = this.formatMessages(options);

    const response = await openai.chat.completions.create({
      model: this.config.model || this.defaultModel,
      messages: messages as import('openai').OpenAI.ChatCompletionMessageParam[],
      tools: options.tools ? this.formatTools(options.tools) : undefined,
      temperature: options.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
    });

    const choice = response.choices?.[0];
    if (!choice?.message) {
      throw new Error('OpenAI API returned empty choices');
    }
    return {
      id: response.id,
      content: choice.message.content,
      toolCalls: (choice.message.tool_calls || []).map(tc => {
        // Handle both standard and custom tool call formats
        const func = 'function' in tc ? tc.function : { name: '', arguments: '' };
        return {
          id: tc.id,
          type: 'function' as const,
          function: {
            name: func.name,
            arguments: func.arguments,
          },
        };
      }),
      finishReason: choice.finish_reason as LLMResponse['finishReason'],
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      model: response.model,
      provider: this.type,
    };
  }

  /**
   * Streams the response from the OpenAI API.
   * Handles accumulating tool calls (which are streamed in parts).
   * Wrapped with latency tracking for first-token and total streaming time.
   */
  async *stream(options: CompletionOptions): AsyncIterable<StreamChunk> {
    yield* this.trackStreamLatency(this.streamInternal(options));
  }

  /**
   * Internal streaming implementation.
   */
  private async *streamInternal(options: CompletionOptions): AsyncIterable<StreamChunk> {
    if (!this.client || !this.config) {
      throw new Error('OpenAI provider not initialized. Call initialize() with a valid API key before making requests.');
    }

    const openai = this.client as import('openai').default;
    const messages = this.formatMessages(options);

    const stream = await openai.chat.completions.create({
      model: this.config.model || this.defaultModel,
      messages: messages as import('openai').OpenAI.ChatCompletionMessageParam[],
      tools: options.tools ? this.formatTools(options.tools) : undefined,
      temperature: options.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
      stream: true,
    });

    const toolCalls: Map<number, ToolCall> = new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        yield { type: 'content', content: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls.get(tc.index) || {
            id: tc.id || '',
            type: 'function' as const,
            function: { name: '', arguments: '' },
          };

          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.function.name += tc.function.name;
          if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;

          toolCalls.set(tc.index, existing);
          yield { type: 'tool_call', toolCall: existing };
        }
      }

      if (chunk.choices[0]?.finish_reason) {
        yield { type: 'done' };
      }
    }
  }

  async getModels(): Promise<string[]> {
    return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'];
  }

  getPricing(): { input: number; output: number } {
    return getPricingPer1M(this.config?.model ?? this.defaultModel);
  }

  supports(feature: ProviderFeature): boolean {
    switch (feature) {
      case 'vision':
        return true; // GPT-4o supports vision
      case 'json_mode':
        return true;
      default:
        return super.supports(feature);
    }
  }

  /**
   * Formats internal messages to OpenAI's ChatCompletionMessageParam.
   */
  private formatMessages(options: CompletionOptions): Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  }> {
    const messages: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string | null;
      name?: string;
      tool_call_id?: string;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    }> = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }

    for (const msg of options.messages) {
      messages.push({
        role: msg.role,
        content: msg.content,
        name: msg.name,
        tool_call_id: msg.tool_call_id,
        tool_calls: msg.tool_calls,
      });
    }

    return messages;
  }

  /**
   * Formats tool definitions for OpenAI.
   */
  private formatTools(tools: ToolDefinition[]): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}
