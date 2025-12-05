/**
 * Multi-LLM Provider Abstraction
 *
 * Unified interface for multiple LLM providers:
 * - Grok (xAI) - Default
 * - Claude (Anthropic)
 * - GPT (OpenAI)
 * - Gemini (Google)
 *
 * Inspired by VibeKit's multi-provider support.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export type ProviderType = 'grok' | 'claude' | 'openai' | 'gemini';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMResponse {
  id: string;
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: ProviderType;
}

export interface StreamChunk {
  type: 'content' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: Partial<ToolCall>;
  error?: string;
}

export interface ProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  maxRetries?: number;
}

export interface CompletionOptions {
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  systemPrompt?: string;
}

// ============================================================================
// Provider Interface
// ============================================================================

export interface LLMProvider {
  readonly type: ProviderType;
  readonly name: string;
  readonly defaultModel: string;

  /**
   * Initialize the provider
   */
  initialize(config: ProviderConfig): Promise<void>;

  /**
   * Check if provider is ready
   */
  isReady(): boolean;

  /**
   * Get completion (non-streaming)
   */
  complete(options: CompletionOptions): Promise<LLMResponse>;

  /**
   * Get streaming completion
   */
  stream(options: CompletionOptions): AsyncIterable<StreamChunk>;

  /**
   * Get available models
   */
  getModels(): Promise<string[]>;

  /**
   * Estimate token count for text
   */
  estimateTokens(text: string): number;

  /**
   * Get pricing info
   */
  getPricing(): { input: number; output: number };

  /**
   * Dispose resources
   */
  dispose(): void;
}

// ============================================================================
// Base Provider Implementation
// ============================================================================

export abstract class BaseLLMProvider extends EventEmitter implements LLMProvider {
  abstract readonly type: ProviderType;
  abstract readonly name: string;
  abstract readonly defaultModel: string;

  protected config: ProviderConfig | null = null;
  protected ready = false;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    await this.validateConfig();
    this.ready = true;
    this.emit('ready');
  }

  isReady(): boolean {
    return this.ready;
  }

  protected async validateConfig(): Promise<void> {
    if (!this.config?.apiKey) {
      throw new Error(`${this.name} API key is required`);
    }
  }

  abstract complete(options: CompletionOptions): Promise<LLMResponse>;
  abstract stream(options: CompletionOptions): AsyncIterable<StreamChunk>;

  async getModels(): Promise<string[]> {
    return [this.defaultModel];
  }

  estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  abstract getPricing(): { input: number; output: number };

  dispose(): void {
    this.ready = false;
    this.config = null;
    this.removeAllListeners();
  }
}

// ============================================================================
// Grok Provider (xAI)
// ============================================================================

export class GrokProvider extends BaseLLMProvider {
  readonly type: ProviderType = 'grok';
  readonly name = 'Grok (xAI)';
  readonly defaultModel = 'grok-3-latest';

  private client: unknown = null;

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
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 16384,
    });

    const choice = response.choices[0];
    return {
      id: response.id,
      content: choice.message.content,
      toolCalls: (choice.message.tool_calls || []).map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: (tc as any).function.name,
          arguments: (tc as any).function.arguments,
        },
      })),
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

// ============================================================================
// Claude Provider (Anthropic)
// ============================================================================

export class ClaudeProvider extends BaseLLMProvider {
  readonly type: ProviderType = 'claude';
  readonly name = 'Claude (Anthropic)';
  readonly defaultModel = 'claude-sonnet-4-20250514';

