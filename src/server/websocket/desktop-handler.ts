/**
 * Desktop WebSocket Endpoint (`/desktop`)
 *
 * A dedicated WebSocket endpoint that lets the Cowork desktop GUI use this
 * Code Buddy server as a REMOTE backend for the conversational core only —
 * chat, sessions and real-time stream events. Management surfaces
 * (config / mcp / skills / fleet) are intentionally out of scope here.
 *
 * The wire protocol is the one Cowork already speaks (see
 * `cowork/src/renderer/types/index.ts`):
 *   - inbound frames are raw `ClientEvent` objects (`{ type, payload }`)
 *   - outbound frames are raw `ServerEvent` objects (`{ type, payload }`)
 *
 * Only the chat/session core subset of `ClientEvent` is accepted
 * (mirrors the preload allowlist): `session.start`, `session.continue`,
 * `session.stop`, `session.list`.
 *
 * Auth is enforced at the HTTP upgrade handshake (JWT bearer token via
 * `?token=` query or `Authorization: Bearer` header) plus origin hardening,
 * NOT as a post-connect message — a connection that reaches `connection`
 * is already authenticated. Loopback binding is the server default.
 *
 * This endpoint runs as a `noServer` WebSocketServer wired through a single
 * prepended `upgrade` listener that only claims the `/desktop` path, leaving
 * the existing `/ws` handler completely untouched.
 *
 * The agent execution itself is delegated to the existing root infra
 * (`createServerAgent()` → `CodeBuddyAgent.processUserMessageStream`); this
 * module only maps the agent's `StreamingChunk`s to Cowork `ServerEvent`s,
 * reproducing the behaviour of `cowork/src/main/engine/codebuddy-engine-runner.ts`.
 */

import { randomUUID } from 'crypto';
import { readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import type { WebSocket, WebSocketServer } from 'ws';
import type { ServerConfig } from '../types.js';
import type { JwtPayload } from '../types.js';
import { isOriginAllowed } from '../origin-check.js';
import { verifyToken } from '../auth/jwt.js';
import { isDirectLoopbackRequest } from '../middleware/auth.js';
import { logger } from '../../utils/logger.js';
import {
  parseContextOptimizationMetadata,
  type ContextOptimizationMetadata,
} from '../../shared/context-optimization-metadata.js';
import { createServerAgent, type ServerAgent } from '../agent-adapter.js';
import { getConnectionStats } from './handler.js';

/** Path the desktop endpoint listens on. */
export const DESKTOP_WS_PATH = '/desktop';

/**
 * Cowork session status values (`cowork/src/renderer/types` SessionStatus).
 * There is no `'done'` value — `idle` is the terminal state the reference
 * engine-runner emits once a turn finishes; `stream.done` is the separate
 * stream-completion signal.
 */
type CoworkSessionStatus = 'idle' | 'running' | 'completed' | 'error';

/** Minimal Cowork content-block shapes we produce on the assistant message. */
interface TextBlock {
  type: 'text';
  text: string;
}
interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
  contextOptimization?: ContextOptimizationMetadata;
}
type CoworkContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

/** Cowork `Message` shape (subset we populate). */
interface CoworkMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: CoworkContentBlock[];
  timestamp: number;
}

