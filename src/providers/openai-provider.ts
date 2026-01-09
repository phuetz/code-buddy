/**
 * OpenAI Provider (GPT)
 *
 * LLM provider implementation for OpenAI API.
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

export class OpenAIProvider extends BaseProvider {
  readonly type: ProviderType = 'openai';
  readonly name = 'GPT (OpenAI)';
  readonly defaultModel = 'gpt-4o';

  private client: unknown = null;

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);

    const { default: OpenAI } = await import('openai');
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout || 120000,
      maxRetries: config.maxRetries || 3,
    });
  }

  async complete(options: CompletionOptions): Promise<LLMResponse> {
    if (!this.client || !this.config) {
      throw new Error('Provider not initialized');
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

    const choice = response.choices[0];
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

  async *stream(options: CompletionOptions): AsyncIterable<StreamChunk> {
    if (!this.client || !this.config) {
      throw new Error('Provider not initialized');
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
    // GPT-4o pricing per 1M tokens
    return { input: 2.5, output: 10 };
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
