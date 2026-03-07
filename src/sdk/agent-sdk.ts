/**
 * Agent SDK
 *
 * Programmatic API for embedding Code Buddy as an agent in other applications.
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentSDKConfig {
  model?: string;
  tools?: string[];
  maxTurns?: number;
  systemPrompt?: string;
}

export interface AgentSDKResult {
  success: boolean;
  output: string;
  toolCalls: number;
  cost: number;
}

interface SDKToolInvocation {
  name: string;
  input: Record<string, unknown>;
}

type SDKMessage = {
  role: 'system' | 'user';
  content: string;
};

type SDKClient = {
  chat: (
    messages: SDKMessage[],
    tools?: unknown[]
  ) => Promise<{
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  }>;
};

export interface SDKStreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'done';
  data: unknown;
}

export interface SDKToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<string>;
}

// ============================================================================
// AgentSDK
// ============================================================================

export class AgentSDK {
  private config: AgentSDKConfig;
  private customTools: Map<string, SDKToolDefinition> = new Map();
  private client: SDKClient | null = null;

  constructor(config: AgentSDKConfig = {}) {
    this.config = {
      model: config.model ?? 'grok-3-mini',
      tools: config.tools ?? [],
      maxTurns: config.maxTurns ?? 10,
      systemPrompt: config.systemPrompt ?? 'You are a helpful coding assistant.',
    };
    logger.debug(`AgentSDK initialized with model: ${this.config.model}`);
  }

  /**
   * Run agent loop with a prompt (returns final result)
   */
  async run(prompt: string): Promise<AgentSDKResult> {
    logger.debug(`AgentSDK.run: ${prompt.slice(0, 100)}`);

    if (!prompt.trim()) {
      throw new Error('Prompt cannot be empty');
    }

    const executions = await this.executeToolInvocations(prompt);
    const client = await this.getClient();
    const output = await this.buildFinalOutput(prompt, executions, client);
    const toolCalls = executions.length;
    const cost = client ? this.estimateCost(toolCalls, output) : 0;

    return {
      success: true,
      output,
      toolCalls,
      cost,
    };
  }

  /**
   * Run agent loop with streaming events
   */
  async *runStreaming(prompt: string): AsyncGenerator<SDKStreamEvent> {
    logger.debug(`AgentSDK.runStreaming: ${prompt.slice(0, 100)}`);

    if (!prompt.trim()) {
      throw new Error('Prompt cannot be empty');
    }

    const executions = await this.executeToolInvocations(prompt);
    const client = await this.getClient();
    const output = await this.buildFinalOutput(prompt, executions, client);

    for (const execution of executions) {
      yield { type: 'tool_use', data: execution.invocation };
      yield { type: 'tool_result', data: execution.result };
    }

    yield { type: 'text', data: output };
    yield {
      type: 'done',
      data: {
        success: true,
        toolCalls: executions.length,
        cost: client ? this.estimateCost(executions.length, output) : 0,
      },
    };
  }

  /**
   * Register a custom tool
   */
  addTool(definition: SDKToolDefinition): void {
    if (this.customTools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" already registered`);
    }
    this.customTools.set(definition.name, definition);
    logger.debug(`Tool registered: ${definition.name}`);
  }

  /**
   * Remove a custom tool
   */
  removeTool(name: string): boolean {
    const deleted = this.customTools.delete(name);
    if (deleted) {
      logger.debug(`Tool removed: ${name}`);
    }
    return deleted;
  }

  /**
   * List all available tools (built-in + custom)
   */
  getTools(): string[] {
    const builtIn = this.config.tools || [];
    const custom = Array.from(this.customTools.keys());
    return [...builtIn, ...custom];
  }

  /**
   * Update system prompt
   */
  setSystemPrompt(prompt: string): void {
    this.config.systemPrompt = prompt;
  }

  /**
   * Get current configuration
   */
  getConfig(): AgentSDKConfig {
    return { ...this.config };
  }

  private async getClient(): Promise<SDKClient | null> {
    if (this.client) {
      return this.client;
    }

    const apiKey = process.env.GROK_API_KEY?.trim();
    if (!apiKey) {
      return null;
    }

    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    this.client = new CodeBuddyClient(apiKey, this.config.model) as SDKClient;
    return this.client;
  }

  private parseToolInvocations(prompt: string): SDKToolInvocation[] {
    const invocations: SDKToolInvocation[] = [];
    const pattern = /@tool\s+([a-zA-Z0-9_-]+)\s+({[\s\S]*?})/g;

    for (const match of prompt.matchAll(pattern)) {
      const [, name, json] = match;
      const parsed = JSON.parse(json) as Record<string, unknown>;
      invocations.push({ name, input: parsed });
    }

    return invocations.slice(0, this.config.maxTurns);
  }

  private async executeToolInvocations(
    prompt: string
  ): Promise<Array<{ invocation: SDKToolInvocation; result: { name: string; output: string } }>> {
    const invocations = this.parseToolInvocations(prompt);
    const executions: Array<{ invocation: SDKToolInvocation; result: { name: string; output: string } }> = [];

    for (const invocation of invocations) {
      const tool = this.customTools.get(invocation.name);
      if (!tool) {
        throw new Error(`Tool "${invocation.name}" is not registered`);
      }

      const output = await tool.execute(invocation.input);
      executions.push({
        invocation,
        result: {
          name: invocation.name,
          output,
        },
      });
    }

    return executions;
  }

  private async buildFinalOutput(
    prompt: string,
    executions: Array<{ invocation: SDKToolInvocation; result: { name: string; output: string } }>,
    client: SDKClient | null
  ): Promise<string> {
    if (client) {
      try {
        const summary = await client.chat([
          {
            role: 'system',
            content: this.config.systemPrompt || 'You are a helpful coding assistant.',
          },
          {
            role: 'user',
            content: `User prompt:\n${prompt}\n\nTool results:\n${JSON.stringify(executions, null, 2)}\n\nReturn a concise final answer.`,
          },
        ], []);

        const content = summary.choices?.[0]?.message?.content?.trim();
        if (content) {
          return content;
        }
      } catch (error) {
        logger.debug('AgentSDK AI summary failed, falling back to local output', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (executions.length === 0) {
      return `Processed prompt: ${prompt}`;
    }

    return [
      `Processed prompt: ${prompt}`,
      '',
      ...executions.map(({ result }) => `[${result.name}] ${result.output}`),
    ].join('\n');
  }

  private estimateCost(toolCalls: number, output: string): number {
    return Number((toolCalls * 0.001 + Math.max(output.length, 1) / 100000).toFixed(6));
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createAgent(config: AgentSDKConfig = {}): AgentSDK {
  return new AgentSDK(config);
}
