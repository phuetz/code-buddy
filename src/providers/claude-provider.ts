/**
 * Claude Provider (Anthropic)
 *
 * LLM provider implementation for Claude API.
 */

import { BaseLLMProvider } from './base-provider.js';
import type {
  ProviderType,
  ProviderConfig,
  CompletionOptions,
  LLMResponse,
  StreamChunk,
  ToolCall,
  ToolDefinition,
  AnthropicResponse,
  AnthropicStreamEvent,
} from './types.js';

export class ClaudeProvider extends BaseLLMProvider {
  readonly type: ProviderType = 'claude';
  readonly name = 'Claude (Anthropic)';
  readonly defaultModel = 'claude-sonnet-4-20250514';

  private client: unknown = null;

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);

    // Dynamic import - SDK is optional
    try {
      // @ts-expect-error - Optional dependency may not be installed
      const module = await import('@anthropic-ai/sdk');
      const Anthropic = module.default;
      this.client = new Anthropic({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: config.timeout || 120000,
        maxRetries: config.maxRetries || 3,
      });
    } catch {
      throw new Error('Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk');
    }
  }

  async complete(options: CompletionOptions): Promise<LLMResponse> {
    if (!this.client || !this.config) {
      throw new Error('Provider not initialized');
    }

    // Client is typed as unknown, cast to expected interface
    const anthropic = this.client as { messages: { create: (params: unknown) => Promise<AnthropicResponse> } };
    const { system, messages } = this.formatMessages(options);

    const response = await anthropic.messages.create({
      model: this.config.model || this.defaultModel,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 8192,
      system,
      messages,
      tools: options.tools ? this.formatTools(options.tools) : undefined,
    });

    const toolCalls: ToolCall[] = [];
    let content = '';

    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        content += block.text;
      } else if (block.type === 'tool_use' && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    return {
      id: response.id,
      content: content || null,
      toolCalls,
      finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      model: response.model,
      provider: this.type,
    };
  }

  async *stream(options: CompletionOptions): AsyncIterable<StreamChunk> {
    if (!this.client || !this.config) {
      throw new Error('Provider not initialized');
    }

    // Client is typed as unknown, cast to expected interface
    const anthropic = this.client as { messages: { stream: (params: unknown) => AsyncIterable<AnthropicStreamEvent> } };
    const { system, messages } = this.formatMessages(options);

    const stream = anthropic.messages.stream({
      model: this.config.model || this.defaultModel,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 8192,
      system,
      messages,
      tools: options.tools ? this.formatTools(options.tools) : undefined,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta) {
        const delta = event.delta;
        if (delta.type === 'text_delta' && delta.text) {
          yield { type: 'content', content: delta.text };
        } else if (delta.type === 'input_json_delta' && delta.partial_json) {
          yield { type: 'tool_call', toolCall: { function: { arguments: delta.partial_json, name: '' } } };
        }
      } else if (event.type === 'message_stop') {
        yield { type: 'done' };
      }
    }
  }

  async getModels(): Promise<string[]> {
    return [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ];
  }

  getPricing(): { input: number; output: number } {
    // Claude Sonnet 4 pricing per 1M tokens
    return { input: 3, output: 15 };
  }

  private formatMessages(options: CompletionOptions): {
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string | Array<{ type: string; tool_use_id?: string; content?: string; text?: string }> }>;
  } {
    let system = options.systemPrompt || '';
    const messages: Array<{ role: 'user' | 'assistant'; content: string | Array<{ type: string; tool_use_id?: string; content?: string; text?: string }> }> = [];

    for (const msg of options.messages) {
      if (msg.role === 'system') {
        system += (system ? '\n\n' : '') + msg.content;
      } else if (msg.role === 'tool') {
        // Tool results go as user messages in Claude
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: msg.content,
            },
          ],
        });
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        // Assistant with tool calls
        const content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          let input: unknown = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            // Invalid JSON in tool arguments - use empty object
            input = {};
          }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
        messages.push({ role: 'assistant', content: content as Array<{ type: string }> });
      } else {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    return { system, messages };
  }

  private formatTools(tools: ToolDefinition[]): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
}
