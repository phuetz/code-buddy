/**
 * Claude Provider (Anthropic)
 *
 * LLM provider implementation for Claude API.
 * Handles interaction with Anthropic's Claude 3/3.5 models.
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
  AnthropicResponse,
  AnthropicStreamEvent,
  ProviderFeature,
} from './types.js';

/**
 * Implementation of the Anthropic Claude provider.
 * Uses the @anthropic-ai/sdk for API communication.
 * Handles specifics like:
 * - Tool use integration (beta)
 * - Message formatting (system prompts separate from messages)
 * - Streaming delta handling
 */
export class ClaudeProvider extends BaseProvider {
  readonly type: ProviderType = 'claude';
  readonly name = 'Claude (Anthropic)';
  readonly defaultModel = 'claude-sonnet-4-20250514';

  private client: unknown = null;

  /**
   * Initializes the Claude provider.
   * Dynamically imports the Anthropic SDK.
   *
   * @throws Error if @anthropic-ai/sdk is not installed.
   */
  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);

    // Dynamic import - SDK is optional
    try {
      const module = await import('@anthropic-ai/sdk');
      const Anthropic = module.default;
      this.client = new Anthropic({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: config.timeout || 120000,
        maxRetries: config.maxRetries || 3,
      });
    } catch {
      throw new Error('Anthropic SDK not installed. To use Claude, install the SDK with: npm install @anthropic-ai/sdk');
    }
  }

  /**
   * Sends a completion request to the Anthropic API.
   * Handles separating system prompt from standard messages.
   * Maps tool use blocks to standard ToolCall objects.
   */
  async complete(options: CompletionOptions): Promise<LLMResponse> {
    if (!this.client || !this.config) {
      throw new Error('Claude provider not initialized. Call initialize() with a valid ANTHROPIC_API_KEY before making requests.');
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

  /**
   * Streams the response from the Anthropic API.
   * Handles 'content_block_delta' events for both text and JSON (tool args).
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
      throw new Error('Claude provider not initialized. Call initialize() with a valid ANTHROPIC_API_KEY before making requests.');
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

  supports(feature: ProviderFeature): boolean {
    switch (feature) {
      case 'vision':
        return true; // Claude 3 models support vision
      case 'json_mode':
        return true; // Supports prefill for JSON
      default:
        return super.supports(feature);
    }
  }

  /**
   * Formats messages for the Anthropic API.
   * - Extracts system prompt.
   * - Handles tool results (must be role='user').
   * - Handles assistant tool calls (content array with tool_use blocks).
   */
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

  /**
   * Formats tool definitions for Anthropic.
   */
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
