/**
 * Grok Client for VS Code Extension
 */

import OpenAI from 'openai';

export interface GrokMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GrokClientConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
  maxTokens?: number;
}

export class GrokClient {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(apiKey: string, model: string = 'grok-3-latest', baseURL?: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: baseURL || 'https://api.x.ai/v1',
    });
    this.model = model;
    this.maxTokens = 4096;
  }

  /**
   * Update client configuration
   */
  updateConfig(config: Partial<GrokClientConfig>): void {
    if (config.apiKey) {
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL || 'https://api.x.ai/v1',
      });
    }
    if (config.model) {
      this.model = config.model;
    }
    if (config.maxTokens) {
      this.maxTokens = config.maxTokens;
    }
  }

  /**
   * Send a chat message and get response
   */
  async chat(messages: GrokMessage[]): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: this.maxTokens,
        temperature: 0.7,
      });

      return response.choices[0]?.message?.content || '';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Grok API error: ${message}`);
    }
  }

  /**
   * Stream a chat response
   */
  async *chatStream(messages: GrokMessage[]): AsyncGenerator<string, void, unknown> {
    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: this.maxTokens,
        temperature: 0.7,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield content;
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Grok API error: ${message}`);
    }
  }

  /**
   * Get inline completion
   */
  async getCompletion(
    prefix: string,
    suffix: string,
    language: string
  ): Promise<string> {
    const response = await this.chat([
      {
        role: 'system',
        content: `You are an expert ${language} developer. Complete the code naturally. Return ONLY the completion, nothing else.`,
      },
      {
        role: 'user',
        content: `Complete this ${language} code:\n\n${prefix}<CURSOR>${suffix}\n\nProvide ONLY the text that should be inserted at <CURSOR>.`,
      },
    ]);

    return response.trim();
  }

  /**
   * Review code for issues
   */
  async reviewCode(
    code: string,
    language: string
  ): Promise<Array<{
    severity: 'error' | 'warning' | 'info';
    line: number;
    message: string;
    suggestion?: string;
  }>> {
    const response = await this.chat([
      {
        role: 'system',
        content: `You are an expert code reviewer. Analyze the code for bugs, security issues, and best practice violations. Return a JSON array of issues.`,
      },
      {
        role: 'user',
        content: `Review this ${language} code and return issues as JSON array:
\`\`\`${language}
${code}
\`\`\`

Return format: [{"severity": "error|warning|info", "line": <number>, "message": "<description>", "suggestion": "<fix>"}]

If no issues found, return empty array [].`,
      },
    ]);

    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Get current model
   */
  getModel(): string {
    return this.model;
  }
}