/** Cowork `Session` shape (subset we populate for `session.list`). */
interface CoworkSession {
  id: string;
  title: string;
  status: CoworkSessionStatus;
  cwd?: string;
  mountedPaths: never[];
  allowedTools: string[];
  memoryEnabled: boolean;
  model?: string;
  intelligence?: {
    thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    fastMode: boolean;
    executionLocation: 'cloud';
    latencyBudgetMs: number;
    cacheState: 'unknown';
  };
  projectId?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Cowork `TraceStep` shape (subset). */
interface TraceStep {
  id: string;
  type: 'thinking' | 'text' | 'tool_call' | 'tool_result';
  status: 'pending' | 'running' | 'completed' | 'error';
  title: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  isError?: boolean;
  timestamp: number;
  duration?: number;
}

/**
 * Outbound `ServerEvent`s this endpoint emits. Intentionally a subset of
 * the full Cowork `ServerEvent` union — the chat/session core only.
 */
export type DesktopServerEvent =
  | { type: 'stream.partial'; payload: { sessionId: string; delta: string } }
  | { type: 'stream.thinking'; payload: { sessionId: string; delta: string } }
  | { type: 'stream.message'; payload: { sessionId: string; message: CoworkMessage } }
  | { type: 'stream.done'; payload: { sessionId: string } }
  | { type: 'session.status'; payload: { sessionId: string; status: CoworkSessionStatus; error?: string } }
  | { type: 'session.update'; payload: { sessionId: string; updates: Partial<CoworkSession> } }
  | { type: 'session.list'; payload: { sessions: CoworkSession[] } }
  | { type: 'trace.step'; payload: { sessionId: string; step: TraceStep } }
  | { type: 'trace.update'; payload: { sessionId: string; stepId: string; updates: Partial<TraceStep> } }
  | { type: 'control.result'; payload: { requestId: string; ok: boolean; result?: unknown; error?: string } }
  | { type: 'error'; payload: { message: string; sessionId?: string } };

/** Inbound chat-core `ClientEvent`s this endpoint accepts. */
const ACCEPTED_CLIENT_EVENTS = new Set<string>([
  'session.start',
  'session.continue',
  'session.stop',
  'session.list',
  'control.describe',
  'control.invoke',
]);

const CONTROL_CAPABILITIES = [
  'system.snapshot',
  'skills.list',
  'fleet.status',
] as const;

function listSkillNames(): string[] {
  const roots = [join(homedir(), '.codebuddy', 'skills'), join(process.cwd(), '.codebuddy', 'skills')];
  const names = new Set<string>();
  for (const root of roots) {
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) names.add(entry.name);
      }
    } catch {
      // An absent skills directory is a valid empty state.
    }
  }
  return [...names].sort();
}

function controlResult(method: string): unknown {
  switch (method) {
    case 'system.snapshot':
      return {
        node: process.version,
        platform: process.platform,
        uptimeSeconds: Math.round(process.uptime()),
        memory: process.memoryUsage(),
        desktopClients: desktopConnections.size,
      };
    case 'skills.list':
      return { skills: listSkillNames() };
    case 'fleet.status':
      return getConnectionStats();
    default:
      throw new Error(`control capability not allowed: ${method}`);
  }
}

/** Per-connection runtime state. */
interface DesktopConnectionState {
  id: string;
  userId: string;
  /** Per-session agent + bookkeeping, keyed by Cowork sessionId. */
  sessions: Map<string, DesktopSessionRuntime>;
}

interface DesktopSessionRuntime {
  session: CoworkSession;
  agent?: ServerAgent;
  agentInitializing?: Promise<void>;
  /** Set false to break the active stream loop on `session.stop`. */
  running: boolean;
}

/** Active desktop connections (separate map from the `/ws` handler). */
const desktopConnections = new Map<WebSocket, DesktopConnectionState>();

type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/** The active desktop WebSocketServer, kept for graceful shutdown. */
let desktopWss: WebSocketServer | null = null;
/** The single routing upgrade listener we install, kept so teardown can detach it. */
let upgradeListener: UpgradeListener | null = null;
/** Upgrade listeners that existed before us (i.e. the `/ws` handler's), delegated to for non-`/desktop` paths. */
let priorUpgradeListeners: UpgradeListener[] = [];
let boundServer: HttpServer | null = null;

/** Send a `ServerEvent` to a desktop client (no-op if socket closed). */
function sendEvent(ws: WebSocket, event: DesktopServerEvent): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

/** Resolve the allowed origin list from the server config. */
function resolveAllowedOrigins(config: ServerConfig): string[] {
  if (Array.isArray(config.corsOrigins)) return config.corsOrigins;
  if (typeof config.corsOrigins === 'string') return config.corsOrigins.split(',');
  return [];
}

/**
 * Extract the bearer token from the upgrade request. Accepts both the
 * `Authorization: Bearer <token>` header and a `?token=<token>` query
 * param (browsers can't set WS headers, so the query form is the practical
 * path for the Cowork renderer).
 */
function extractToken(req: IncomingMessage): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const queryToken = url.searchParams.get('token');
    if (queryToken) return queryToken;
  } catch {
    /* malformed URL — fall through to undefined */
  }
  return undefined;
}

/**
 * Authenticate + origin-check an upgrade request for `/desktop`. Returns the
 * decoded JWT payload on success, or a reason string on rejection.
 */
