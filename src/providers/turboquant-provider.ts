/**
 * TurboQuant Provider
 *
 * Routes between Ollama (lightweight) and vLLM (heavy) with TurboQuant KV cache
 * quantization config. Compatible with CodeBuddyResponse interface.
 *
 * TurboQuant reference: https://arxiv.org/abs/2401.12428
 * KV cache quantization reduces memory pressure by 2-4x with minimal quality loss.
 */

import { logger } from '../utils/logger.js';
import type { CodeBuddyMessage, CodeBuddyTool, CodeBuddyResponse, ChatOptions } from '../codebuddy/client.js';

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

export interface TurboQuantConfig {
  enabled: boolean;
  /** Bits for KV cache quantization: 2 = higher compression, 4 = balanced */
  nbits: 2 | 4;
  /** Number of residual tokens kept at full precision (default 128) */
  residualLength: number;
  /** Quantization objective: mse = minimize error, prod = maximize throughput */
  mode: 'mse' | 'prod';
  /** Rotation matrix type for quantization */
  rotation: 'dense_gaussian' | 'walsh_hadamard';
  /** Transformer layers to skip quantization on, or 'auto' to skip first+last */
  skipLayers: number[] | 'auto';
}

export interface ModelRoutingConfig {
  /** Ollama model name for lightweight (short/simple) requests */
  lightweight: string;
  /** vLLM model name for heavy (long/complex) requests */
  heavy: string;
  /**
   * Token count threshold above which requests are routed to vLLM.
   * 'auto' = automatically derived from message content complexity.
   */
  complexityThreshold: 'auto' | number;
}

export interface TurboQuantProviderConfig {
  /** vLLM endpoint, e.g. "http://192.168.1.50:8000" */
  vllmEndpoint?: string;
  /** Ollama endpoint, e.g. "http://localhost:11434" */
  ollamaEndpoint?: string;
  turboquant: TurboQuantConfig;
  modelRouting: ModelRoutingConfig;
}

// ---------------------------------------------------------------------------
// Internal response shapes
// ---------------------------------------------------------------------------

interface OllamaChatResponse {
  message?: {
    role?: string;
    content?: string;
  };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface VllmChatResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// ---------------------------------------------------------------------------
// Routing decision
// ---------------------------------------------------------------------------

/** Characters per approximate token (rough heuristic) */
const CHARS_PER_TOKEN = 4;

/** Default complexity threshold in tokens when 'auto' is chosen */
const AUTO_COMPLEXITY_THRESHOLD = 800;

function hasNonEmptyContent(content: string | null | undefined): content is string {
  return typeof content === 'string' && content.trim().length > 0;
}

function requireBackendContent(backend: string, content: string | null | undefined): string {
  if (!hasNonEmptyContent(content)) {
    throw new Error(`${backend} returned empty response content`);
  }
  return content;
}

/**
 * Estimate total token count from a message array (content only, no tools).
 */
function estimateTokenCount(messages: CodeBuddyMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'object' && part !== null && 'text' in part && typeof (part as { text: string }).text === 'string') {
          chars += (part as { text: string }).text.length;
        }
      }
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// TurboQuantProvider
// ---------------------------------------------------------------------------

export class TurboQuantProvider {
  private readonly config: TurboQuantProviderConfig;
  private readonly vllmBase: string;
  private readonly ollamaBase: string;

  constructor(config: TurboQuantProviderConfig) {
    this.config = config;
    this.vllmBase = (config.vllmEndpoint ?? '').replace(/\/$/, '');
    this.ollamaBase = (config.ollamaEndpoint ?? 'http://localhost:11434').replace(/\/$/, '');
  }

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------

  /**
   * Send a chat request, routing to Ollama or vLLM based on message complexity.
   */
  async chat(
    messages: CodeBuddyMessage[],
    tools?: CodeBuddyTool[],
    opts?: ChatOptions
  ): Promise<CodeBuddyResponse> {
    const target = this.routeRequest(messages);
    logger.debug(`TurboQuant routing to ${target}`, {
      estimatedTokens: estimateTokenCount(messages),
    });

    if (target === 'ollama') {
      return this.callOllama(messages, this.config.modelRouting.lightweight);
    }
    return this.callVllm(messages, this.config.modelRouting.heavy, opts, tools);
  }

  /**
   * Streaming chat — yields chunks from Ollama or vLLM.
   * Returns an async generator compatible with SSE/NDJSON streams.
   */
  async *chatStream(
    messages: CodeBuddyMessage[],
    tools?: CodeBuddyTool[],
    opts?: ChatOptions
  ): AsyncGenerator<string> {
    const target = this.routeRequest(messages);
    logger.debug(`TurboQuant streaming via ${target}`);

    if (target === 'ollama') {
      yield* this.streamOllama(messages, this.config.modelRouting.lightweight);
    } else {
      yield* this.streamVllm(messages, this.config.modelRouting.heavy, opts, tools);
    }
  }

