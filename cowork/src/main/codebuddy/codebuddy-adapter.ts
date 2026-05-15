/**
 * @module main/codebuddy/codebuddy-adapter
 *
 * @deprecated Use CodeBuddyEngineAdapter (in-process) instead.
 * This HTTP adapter is kept for backward compatibility with standalone
 * Code Buddy server deployments. For embedded mode (buddy gui), the
 * engine runs in-process via CodeBuddyEngineRunner.
 *
 * Backend adapter for Code Buddy's HTTP API (~300 lines).
 *
 * Responsibilities:
 * - Health-check Code Buddy server availability
 * - Stream chat completions via OpenAI-compatible SSE endpoint
 * - Submit agentic tasks and poll status
 * - Enumerate available models
 * - Singleton factory with abort support
 */
import { EventEmitter } from 'events';
import { log, logWarn, logError } from '../utils/logger';

export interface CodeBuddyConfig {
  /** e.g. "http://localhost:3000" */
  endpoint: string;
  /** Optional Bearer token */
  apiKey?: string;
  /** Model override sent on every request */
  model?: string;
  /** Maximum agentic tool rounds (default 50) */
  maxToolRounds?: number;
}

export interface CodeBuddyMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface CodeBuddyToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export type CodeBuddyStreamEventType =
  | 'content'
  | 'tool_calls'
  | 'tool_stream'
  | 'token_count'
  | 'done'
  | 'error';

export interface CodeBuddyStreamEvent {
  type: CodeBuddyStreamEventType;
  content?: string;
  toolCalls?: CodeBuddyToolCall[];
  tokenCount?: number;
  error?: string;
}

