import type { ChatEntry, StreamingChunk } from '../agent/types.js';
import type { ToolResult } from '../types/index.js';
import { detectProviderFromEnv } from '../utils/provider-detector.js';

export interface ServerAgentConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
}

export interface ServerModelInfo {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface ServerAgent {
  processUserMessage(message: string): Promise<ChatEntry[]>;
  processUserMessageStream(message: string): AsyncIterable<StreamingChunk>;
  getChatHistory(): ChatEntry[];
  getCurrentModel(): string;
  setModel(model: string): void;
  executeToolByName(name: string, parameters?: Record<string, unknown>): Promise<ToolResult>;
  systemPromptReady?: Promise<void>;
}

export interface ServerAgentCompletion {
  content: string;
  finishReason: string;
  toolCalls?: Array<{
    name: string;
    id: string;
    success?: boolean;
    output?: string;
    error?: string;
    executionTime?: number;
  }>;
}

export interface ServerAgentRequestOptions {
  model?: string;
}

export function resolveServerAgentConfig(): ServerAgentConfig {
  const detected = detectProviderFromEnv();

  return {
    apiKey: detected?.apiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY || '',
    baseURL: detected?.baseURL || process.env.GROK_BASE_URL,
    model: process.env.GROK_MODEL || detected?.defaultModel || 'grok-3-latest',
  };
}

export function listServerModels(): ServerModelInfo[] {
  const detected = detectProviderFromEnv();
  const created = Math.floor(Date.now() / 1000);
  const configuredModel = process.env.GROK_MODEL || detected?.defaultModel;

  if (detected?.provider === 'chatgpt') {
    return [
      {
        id: configuredModel || 'gpt-5.6-sol',
        object: 'model',
        created,
        owned_by: 'chatgpt',
      },
    ];
  }

  if (detected?.provider === 'openai') {
    return [
      {
        id: configuredModel || 'gpt-4o',
        object: 'model',
        created,
        owned_by: 'openai',
      },
    ];
  }

  if (detected?.provider === 'gemini') {
    return [
      {
        id: configuredModel || 'gemini-2.5-flash',
        object: 'model',
        created,
        owned_by: 'google',
      },
    ];
  }

  if (detected?.provider === 'anthropic') {
    return [
      {
        id: configuredModel || 'claude-sonnet-4-20250514',
        object: 'model',
        created,
        owned_by: 'anthropic',
      },
    ];
  }

  if (detected?.provider === 'ollama') {
    return [
      {
        id: configuredModel || 'qwen2.5-coder:7b',
        object: 'model',
        created,
        owned_by: 'ollama',
      },
    ];
  }

  return [
    {
      id: process.env.GROK_MODEL || 'grok-3-latest',
      object: 'model',
      created,
      owned_by: 'xai',
    },
    {
      id: 'grok-3-fast',
      object: 'model',
      created,
      owned_by: 'xai',
    },
    {
      id: 'grok-2-latest',
      object: 'model',
      created,
      owned_by: 'xai',
    },
  ];
}

export async function createServerAgent(): Promise<ServerAgent> {
  const { CodeBuddyAgent } = await import('../agent/codebuddy-agent.js');
  const config = resolveServerAgentConfig();
  const agent = new CodeBuddyAgent(
    config.apiKey,
    config.baseURL,
    config.model
  ) as ServerAgent;

  await agent.systemPromptReady;
  return agent;
}

export async function runAgentCompletion(
  agent: ServerAgent,
  input: string,
  options: ServerAgentRequestOptions = {}
): Promise<ServerAgentCompletion> {
  return withRequestModel(agent, options.model, async () => {
    await agent.systemPromptReady;
    const entries = await agent.processUserMessage(input);
    const content = entries
      .filter((entry) => entry.type === 'assistant' && entry.content.trim().length > 0)
      .map((entry) => entry.content)
      .join('\n')
      .trim();

    const toolCalls = entries
      .filter((entry) => entry.type === 'tool_result' && entry.toolCall)
      .map((entry) => ({
        name: entry.toolCall!.function.name,
        id: entry.toolCall!.id,
        success: entry.toolResult?.success,
        output: entry.toolResult?.output,
        error: entry.toolResult?.error,
        executionTime: 0,
      }));

    return {
      content,
      finishReason: 'stop',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  });
}

export async function* streamAgentDeltas(
  agent: ServerAgent,
  input: string,
  options: ServerAgentRequestOptions = {}
): AsyncIterable<string> {
  const originalModel = agent.getCurrentModel();
  const requestedModel = options.model?.trim();

  if (requestedModel && requestedModel !== originalModel) {
    agent.setModel(requestedModel);
  }

  try {
    await agent.systemPromptReady;
    const historyStart = agent.getChatHistory().length;
    let emittedContent = false;

    for await (const chunk of agent.processUserMessageStream(input)) {
      if (chunk.type === 'content' && chunk.content) {
        if (isInternalUsageContent(chunk.content)) {
          continue;
        }
        emittedContent = true;
        yield chunk.content;
      }
    }

    if (!emittedContent) {
      const fallbackContent = agent.getChatHistory()
        .slice(historyStart)
        .filter((entry) => entry.type === 'assistant' && entry.content.trim().length > 0)
        .map((entry) => entry.content)
        .join('\n')
        .trim();

      if (fallbackContent) {
        yield fallbackContent;
      }
    }
  } finally {
    if (requestedModel && agent.getCurrentModel() !== originalModel) {
      agent.setModel(originalModel);
    }
  }
}

function isInternalUsageContent(content: string): boolean {
  return /^\s*\[tokens:\s[\s\S]*\|\scost:\s\$/.test(content);
}

async function withRequestModel<T>(
  agent: ServerAgent,
  model: string | undefined,
  run: () => Promise<T>
): Promise<T> {
  const originalModel = agent.getCurrentModel();
  const requestedModel = model?.trim();

  if (requestedModel && requestedModel !== originalModel) {
    agent.setModel(requestedModel);
  }

  try {
    return await run();
  } finally {
    if (requestedModel && agent.getCurrentModel() !== originalModel) {
      agent.setModel(originalModel);
    }
  }
}