function authenticateUpgrade(
  req: IncomingMessage,
  config: ServerConfig
): { ok: true; payload: JwtPayload } | { ok: false; status: number; reason: string } {
  // Origin hardening: browser clients must present an allowed origin; non-browser
  // clients (no Origin header) are allowed through to the token check.
  const origin = req.headers.origin;
  if (origin) {
    const allowed = resolveAllowedOrigins(config);
    if (!allowed.includes('*') && !isOriginAllowed(origin, allowed)) {
      return { ok: false, status: 403, reason: `disallowed origin: ${origin}` };
    }
  }

  // When auth is disabled (dev only), accept with a synthetic identity.
  if (!config.authEnabled) {
    if (!isDirectLoopbackRequest(req.socket.remoteAddress, req.headers)) {
      return {
        ok: false,
        status: 403,
        reason: 'anonymous desktop access is local-only',
      };
    }
    return { ok: true, payload: { sub: 'local-dev', scopes: ['chat'] } as JwtPayload };
  }

  const secret = config.jwtSecret || process.env.JWT_SECRET;
  if (!secret) {
    return { ok: false, status: 500, reason: 'server JWT not configured' };
  }

  const token = extractToken(req);
  if (!token) {
    return { ok: false, status: 401, reason: 'missing token' };
  }

  const decoded = verifyToken(token, secret);
  if (!decoded) {
    return { ok: false, status: 401, reason: 'invalid token' };
  }

  const scopes = decoded.scopes ?? [];
  if (scopes.length > 0 && !scopes.includes('chat') && !scopes.includes('admin')) {
    return { ok: false, status: 403, reason: 'chat scope required' };
  }

  return { ok: true, payload: decoded };
}

/** Lazily create (and cache) the agent for a session runtime. */
async function ensureAgent(runtime: DesktopSessionRuntime): Promise<ServerAgent> {
  if (runtime.agent) return runtime.agent;
  if (!runtime.agentInitializing) {
    runtime.agentInitializing = (async () => {
      try {
        runtime.agent = await createServerAgent();
      } catch (err) {
        runtime.agentInitializing = undefined;
        throw err;
      }
    })();
  }
  await runtime.agentInitializing;
  if (!runtime.agent) {
    throw new Error('Agent initialization failed');
  }
  return runtime.agent;
}

/** Try to parse a JSON string, returning a `{ raw }` wrapper on failure. */
function tryParseJSON(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { raw: value };
  } catch {
    return { raw: value };
  }
}

/**
 * Run one agent turn for `prompt` against `runtime` and map the agent's
 * `StreamingChunk`s to Cowork `ServerEvent`s on `ws`. Mirrors
 * `codebuddy-engine-runner.run()`.
 */
