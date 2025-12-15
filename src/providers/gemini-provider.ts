/**
 * Gemini Provider (Google)
 *
 * LLM provider implementation for Google Gemini API.
 */

import { BaseLLMProvider } from './base-provider.js';
import type {
  ProviderType,
  ProviderConfig,
  CompletionOptions,
  LLMResponse,
  StreamChunk,
  ToolCall,
} from './types.js';

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
