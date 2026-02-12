/**
 * Grok Provider (xAI)
 *
 * LLM provider implementation for Grok API (xAI).
 * Uses the OpenAI SDK as xAI offers an OpenAI-compatible API.
 */

import { BaseProvider } from './base-provider.js';
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
 * Implementation of the xAI Grok provider.
 * Connects to the xAI API using the OpenAI client library (compatible API).
 */
export class GrokProvider extends BaseProvider {
  readonly type: ProviderType = 'grok';
  readonly name = 'Grok (xAI)';
  readonly defaultModel = 'grok-3-latest';

  private client: unknown = null;

  /**
   * Initializes the Grok provider.
   * Dynamically imports the OpenAI SDK to avoid heavy bundle size if not used.
   */
  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);

    // Dynamic import to avoid bundling OpenAI if not used
    const { default: OpenAI } = await import('openai');
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || 'https://api.x.ai/v1',
      timeout: config.timeout || 120000,
      maxRetries: config.maxRetries || 3,
    });
  }

  /**
   * Sends a completion request to the xAI API.
   * Maps internal types to OpenAI SDK types and normalizes the response.
   */
  async complete(options: CompletionOptions): Promise<LLMResponse> {
    if (!this.client || !this.config) {
      throw new Error('Grok provider not initialized. Call initialize() with a valid GROK_API_KEY before making requests.');
    }

    const openai = this.client as import('openai').default;
    const messages = this.formatMessages(options);

    const response = await openai.chat.completions.create({
      model: this.config.model || this.defaultModel,
      messages: messages as import('openai').OpenAI.ChatCompletionMessageParam[],
      tools: options.tools ? this.formatTools(options.tools) : undefined,
      temperature: options.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 16384,
    });

    const choice = response.choices?.[0];
    if (!choice?.message) {
      throw new Error('Grok API returned empty choices');
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
   * Streams the response from the xAI API.
   * Handles delta updates for content and tool calls.
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
      throw new Error('Grok provider not initialized. Call initialize() with a valid GROK_API_KEY before making requests.');
    }

    const openai = this.client as import('openai').default;
    const messages = this.formatMessages(options);

    const stream = await openai.chat.completions.create({
      model: this.config.model || this.defaultModel,
      messages: messages as import('openai').OpenAI.ChatCompletionMessageParam[],
      tools: options.tools ? this.formatTools(options.tools) : undefined,
      temperature: options.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 16384,
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
    return ['grok-3-latest', 'grok-3-fast', 'grok-2-latest', 'grok-2-vision-latest'];
  }

  getPricing(): { input: number; output: number } {
    // Grok pricing per 1M tokens
    return { input: 3, output: 15 };
  }

  supports(feature: ProviderFeature): boolean {
    switch (feature) {
      case 'vision':
        return this.config?.model?.includes('vision') || false;
      default:
        return super.supports(feature);
    }
  }

  /**
   * Formats internal messages to OpenAI format.
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
   * Formats internal tool definitions to OpenAI format.
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