  /**
   * Check if at least one backend endpoint is reachable.
   */
  async isAvailable(): Promise<boolean> {
    const checks = await Promise.allSettled([
      this.pingOllama(),
      this.pingVllm(),
    ]);
    return checks.some((r) => r.status === 'fulfilled' && r.value === true);
  }

  /**
   * Return the TurboQuant extra_body params to pass to vLLM when TQ is enabled.
   * vLLM must be started with --kv-cache-dtype fp8 or similar; these params
   * document the intended quantization config but are passed as extra_body
   * for forward compatibility with vLLM TurboQuant integration.
   */
  getTurboQuantExtraBody(): Record<string, unknown> | null {
    const tq = this.config.turboquant;
    if (!tq.enabled) return null;
    return {
      turboquant: {
        nbits: tq.nbits,
        residual_length: tq.residualLength,
        mode: tq.mode,
        rotation: tq.rotation,
        skip_layers: tq.skipLayers === 'auto' ? null : tq.skipLayers,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  /**
   * Decide which backend to use based on message complexity.
   */
  private routeRequest(messages: CodeBuddyMessage[]): 'ollama' | 'vllm' {
    // If vLLM is not configured, always use Ollama
    if (!this.vllmBase) return 'ollama';
    // If Ollama model is empty, always use vLLM
    if (!this.config.modelRouting.lightweight) return 'vllm';

    const tokens = estimateTokenCount(messages);
    const threshold =
      this.config.modelRouting.complexityThreshold === 'auto'
        ? AUTO_COMPLEXITY_THRESHOLD
        : this.config.modelRouting.complexityThreshold;

    return tokens >= threshold ? 'vllm' : 'ollama';
  }

  // ---------------------------------------------------------------------------
  // Ollama
  // ---------------------------------------------------------------------------

  private async callOllama(
    messages: CodeBuddyMessage[],
    model: string
  ): Promise<CodeBuddyResponse> {
    const url = `${this.ollamaBase}/api/chat`;
    const body = JSON.stringify({
      model,
      messages: this.normalizeMessages(messages),
      stream: false,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    const content = requireBackendContent('Ollama', data.message?.content);

    return {
      choices: [
        {
          message: {
            role: data.message?.role ?? 'assistant',
            content,
          },
          finish_reason: data.done ? 'stop' : 'length',
        },
      ],
      usage: {
        prompt_tokens: data.prompt_eval_count ?? 0,
        completion_tokens: data.eval_count ?? 0,
        total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
    };
  }

  private async *streamOllama(
    messages: CodeBuddyMessage[],
    model: string
  ): AsyncGenerator<string> {
    const url = `${this.ollamaBase}/api/chat`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: this.normalizeMessages(messages),
        stream: true,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      throw new Error(`Ollama stream error: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Ollama returned no response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let emittedContent = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as OllamaChatResponse;
            const token = parsed.message?.content;
            if (token) {
              if (token.trim().length > 0) {
                emittedContent = true;
              }
              yield token;
            }
          } catch {
            // Partial JSON line — skip
          }
        }
      }
      if (!emittedContent) {
        throw new Error('Ollama returned empty response content');
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ---------------------------------------------------------------------------
  // vLLM
  // ---------------------------------------------------------------------------

  private async callVllm(
    messages: CodeBuddyMessage[],
    model: string,
    opts?: ChatOptions,
    tools?: CodeBuddyTool[]
  ): Promise<CodeBuddyResponse> {
    const url = `${this.vllmBase}/v1/chat/completions`;
    const extraBody = this.getTurboQuantExtraBody();

    const body: Record<string, unknown> = {
      model,
      messages: this.normalizeMessages(messages),
      stream: false,
      max_tokens: 4096,
      temperature: opts?.temperature ?? 0.7,
    };

    if (tools && tools.length > 0) {
      body['tools'] = tools;
      body['tool_choice'] = 'auto';
    }

    if (extraBody) {
      Object.assign(body, extraBody);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });

    if (!response.ok) {
      throw new Error(`vLLM API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as VllmChatResponse;
    return this.normalizeVllmResponse(data);
  }

  private async *streamVllm(
    messages: CodeBuddyMessage[],
    model: string,
    opts?: ChatOptions,
    tools?: CodeBuddyTool[]
  ): AsyncGenerator<string> {
    const url = `${this.vllmBase}/v1/chat/completions`;
    const extraBody = this.getTurboQuantExtraBody();

    const body: Record<string, unknown> = {
      model,
      messages: this.normalizeMessages(messages),
      stream: true,
      max_tokens: 4096,
      temperature: opts?.temperature ?? 0.7,
    };

    if (tools && tools.length > 0) {
      body['tools'] = tools;
      body['tool_choice'] = 'auto';
    }

    if (extraBody) {
      Object.assign(body, extraBody);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });

    if (!response.ok) {
      throw new Error(`vLLM stream error: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('vLLM returned no response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let emittedContent = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
          try {
            const parsed = JSON.parse(jsonStr) as {
              choices?: Array<{ delta?: { content?: string | null } }>;
            };
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) {
              if (token.trim().length > 0) {
                emittedContent = true;
              }
              yield token;
            }
          } catch {
            // Partial SSE line — skip
          }
        }
      }
      if (!emittedContent) {
        throw new Error('vLLM returned empty response content');
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ---------------------------------------------------------------------------
  // Health checks
  // ---------------------------------------------------------------------------

  private async pingOllama(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaBase}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async pingVllm(): Promise<boolean> {
    if (!this.vllmBase) return false;
    try {
      const response = await fetch(`${this.vllmBase}/v1/models`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Normalize CodeBuddyMessage array to simple role/content objects
   * that both Ollama and vLLM understand.
   */
  private normalizeMessages(
    messages: CodeBuddyMessage[]
  ): Array<{ role: string; content: string }> {
    return messages.map((m) => {
      let content = '';
      if (typeof m.content === 'string') {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        content = m.content
          .map((part) => {
            if (typeof part === 'object' && part !== null && 'text' in part) {
              return (part as { text: string }).text;
            }
            return '';
          })
          .join('');
      }
      return { role: m.role as string, content };
    });
  }

  /**
   * Normalize a vLLM OpenAI-compatible response into CodeBuddyResponse.
   */
  private normalizeVllmResponse(data: VllmChatResponse): CodeBuddyResponse {
    const choice = data.choices?.[0];
    const message = choice?.message;

    const toolCalls = message?.tool_calls?.map((tc, idx) => ({
      id: tc.id ?? `call_${idx}`,
      type: 'function' as const,
      function: {
        name: tc.function?.name ?? '',
        arguments: tc.function?.arguments ?? '{}',
      },
    }));
    const hasToolCalls = Boolean(toolCalls && toolCalls.length > 0);
    const content = message?.content ?? null;

    if (!hasToolCalls && !hasNonEmptyContent(content)) {
      throw new Error('vLLM returned empty response content');
    }

    return {
      choices: [
        {
          message: {
            role: message?.role ?? 'assistant',
            content,
            ...(hasToolCalls ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: choice?.finish_reason ?? 'stop',
        },
      ],
      usage: {
        prompt_tokens: data.usage?.prompt_tokens ?? 0,
        completion_tokens: data.usage?.completion_tokens ?? 0,
        total_tokens: data.usage?.total_tokens ?? 0,
      },
    };
  }
}

/**
 * Build a TurboQuantProvider from environment variables or supplied config.
 * Returns null if neither TURBOQUANT_VLLM_ENDPOINT nor TURBOQUANT_OLLAMA_ENDPOINT is set.
 */
export function createTurboQuantProvider(
  overrides?: Partial<TurboQuantProviderConfig>
): TurboQuantProvider | null {
  const vllmEndpoint = overrides?.vllmEndpoint ?? process.env['TURBOQUANT_VLLM_ENDPOINT'] ?? '';
  const ollamaEndpoint =
    overrides?.ollamaEndpoint ??
    process.env['TURBOQUANT_OLLAMA_ENDPOINT'] ??
    process.env['OLLAMA_HOST'] ??
    '';

  if (!vllmEndpoint && !ollamaEndpoint) return null;

  const config: TurboQuantProviderConfig = {
    vllmEndpoint: vllmEndpoint || undefined,
    ollamaEndpoint: ollamaEndpoint || 'http://localhost:11434',
    turboquant: {
      enabled: true,
      nbits: 4,
      residualLength: 128,
      mode: 'mse',
      rotation: 'walsh_hadamard',
      skipLayers: 'auto',
      ...overrides?.turboquant,
    },
    modelRouting: {
      lightweight: process.env['TURBOQUANT_LIGHTWEIGHT_MODEL'] ?? 'llama3.2',
      heavy: process.env['TURBOQUANT_HEAVY_MODEL'] ?? 'qwen2.5-72b-instruct',
      complexityThreshold: 'auto',
      ...overrides?.modelRouting,
    },
  };

  return new TurboQuantProvider(config);
}
