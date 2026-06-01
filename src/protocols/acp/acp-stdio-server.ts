/**
 * ACP (Agent Client Protocol) stdio server — editor integration.
 *
 * This is the **Zed Agent Client Protocol** (https://agentclientprotocol.com):
 * a code editor (the *client*) spawns Code Buddy as a subprocess and exchanges
 * JSON-RPC 2.0 messages over **newline-delimited JSON on stdio**. It is distinct
 * from Code Buddy's internal `src/acp/protocol.ts` (agent message router) and the
 * HTTP "Agent Communication Protocol" in `src/protocols/acp/acp-server.ts`.
 *
 * Implemented methods (grounded in the published spec):
 * - `initialize`        → capability negotiation (integer protocolVersion).
 * - `session/new`       → `{ sessionId }`.
 * - `session/list`      → discovers in-process sessions, optionally filtered
 *                         by `cwd`.
 * - `session/load`      → resumes an in-process session and replays streamed
 *                         history (`session/update` notifications).
 * - `session/prompt`    → runs the injected prompt runner, streaming
 *                         `session/update` (`agent_message_chunk`) notifications,
 *                         resolving to `{ stopReason }`.
 * - `session/cancel`    → notification; aborts the active turn (→ `cancelled`).
 * - Agent→client calls  → prompt runners can call client methods such as
 *                         `fs/read_text_file` or `session/request_permission`
 *                         and await the JSON-RPC response. Optional client
 *                         methods are gated by `initialize.clientCapabilities`;
 *                         unknown methods fail closed.
 *
 * The transport + protocol layer is deliberate-and-tested; the `promptRunner`
 * is injected so the CLI wires the real agent while tests drive a deterministic
 * runner. Out of scope for v1 (documented, not stubbed): full tool-using turns
 * backed by client `fs/*` + `session/request_permission`, and MCP passthrough.
 */

import { randomUUID } from 'crypto';
import type { Readable, Writable } from 'node:stream';

export const ACP_PROTOCOL_VERSION = 1;

export interface AcpContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export type AcpStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled';

export interface AcpSessionUpdate {
  sessionUpdate: string;
  [key: string]: unknown;
}

export interface AcpClientCapabilities {
  fs?: {
    readTextFile?: boolean;
    writeTextFile?: boolean;
  };
  terminal?: boolean;
  [key: string]: unknown;
}

export interface AcpPromptContext {
  sessionId: string;
  cwd: string;
  clientCapabilities: AcpClientCapabilities;
  canRequestClient: (method: string) => boolean;
  prompt: AcpContentBlock[];
  signal: AbortSignal;
  requestClient: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  sendUpdate: (update: AcpSessionUpdate) => void;
}

export type AcpPromptRunner = (ctx: AcpPromptContext) => Promise<{ stopReason: AcpStopReason }>;

export interface AcpAgentInfo {
  name: string;
  title?: string;
  version: string;
}

export interface AcpStdioServerOptions {
  promptRunner: AcpPromptRunner;
  /** Defaults to process.stdin. */
  input?: Readable;
  /** Defaults to process.stdout. */
  output?: Writable;
  agentInfo?: AcpAgentInfo;
  /** Defaults to 120s; set to 0 to disable. */
  clientRequestTimeoutMs?: number;
  protocolVersion?: number;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface AcpSession {
  cwd: string;
  active: AbortController | null;
  history: AcpSessionUpdate[];
  title?: string;
  updatedAt: string;
}

interface PendingClientRequest {
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
  signal?: AbortSignal;
  timeout?: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export class AcpStdioServer {
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly promptRunner: AcpPromptRunner;
  private readonly agentInfo: AcpAgentInfo;
  private readonly protocolVersion: number;
  private readonly clientRequestTimeoutMs: number;
  private readonly sessions = new Map<string, AcpSession>();
  private readonly pendingClientRequests = new Map<string, PendingClientRequest>();
  private clientCapabilities: AcpClientCapabilities = {};
  private nextClientRequestId = 0;
  private buffer = '';
  private started = false;
  private readonly onData = (chunk: Buffer | string): void => this.ingest(chunk);

  constructor(options: AcpStdioServerOptions) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.promptRunner = options.promptRunner;
    this.agentInfo = options.agentInfo ?? { name: 'Code Buddy', title: 'Code Buddy', version: '1.0.0' };
    this.protocolVersion = options.protocolVersion ?? ACP_PROTOCOL_VERSION;
    this.clientRequestTimeoutMs = options.clientRequestTimeoutMs ?? 120_000;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.input.setEncoding?.('utf8');
    this.input.on('data', this.onData);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.input.off?.('data', this.onData);
    this.abortActiveSessions();
    this.rejectPendingClientRequests('ACP server stopped.');
  }