/** OpenAI-compatible delta shape returned by Code Buddy's SSE stream. */
interface StreamDelta {
  content?: string;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface StreamChoice {
  delta?: StreamDelta;
  finish_reason?: string | null;
}

interface StreamChunk {
  choices?: StreamChoice[];
  usage?: { total_tokens?: number };
}

/** Task submission response from /api/cloud/tasks */
interface TaskResponse {
  taskId?: string;
  id?: string;
}

/** Model list response from /v1/models */
interface ModelListResponse {
  data?: Array<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class CodeBuddyAdapter extends EventEmitter {
  private config: CodeBuddyConfig;
  private abortController: AbortController | null = null;

  constructor(config: CodeBuddyConfig) {
    super();
    this.config = config;
    log('[CodeBuddyAdapter] initialized, endpoint:', config.endpoint);
  }

  // ---- Health -----------------------------------------------------------------

  /**
   * Returns true when the Code Buddy server responds with 2xx on /api/health.
   * Uses a 3-second hard timeout to avoid blocking startup.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.config.endpoint}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch (err) {
      logWarn('[CodeBuddyAdapter] health check failed:', err);
      return false;
    }
  }

  /** Returns raw health payload (or { status: 'unreachable' } on failure). */
  async getInfraHealth(): Promise<unknown> {
    try {
      const res = await fetch(`${this.config.endpoint}/api/health`);
      return res.json();
    } catch {
      return { status: 'unreachable' };
    }
  }

  // ---- Auth helpers -----------------------------------------------------------

  private get authHeaders(): Record<string, string> {
    return this.config.apiKey
      ? { Authorization: `Bearer ${this.config.apiKey}` }
      : {};
  }

  // ---- Streaming chat ---------------------------------------------------------

  /**
   * Sends messages to Code Buddy's OpenAI-compatible streaming endpoint and
   * yields typed CodeBuddyStreamEvent objects.
   *
   * Parses the SSE `data:` lines produced by Code Buddy's /api/chat/completions
   * (streaming mode), forwarding content deltas, tool_calls, token counts, and
   * terminal done/error signals.
   */
  async *chat(
    messages: CodeBuddyMessage[],
    tools?: unknown[],
  ): AsyncGenerator<CodeBuddyStreamEvent> {
    this.abortController = new AbortController();

    const body = {
      messages,
      model: this.config.model,
      stream: true,
      ...(tools && tools.length > 0
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              function: t,
            })),
          }
        : {}),
      max_tokens: 16384,
    };

    let res: Response;
    try {
      res = await fetch(`${this.config.endpoint}/api/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders,
        },
        body: JSON.stringify(body),
        signal: this.abortController.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError('[CodeBuddyAdapter] chat fetch failed:', err);
      yield { type: 'error', error: `Request failed: ${msg}` };
      return;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logError('[CodeBuddyAdapter] chat HTTP error:', res.status, text);
      yield {
        type: 'error',
        error: `Code Buddy API error: ${res.status} ${res.statusText}`,
      };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body from Code Buddy' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6).trim();
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }

          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(data) as StreamChunk;
          } catch {
            // Malformed SSE line — skip silently.
            continue;
          }

          const choice = chunk.choices?.[0];
          const delta = choice?.delta;

          if (delta?.content) {
            yield { type: 'content', content: delta.content };
          }

          if (delta?.tool_calls && delta.tool_calls.length > 0) {
            const toolCalls: CodeBuddyToolCall[] = delta.tool_calls
              .filter((tc) => tc.id && tc.function?.name)
              .map((tc) => ({
                id: tc.id!,
                function: {
                  name: tc.function!.name!,
                  arguments: tc.function!.arguments ?? '',
                },
              }));
            if (toolCalls.length > 0) {
              yield { type: 'tool_calls', toolCalls };
            }
          }

          if (chunk.usage?.total_tokens) {
            yield { type: 'token_count', tokenCount: chunk.usage.total_tokens };
          }

          if (choice?.finish_reason === 'stop') {
            yield { type: 'done' };
            return;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Stream ended without explicit [DONE] — treat as done.
    yield { type: 'done' };
  }

  // ---- Non-streaming chat -----------------------------------------------------

  /**
   * Single-turn synchronous chat — returns the full assistant message text.
   * Use for short utility calls (title generation, summaries) where streaming
   * is not needed.
   */
  async chatSync(messages: CodeBuddyMessage[], tools?: unknown[]): Promise<string> {
    const res = await fetch(`${this.config.endpoint}/api/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders,
      },
      body: JSON.stringify({
        messages,
        model: this.config.model,
        stream: false,
        ...(tools && tools.length > 0 ? { tools } : {}),
      }),
    });

    if (!res.ok) {
      logError('[CodeBuddyAdapter] chatSync HTTP error:', res.status);
      throw new Error(`Code Buddy chatSync failed: HTTP ${res.status} ${res.statusText}`);
    }

    interface SyncResponse {
      choices?: Array<{ message?: { content?: string } }>;
    }
    const data = (await res.json()) as SyncResponse;
    const content = data.choices?.[0]?.message?.content ?? '';
    if (content.trim().length === 0) {
      throw new Error('Code Buddy chatSync returned empty content');
    }
    return content;
  }

  // ---- Agentic task API -------------------------------------------------------

  /**
   * Submits a full agentic task to Code Buddy's planning endpoint.
   * Code Buddy processes the task autonomously with its own tool suite.
   * Returns the task ID for subsequent status polling.
   */
  async submitTask(prompt: string, cwd?: string): Promise<string> {
    const res = await fetch(`${this.config.endpoint}/api/cloud/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders,
      },
      body: JSON.stringify({ goal: prompt, cwd }),
    });

    if (!res.ok) {
      logError('[CodeBuddyAdapter] submitTask HTTP error:', res.status);
      throw new Error(`Code Buddy submitTask failed: HTTP ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as TaskResponse;
    const taskId = data.taskId ?? data.id ?? '';
    if (!taskId) {
      throw new Error('Code Buddy submitTask returned no task id');
    }
    return taskId;
  }

  /** Polls the status of a previously submitted task. */
  async getTaskStatus(taskId: string): Promise<unknown> {
    const res = await fetch(`${this.config.endpoint}/api/cloud/tasks/${taskId}`, {
      headers: this.authHeaders,
    });
    if (!res.ok) {
      logWarn('[CodeBuddyAdapter] getTaskStatus HTTP error:', res.status);
      throw new Error(`Code Buddy getTaskStatus failed: HTTP ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  // ---- Model enumeration ------------------------------------------------------

  /**
   * Returns the list of model IDs available from Code Buddy's /v1/models
   * endpoint.  Returns an empty array when the server is unreachable.
   */
  async getModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.config.endpoint}/v1/models`, {
        headers: this.authHeaders,
      });
      if (!res.ok) return [];
      const data = (await res.json()) as ModelListResponse;
      return data.data?.map((m) => m.id) ?? [];
    } catch (err) {
      logWarn('[CodeBuddyAdapter] getModels failed:', err);
      return [];
    }
  }

  // ---- Abort ------------------------------------------------------------------

  /** Cancels any in-flight streaming request. */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _adapter: CodeBuddyAdapter | null = null;

/**
 * Returns the shared CodeBuddyAdapter singleton.
 *
 * Pass `config` on the first call to initialise the adapter.
 * Subsequent calls without `config` return the existing instance.
 * Passing a new `config` replaces the singleton (e.g. after settings change).
 */
export function getCodeBuddyAdapter(config?: CodeBuddyConfig): CodeBuddyAdapter {
  if (config) {
    if (_adapter) {
      _adapter.abort();
    }
    _adapter = new CodeBuddyAdapter(config);
  }
  if (!_adapter) {
    throw new Error(
      '[getCodeBuddyAdapter] adapter not yet initialised — pass a CodeBuddyConfig on first call',
    );
  }
  return _adapter;
}

/** Resets the singleton (primarily for testing). */
export function resetCodeBuddyAdapter(): void {
  _adapter?.abort();
  _adapter = null;
}