async function runTurn(
  ws: WebSocket,
  runtime: DesktopSessionRuntime,
  prompt: string
): Promise<void> {
  const sessionId = runtime.session.id;
  runtime.running = true;

  sendEvent(ws, { type: 'session.status', payload: { sessionId, status: 'running' } });

  let fullContent = '';
  let runtimeError: string | null = null;
  const contentBlocks: CoworkContentBlock[] = [];

  try {
    const agent = await ensureAgent(runtime);

    for await (const chunk of agent.processUserMessageStream(prompt)) {
      if (!runtime.running) break;

      switch (chunk.type) {
        case 'content':
          if (chunk.content) {
            fullContent += chunk.content;
            sendEvent(ws, { type: 'stream.partial', payload: { sessionId, delta: chunk.content } });
          }
          break;

        case 'reasoning':
          if (chunk.reasoning) {
            sendEvent(ws, { type: 'stream.thinking', payload: { sessionId, delta: chunk.reasoning } });
          }
          break;

        case 'tool_calls':
          if (chunk.toolCalls) {
            for (const call of chunk.toolCalls) {
              const input =
                typeof call.function?.arguments === 'string'
                  ? tryParseJSON(call.function.arguments)
                  : {};
              sendEvent(ws, {
                type: 'trace.step',
                payload: {
                  sessionId,
                  step: {
                    id: call.id,
                    type: 'tool_call',
                    status: 'running',
                    title: call.function?.name ?? 'tool',
                    toolName: call.function?.name,
                    toolInput: input,
                    timestamp: Date.now(),
                  },
                },
              });
              contentBlocks.push({
                type: 'tool_use',
                id: call.id,
                name: call.function?.name ?? 'tool',
                input,
              });
            }
          }
          break;

        case 'tool_result':
          if (chunk.toolCall) {
            const isError = chunk.toolResult ? !chunk.toolResult.success : false;
            const output = chunk.toolResult?.output ?? chunk.toolResult?.error ?? '';
            const contextOptimization = parseContextOptimizationMetadata(
              chunk.toolResult?.metadata?.contextOptimization,
            );
            sendEvent(ws, {
              type: 'trace.update',
              payload: {
                sessionId,
                stepId: chunk.toolCall.id,
                updates: {
                  status: isError ? 'error' : 'completed',
                  toolOutput: output,
                  isError,
                  duration: 0,
                },
              },
            });
            contentBlocks.push({
              type: 'tool_result',
              toolUseId: chunk.toolCall.id,
              content: output,
              isError,
              ...(contextOptimization ? { contextOptimization } : {}),
            });
          }
          break;

        // Streaming-only chunks with no Cowork core mapping are dropped.
        case 'token_count':
        case 'tool_stream':
        case 'ask_user':
        case 'plan_progress':
        case 'steer':
        case 'diff_preview':
        case 'run_event':
        case 'done':
        default:
          break;
      }
    }

    if (runtimeError && !fullContent && contentBlocks.length === 0) {
      fullContent = `**Error**: ${runtimeError}`;
    }

    const assistantContent: CoworkContentBlock[] = [];
    if (fullContent) {
      assistantContent.push({ type: 'text', text: fullContent });
    }
    assistantContent.push(...contentBlocks);

    const assistantMessage: CoworkMessage = {
      id: randomUUID(),
      sessionId,
      role: 'assistant',
      content: assistantContent.length > 0 ? assistantContent : [{ type: 'text', text: '' }],
      timestamp: Date.now(),
    };

    sendEvent(ws, { type: 'stream.message', payload: { sessionId, message: assistantMessage } });
    sendEvent(ws, { type: 'stream.done', payload: { sessionId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[desktop-ws] turn error', { sessionId, error: message });
    sendEvent(ws, { type: 'error', payload: { message, sessionId } });
  } finally {
    runtime.running = false;
    runtime.session.updatedAt = Date.now();
    // Terminal state: reproduce the reference engine-runner (idle, not "done").
    sendEvent(ws, { type: 'session.status', payload: { sessionId, status: 'idle' } });
  }
}

/** Validate that `value` is a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Handle a `session.start` ClientEvent. */
async function handleSessionStart(
  ws: WebSocket,
  state: DesktopConnectionState,
  payload: Record<string, unknown>
): Promise<void> {
  const prompt = payload.prompt;
  if (!isNonEmptyString(prompt)) {
    sendEvent(ws, { type: 'error', payload: { message: 'session.start requires a non-empty prompt' } });
    return;
  }
  const now = Date.now();
  const session: CoworkSession = {
    id: randomUUID(),
    title: isNonEmptyString(payload.title) ? payload.title : prompt.slice(0, 60),
    status: 'idle',
    cwd: isNonEmptyString(payload.cwd) ? payload.cwd : undefined,
    mountedPaths: [],
    allowedTools: Array.isArray(payload.allowedTools)
      ? (payload.allowedTools.filter((t) => typeof t === 'string') as string[])
      : [],
    memoryEnabled: payload.memoryEnabled === true,
    intelligence: {
      thinkingLevel: 'off',
      fastMode: false,
      executionLocation: 'cloud',
      latencyBudgetMs: 900,
      cacheState: 'unknown',
    },
    projectId: typeof payload.projectId === 'string' ? payload.projectId : null,
    createdAt: now,
    updatedAt: now,
  };
  const runtime: DesktopSessionRuntime = { session, running: false };
  state.sessions.set(session.id, runtime);

  // Tell the client the canonical session id + metadata before streaming.
  sendEvent(ws, { type: 'session.update', payload: { sessionId: session.id, updates: session } });

  await runTurn(ws, runtime, prompt);
}

/** Handle a `session.continue` ClientEvent. */
async function handleSessionContinue(
  ws: WebSocket,
  state: DesktopConnectionState,
  payload: Record<string, unknown>
): Promise<void> {
  const sessionId = payload.sessionId;
  const prompt = payload.prompt;
  if (!isNonEmptyString(sessionId)) {
    sendEvent(ws, { type: 'error', payload: { message: 'session.continue requires a sessionId' } });
    return;
  }
  if (!isNonEmptyString(prompt)) {
    sendEvent(ws, {
      type: 'error',
      payload: { message: 'session.continue requires a non-empty prompt', sessionId },
    });
    return;
  }
  const runtime = state.sessions.get(sessionId);
  if (!runtime) {
    sendEvent(ws, { type: 'error', payload: { message: `unknown session: ${sessionId}`, sessionId } });
    return;
  }
  await runTurn(ws, runtime, prompt);
}

/** Handle a `session.stop` ClientEvent. */
function handleSessionStop(
  ws: WebSocket,
  state: DesktopConnectionState,
  payload: Record<string, unknown>
): void {
  const sessionId = payload.sessionId;
  if (!isNonEmptyString(sessionId)) {
    sendEvent(ws, { type: 'error', payload: { message: 'session.stop requires a sessionId' } });
    return;
  }
  const runtime = state.sessions.get(sessionId);
  if (runtime) {
    runtime.running = false;
    sendEvent(ws, { type: 'session.status', payload: { sessionId, status: 'idle' } });
  }
}

/** Handle a `session.list` ClientEvent. */
function handleSessionList(ws: WebSocket, state: DesktopConnectionState): void {
  const sessions = Array.from(state.sessions.values()).map((r) => r.session);
  sendEvent(ws, { type: 'session.list', payload: { sessions } });
}

/** Dispatch a validated inbound `ClientEvent`. */
async function dispatchClientEvent(
  ws: WebSocket,
  state: DesktopConnectionState,
  type: string,
  payload: Record<string, unknown>,
  requestId?: string,
): Promise<void> {
  switch (type) {
    case 'session.start':
      await handleSessionStart(ws, state, payload);
      break;
    case 'session.continue':
      await handleSessionContinue(ws, state, payload);
      break;
    case 'session.stop':
      handleSessionStop(ws, state, payload);
      break;
    case 'session.list':
      handleSessionList(ws, state);
      break;
    case 'control.describe':
      sendEvent(ws, {
        type: 'control.result',
        payload: {
          requestId: requestId ?? randomUUID(),
          ok: true,
          result: {
            protocol: 2,
            mode: 'capability-scoped',
            capabilities: CONTROL_CAPABILITIES,
            mutationsRequireLocalApproval: true,
          },
        },
      });
      break;
    case 'control.invoke': {
      const method = typeof payload.method === 'string' ? payload.method : '';
      try {
        const result = controlResult(method);
        sendEvent(ws, { type: 'control.result', payload: { requestId: requestId ?? randomUUID(), ok: true, result } });
      } catch (error) {
        sendEvent(ws, {
          type: 'control.result',
          payload: { requestId: requestId ?? randomUUID(), ok: false, error: error instanceof Error ? error.message : String(error) },
        });
      }
      break;
    }
    default:
      sendEvent(ws, { type: 'error', payload: { message: `unsupported event type: ${type}` } });
  }
}

/** Process a raw inbound WS frame as a `ClientEvent`. */
async function processFrame(ws: WebSocket, state: DesktopConnectionState, data: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    sendEvent(ws, { type: 'error', payload: { message: 'invalid JSON frame' } });
    return;
  }

  if (!parsed || typeof parsed !== 'object') {
    sendEvent(ws, { type: 'error', payload: { message: 'frame must be a ClientEvent object' } });
    return;
  }

  const { type, payload, requestId } = parsed as { type?: unknown; payload?: unknown; requestId?: unknown };
  if (typeof type !== 'string') {
    sendEvent(ws, { type: 'error', payload: { message: 'ClientEvent.type is required' } });
    return;
  }
  if (!ACCEPTED_CLIENT_EVENTS.has(type)) {
    sendEvent(ws, { type: 'error', payload: { message: `unsupported event type: ${type}` } });
    return;
  }
  const safePayload: Record<string, unknown> =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  try {
    await dispatchClientEvent(ws, state, type, safePayload, typeof requestId === 'string' ? requestId : undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[desktop-ws] handler error', { type, error: message });
    sendEvent(ws, { type: 'error', payload: { message } });
  }
}

/**
 * Mount the `/desktop` WebSocket endpoint on an existing HTTP server.
 *
 * Uses a `noServer` WebSocketServer behind a single `upgrade` router. The
 * existing `/ws` handler auto-attaches its OWN `upgrade` listener (via
 * `{ server, path: '/ws' }`), and Node snapshots the listener array at emit
 * time — so a merely-prepended listener cannot stop the `/ws` listener from
 * also firing and writing an HTTP/400 into an already-upgraded `/desktop`
 * socket (the classic `RSV1 must be clear` corruption). To stay
 * behaviour-preserving, we CAPTURE the prior upgrade listener(s), remove
 * them, and install one router: `/desktop` is handled here; everything else
 * (`/ws`, unknown paths) is delegated back to the captured listeners
 * byte-for-byte. Teardown restores them.
 */
export async function setupDesktopWebSocket(
  server: HttpServer,
  config: ServerConfig
): Promise<WebSocketServer> {
  const { WebSocketServer } = await import('ws');
  const wss = new WebSocketServer({ noServer: true });
  desktopWss = wss;
  boundServer = server;

  // Seize the existing upgrade routing so we can delegate to it explicitly.
  priorUpgradeListeners = server.listeners('upgrade') as UpgradeListener[];
  for (const listener of priorUpgradeListeners) {
    server.removeListener('upgrade', listener);
  }
  logger.debug(`[desktop-ws] captured ${priorUpgradeListeners.length} prior upgrade listener(s)`);

  upgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      pathname = '/';
    }

    if (pathname === DESKTOP_WS_PATH) {
      const auth = authenticateUpgrade(req, config);
      if (!auth.ok) {
        logger.warn(`[desktop-ws] rejected upgrade: ${auth.reason}`);
        socket.write(
          `HTTP/1.1 ${auth.status} ${auth.reason}\r\n` +
            'Connection: close\r\n' +
            'Content-Length: 0\r\n' +
            '\r\n'
        );
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, auth.payload);
      });
      return;
    }

    // Not ours — replay the original behaviour exactly (e.g. the /ws handler,
    // including its own verifyClient/origin/path gating and 400 for unknowns).
    for (const listener of priorUpgradeListeners) {
      listener.call(server, req, socket, head);
    }
  };
  server.on('upgrade', upgradeListener);

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, payload: JwtPayload) => {
    const state: DesktopConnectionState = {
      id: `desktop_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      userId: payload.sub,
      sessions: new Map(),
    };
    desktopConnections.set(ws, state);
    logger.info(`[desktop-ws] client connected (${state.id}, user=${state.userId})`);

    ws.on('message', (data) => {
      void processFrame(ws, state, data.toString());
    });

    ws.on('close', () => {
      for (const runtime of state.sessions.values()) {
        runtime.running = false;
      }
      desktopConnections.delete(ws);
    });

    ws.on('error', (error) => {
      logger.error(`[desktop-ws] socket error [${state.id}]`, error);
      desktopConnections.delete(ws);
    });
  });

  return wss;
}

/** Close all desktop connections and detach the upgrade listener. */
export function closeDesktopWebSocket(): void {
  for (const runtime of [...desktopConnections.values()].flatMap((s) => [...s.sessions.values()])) {
    runtime.running = false;
  }
  for (const ws of desktopConnections.keys()) {
    try {
      ws.close(1001, 'Server shutting down');
    } catch {
      /* best-effort */
    }
  }
  desktopConnections.clear();
  if (boundServer) {
    if (upgradeListener) {
      boundServer.removeListener('upgrade', upgradeListener);
    }
    // Restore the prior upgrade routing (the /ws handler) we seized at setup.
    for (const listener of priorUpgradeListeners) {
      boundServer.on('upgrade', listener);
    }
  }
  upgradeListener = null;
  priorUpgradeListeners = [];
  boundServer = null;
  if (desktopWss) {
    try {
      desktopWss.close();
    } catch {
      /* best-effort */
    }
    desktopWss = null;
  }
}

/** Active desktop connection count (test/diagnostic helper). */
export function getDesktopConnectionCount(): number {
  return desktopConnections.size;
}