  private client: unknown = null;

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);

    // Dynamic import - SDK is optional
    const Anthropic = (await import('@anthropic-ai/sdk' as any)).default;
    this.client = new Anthropic({
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

    const anthropic = this.client as any;
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
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
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

    const anthropic = this.client as any;
    const { system, messages } = this.formatMessages(options);

    const stream = anthropic.messages.stream({
      model: this.config.model || this.defaultModel,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 8192,
      system,
      messages,
      tools: options.tools ? this.formatTools(options.tools) : undefined,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta as { type: string; text?: string; partial_json?: string };
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
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
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

// ============================================================================
// OpenAI Provider (GPT)
// ============================================================================

export class OpenAIProvider extends BaseLLMProvider {
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
      toolCalls: (choice.message.tool_calls || []).map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: (tc as any).function.name,
          arguments: (tc as any).function.arguments,
        },
      })),
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

// ============================================================================
// Gemini Provider (Google)
// ============================================================================

export class GeminiProvider extends BaseLLMProvider {
  readonly type: ProviderType = 'gemini';
  readonly name = 'Gemini (Google)';
  readonly defaultModel = 'gemini-2.0-flash';

  private client: unknown = null;

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

  async complete(options: CompletionOptions): Promise<LLMResponse> {
    if (!this.client || !this.config) {
      throw new Error('Provider not initialized');
    }

    const client = this.client as { apiKey: string; baseUrl: string; model: string };
    const model = this.config.model || this.defaultModel;
    const url = `${client.baseUrl}/models/${model}:generateContent?key=${client.apiKey}`;

    const body = this.formatRequest(options);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

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

    const candidate = data.candidates[0];
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

  async *stream(options: CompletionOptions): AsyncIterable<StreamChunk> {
    if (!this.client || !this.config) {
      throw new Error('Provider not initialized');
    }

    const client = this.client as { apiKey: string; baseUrl: string; model: string };
    const model = this.config.model || this.defaultModel;
    const url = `${client.baseUrl}/models/${model}:streamGenerateContent?key=${client.apiKey}&alt=sse`;

    const body = this.formatRequest(options);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
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

  async getModels(): Promise<string[]> {
    return [
      'gemini-2.0-flash',
      'gemini-2.0-flash-thinking',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ];
  }

  getPricing(): { input: number; output: number } {
    // Gemini 2.0 Flash pricing per 1M tokens
    return { input: 0.075, output: 0.30 };
  }

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
        contents.push({
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: msg.name || 'unknown',
                response: { result: msg.content },
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

    if (options.tools) {
      request.tools = [
        {
          functionDeclarations: options.tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      ];
    }

    return request;
  }
}

// ============================================================================
// Provider Manager
// ============================================================================

export class ProviderManager extends EventEmitter {
  private providers: Map<ProviderType, LLMProvider> = new Map();
  private activeProvider: ProviderType = 'grok';
  private configs: Map<ProviderType, ProviderConfig> = new Map();

  /**
   * Register a provider
   */
  async registerProvider(type: ProviderType, config: ProviderConfig): Promise<void> {
    this.configs.set(type, config);

    const provider = this.createProvider(type);
    await provider.initialize(config);

    this.providers.set(type, provider);
    this.emit('provider:registered', { type, name: provider.name });
  }

  /**
   * Create provider instance
   */
  private createProvider(type: ProviderType): LLMProvider {
    switch (type) {
      case 'grok':
        return new GrokProvider();
      case 'claude':
        return new ClaudeProvider();
      case 'openai':
        return new OpenAIProvider();
      case 'gemini':
        return new GeminiProvider();
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }

  /**
   * Set active provider
   */
  setActiveProvider(type: ProviderType): void {
    if (!this.providers.has(type)) {
      throw new Error(`Provider ${type} not registered`);
    }
    this.activeProvider = type;
    this.emit('provider:changed', { type });
  }

  /**
   * Get active provider
   */
  getActiveProvider(): LLMProvider {
    const provider = this.providers.get(this.activeProvider);
    if (!provider) {
      throw new Error(`No active provider. Register a provider first.`);
    }
    return provider;
  }

  /**
   * Get specific provider
   */
  getProvider(type: ProviderType): LLMProvider | undefined {
    return this.providers.get(type);
  }

  /**
   * Get all registered providers
   */
  getRegisteredProviders(): ProviderType[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get active provider type
   */
  getActiveProviderType(): ProviderType {
    return this.activeProvider;
  }

  /**
   * Auto-select best provider based on task
   */
  async selectBestProvider(options: {
    requiresToolUse?: boolean;
    requiresVision?: boolean;
    requiresLongContext?: boolean;
    costSensitive?: boolean;
  }): Promise<ProviderType> {
    const available = this.getRegisteredProviders();

    // Vision requirements
    if (options.requiresVision) {
      if (available.includes('gemini')) return 'gemini';
      if (available.includes('openai')) return 'openai';
      if (available.includes('claude')) return 'claude';
    }

    // Long context requirements
    if (options.requiresLongContext) {
      if (available.includes('gemini')) return 'gemini'; // 2M context
      if (available.includes('claude')) return 'claude'; // 200k context
    }

    // Cost sensitive
    if (options.costSensitive) {
      if (available.includes('gemini')) return 'gemini'; // Cheapest
      if (available.includes('openai')) return 'openai'; // GPT-4o-mini
    }

    // Default to active provider
    return this.activeProvider;
  }

  /**
   * Complete with active provider
   */
  async complete(options: CompletionOptions): Promise<LLMResponse> {
    return this.getActiveProvider().complete(options);
  }

  /**
   * Stream with active provider
   */
  stream(options: CompletionOptions): AsyncIterable<StreamChunk> {
    return this.getActiveProvider().stream(options);
  }

  /**
   * Dispose all providers
   */
  dispose(): void {
    for (const provider of this.providers.values()) {
      provider.dispose();
    }
    this.providers.clear();
    this.configs.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let providerManagerInstance: ProviderManager | null = null;

export function getProviderManager(): ProviderManager {
  if (!providerManagerInstance) {
    providerManagerInstance = new ProviderManager();
  }
  return providerManagerInstance;
}

export function resetProviderManager(): void {
  if (providerManagerInstance) {
    providerManagerInstance.dispose();
  }
  providerManagerInstance = null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Auto-configure providers from environment
 */
export async function autoConfigureProviders(): Promise<ProviderManager> {
  const manager = getProviderManager();

  // Grok (xAI)
  if (process.env.GROK_API_KEY || process.env.XAI_API_KEY) {
    await manager.registerProvider('grok', {
      apiKey: process.env.GROK_API_KEY || process.env.XAI_API_KEY || '',
    });
  }

  // Claude (Anthropic)
  if (process.env.ANTHROPIC_API_KEY) {
    await manager.registerProvider('claude', {
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  // OpenAI
  if (process.env.OPENAI_API_KEY) {
    await manager.registerProvider('openai', {
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  // Gemini (Google)
  if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
    await manager.registerProvider('gemini', {
      apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '',
    });
  }

  return manager;
}