  private ingest(chunk: Buffer | string): void {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) void this.handleLine(line);
    }
  }

  private write(message: Record<string, unknown>): void {
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  private sendUpdate(sessionId: string, update: AcpSessionUpdate, options: { record?: boolean } = {}): void {
    if (options.record !== false) {
      this.sessions.get(sessionId)?.history.push(update);
    }
    this.write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } });
  }

  private requestClient(
    method: string,
    params: Record<string, unknown> = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    if (!this.canRequestClient(method)) {
      return Promise.reject(this.createClientRequestError(
        `ACP client method is not advertised by initialize.clientCapabilities: ${method}`,
        -32601,
      ));
    }

    const id = `codebuddy-${++this.nextClientRequestId}`;
    const signal = options.signal;

    if (signal?.aborted) {
      return Promise.reject(this.createClientRequestError('ACP client request aborted.'));
    }

    return new Promise((resolve, reject) => {
      const pending: PendingClientRequest = {
        resolve,
        reject,
        signal,
      };
      pending.onAbort = () => {
        this.pendingClientRequests.delete(id);
        if (pending.timeout) clearTimeout(pending.timeout);
        reject(this.createClientRequestError('ACP client request aborted.'));
      };
      if (this.clientRequestTimeoutMs > 0) {
        pending.timeout = setTimeout(() => {
          this.pendingClientRequests.delete(id);
          if (pending.onAbort) signal?.removeEventListener('abort', pending.onAbort);
          reject(this.createClientRequestError(
            `ACP client request timed out after ${this.clientRequestTimeoutMs}ms: ${method}`,
            -32000,
          ));
        }, this.clientRequestTimeoutMs);
      }
      signal?.addEventListener('abort', pending.onAbort, { once: true });
      this.pendingClientRequests.set(id, pending);
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  private async handleLine(line: string): Promise<void> {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }

    const id = msg.id;
    const isRequest = id !== undefined && id !== null;
    const method = msg.method;
    const params = (msg.params ?? {}) as Record<string, unknown>;

    if (isRequest && typeof method !== 'string' && ('result' in msg || 'error' in msg)) {
      this.handleClientResponse(String(id), msg);
      return;
    }

    // `session/cancel` is a notification (no response).
    if (method === 'session/cancel') {
      this.handleCancel(params);
      return;
    }

    if (!isRequest || typeof method !== 'string') {
      // Ignore other notifications and any client responses.
      return;
    }

    try {
      const result = await this.dispatch(method, params);
      this.write({ jsonrpc: '2.0', id, result });
    } catch (err) {
      const error = err as { code?: number; message?: string };
      this.write({
        jsonrpc: '2.0',
        id,
        error: { code: error.code ?? -32603, message: error.message ?? String(err) },
      });
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.handleInitialize(params);
      case 'session/new':
        return this.handleNewSession(params);
      case 'session/list':
        return this.handleListSessions(params);
      case 'session/load':
        return this.handleLoadSession(params);
      case 'session/prompt':
        return this.handlePrompt(params);
      default: {
        const error = new Error(`Method not found: ${method}`) as Error & { code?: number };
        error.code = -32601;
        throw error;
      }
    }
  }

  private handleInitialize(params: Record<string, unknown>): unknown {
    this.clientCapabilities = normalizeClientCapabilities(params.clientCapabilities);
    return {
      protocolVersion: this.protocolVersion,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        mcpCapabilities: { http: false, sse: false },
        sessionCapabilities: { list: {} },
      },
      agentInfo: this.agentInfo,
      authMethods: [],
    };
  }

  private handleNewSession(params: Record<string, unknown>): unknown {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      cwd: asString(params.cwd) ?? process.cwd(),
      active: null,
      history: [],
      updatedAt: new Date().toISOString(),
    });
    return { sessionId };
  }

  private handleListSessions(params: Record<string, unknown>): unknown {
    if (params.cursor !== undefined) {
      const error = new Error('Invalid or unsupported session/list cursor') as Error & { code?: number };
      error.code = -32602;
      throw error;
    }

    const cwd = asString(params.cwd);
    const sessions = [...this.sessions.entries()]
      .filter(([, session]) => !cwd || session.cwd === cwd)
      .map(([sessionId, session]) => ({
        sessionId,
        cwd: session.cwd,
        ...(session.title ? { title: session.title } : {}),
        updatedAt: session.updatedAt,
        _meta: {
          messageCount: session.history.length,
          active: session.active !== null,
        },
      }));

    return { sessions };
  }

  private handleLoadSession(params: Record<string, unknown>): unknown {
    const sessionId = asString(params.sessionId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!sessionId || !session) {
      const error = new Error('Unknown or missing sessionId') as Error & { code?: number };
      error.code = -32602;
      throw error;
    }
    if (session.active) {
      const error = new Error('Session has an active prompt; cancel or wait before loading') as Error & { code?: number };
      error.code = -32000;
      throw error;
    }

    const cwd = asString(params.cwd);
    if (cwd) session.cwd = cwd;

    for (const update of session.history) {
      this.sendUpdate(sessionId, update, { record: false });
    }

    return { configOptions: null, modes: null };
  }

  private async handlePrompt(params: Record<string, unknown>): Promise<unknown> {
    const sessionId = asString(params.sessionId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!sessionId || !session) {
      const error = new Error('Unknown or missing sessionId') as Error & { code?: number };
      error.code = -32602;
      throw error;
    }
    if (session.active) {
      const error = new Error('Session already has an active prompt') as Error & { code?: number };
      error.code = -32000;
      throw error;
    }

    const prompt = Array.isArray(params.prompt) ? (params.prompt as AcpContentBlock[]) : [];
    const controller = new AbortController();
    session.active = controller;

    try {
      session.updatedAt = new Date().toISOString();
      const { stopReason } = await this.promptRunner({
        sessionId,
        cwd: session.cwd,
        clientCapabilities: this.clientCapabilities,
        canRequestClient: (method) => this.canRequestClient(method),
        prompt,
        signal: controller.signal,
        requestClient: (method, requestParams = {}) => this.requestClient(method, requestParams, {
          signal: controller.signal,
        }),
        sendUpdate: (update) => this.sendUpdate(sessionId, update),
      });
      if (!session.title) {
        session.title = buildSessionTitle(prompt);
      }
      session.updatedAt = new Date().toISOString();
      return { stopReason: controller.signal.aborted ? 'cancelled' : stopReason };
    } catch (err) {
      if (controller.signal.aborted) return { stopReason: 'cancelled' };
      throw err;
    } finally {
      session.active = null;
    }
  }

  private handleCancel(params: Record<string, unknown>): void {
    const sessionId = asString(params.sessionId);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    session?.active?.abort();
  }

  private abortActiveSessions(): void {
    for (const session of this.sessions.values()) {
      session.active?.abort();
    }
  }

  private handleClientResponse(id: string, msg: JsonRpcMessage): void {
    const pending = this.pendingClientRequests.get(id);
    if (!pending) return;

    this.pendingClientRequests.delete(id);
    if (pending.timeout) clearTimeout(pending.timeout);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener('abort', pending.onAbort);
    }

    if (msg.error) {
      pending.reject(this.createClientRequestError(
        msg.error.message ?? 'ACP client request failed.',
        msg.error.code,
        msg.error.data,
      ));
      return;
    }

    pending.resolve(msg.result ?? null);
  }

  private rejectPendingClientRequests(message: string): void {
    for (const [id, pending] of this.pendingClientRequests) {
      this.pendingClientRequests.delete(id);
      if (pending.timeout) clearTimeout(pending.timeout);
      if (pending.signal && pending.onAbort) {
        pending.signal.removeEventListener('abort', pending.onAbort);
      }
      pending.reject(this.createClientRequestError(message));
    }
  }

  private createClientRequestError(message: string, code?: number, data?: unknown): Error {
    const error = new Error(message) as Error & { code?: number; data?: unknown };
    if (code !== undefined) error.code = code;
    if (data !== undefined) error.data = data;
    return error;
  }

  private canRequestClient(method: string): boolean {
    if (method === 'session/request_permission') return true;
    if (method === 'fs/read_text_file') return this.clientCapabilities.fs?.readTextFile === true;
    if (method === 'fs/write_text_file') return this.clientCapabilities.fs?.writeTextFile === true;
    if (method.startsWith('terminal/')) return this.clientCapabilities.terminal === true;
    return false;
  }
}

function normalizeClientCapabilities(value: unknown): AcpClientCapabilities {
  const input = asRecord(value);
  if (!input) return {};
  const fsCapabilities = asRecord(input.fs);
  return {
    ...input,
    fs: fsCapabilities
      ? {
        ...fsCapabilities,
        readTextFile: fsCapabilities.readTextFile === true,
        writeTextFile: fsCapabilities.writeTextFile === true,
      }
      : undefined,
    terminal: input.terminal === true,
  };
}

function buildSessionTitle(prompt: AcpContentBlock[]): string | undefined {
  const firstText = prompt
    .find((block) => block.type === 'text' && typeof block.text === 'string')
    ?.text
    ?.replace(/\s+/g, ' ')
    .trim();
  if (!firstText) return undefined;
  return firstText.length > 80 ? `${firstText.slice(0, 77)}...` : firstText;
}
