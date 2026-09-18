import { createHash, randomUUID } from 'crypto';

import {
  createServerAgent,
  type ServerAgent,
  type ServerConversationState,
} from './agent-adapter.js';
import { ApiServerError } from './middleware/index.js';

const DEFAULT_HTTP_SESSION_STATE_MAX = 50;
const MAX_SESSION_ID_LENGTH = 512;

interface StoredConversationState {
  state: ServerConversationState;
  lastUsed: number;
}

type StatefulServerAgent = ServerAgent & Required<Pick<
  ServerAgent,
  'exportConversationState' | 'importConversationState' | 'setRecoverySessionId'
>>;

const conversationStates = new Map<string, StoredConversationState>();
let serverAgentPromise: Promise<StatefulServerAgent> | null = null;
let neutralConversationState: ServerConversationState | null = null;
let globalTurnTail: Promise<void> = Promise.resolve();
let useSequence = 0;

function conversationStateMax(): number {
  const configured = Number(process.env.CODEBUDDY_HTTP_AGENT_CACHE_MAX);
  return Number.isInteger(configured) && configured > 0
    ? Math.min(configured, 500)
    : DEFAULT_HTTP_SESSION_STATE_MAX;
}

function normalizedSessionId(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'default';
  if (typeof value !== 'string') {
    throw ApiServerError.badRequest('sessionId must be a string when provided');
  }
  const normalized = value.trim();
  if (!normalized) return 'default';
  if (normalized.length > MAX_SESSION_ID_LENGTH) {
    throw ApiServerError.badRequest(
      `sessionId must not exceed ${MAX_SESSION_ID_LENGTH} characters`,
    );
  }
  return normalized;
}

/**
 * Build an opaque agent/recovery scope from both tenant and conversation.
 * Raw principals and client session IDs never become cache or disk path names.
 */
export function buildHttpAgentSessionKey(principal: string, sessionId: unknown): string {
  const normalizedPrincipal = principal.trim() || 'anonymous';
  const normalizedSession = normalizedSessionId(sessionId);
  const digest = createHash('sha256')
    .update('codebuddy-http-agent-session-v1\0')
    .update(normalizedPrincipal)
    .update('\0')
    .update(normalizedSession)
    .digest('hex');
  return `api:agent:${digest}`;
}

export interface HttpRequestIdentity {
  auth?: {
    userId?: string;
    keyId?: string;
  };
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
}

/** Bind anonymous conversations to their network principal, not one global tenant. */
export function buildHttpRequestSessionKey(
  request: HttpRequestIdentity,
  sessionId: unknown,
): string {
  const principal = request.auth?.userId
    ? `user:${request.auth.userId}`
    : request.auth?.keyId
      ? `key:${request.auth.keyId}`
      : `anonymous:${request.ip || request.socket?.remoteAddress || 'unknown'}`;
  // A missing extension must not silently opt unrelated requests into one
  // durable "default" conversation. Explicit IDs retain continuity; absent
  // or blank IDs get an opaque request scope and are therefore stateless.
  const isRequestScoped =
    sessionId === undefined ||
    sessionId === null ||
    (typeof sessionId === 'string' && sessionId.trim().length === 0);
  if (!isRequestScoped) {
    return buildHttpAgentSessionKey(principal, sessionId);
  }

  const digest = createHash('sha256')
    .update('codebuddy-http-request-session-v1\0')
    .update(principal)
    .update('\0')
    .update(randomUUID())
    .digest('hex');
  return `api:request:${digest}`;
}

function isPersistentSessionKey(sessionKey: string): boolean {
  return sessionKey.startsWith('api:agent:');
}

function cloneConversationState(state: ServerConversationState): ServerConversationState {
  return structuredClone(state);
}

function requireStatefulAgent(agent: ServerAgent): StatefulServerAgent {
  if (
    typeof agent.exportConversationState !== 'function' ||
    typeof agent.importConversationState !== 'function' ||
    typeof agent.setRecoverySessionId !== 'function'
  ) {
    throw ApiServerError.internal(
      'HTTP agent does not support isolated conversation state',
    );
  }
  return agent as StatefulServerAgent;
}

async function getServerAgent(): Promise<StatefulServerAgent> {
  if (!serverAgentPromise) {
    const pending = Promise.resolve()
      .then(() => createServerAgent())
      .then((agent) => {
        try {
          const statefulAgent = requireStatefulAgent(agent);
          neutralConversationState = cloneConversationState(
            statefulAgent.exportConversationState(),
          );
          return statefulAgent;
        } catch (error) {
          agent.dispose?.();
          throw error;
        }
      });
    serverAgentPromise = pending;
    void pending.catch(() => {
      if (serverAgentPromise === pending) serverAgentPromise = null;
    });
  }
  return serverAgentPromise;
}

function evictConversationStates(): void {
  const limit = conversationStateMax();
  while (conversationStates.size > limit) {
    let oldestKey: string | undefined;
    let oldestUse = Number.POSITIVE_INFINITY;
    for (const [key, entry] of conversationStates) {
      if (entry.lastUsed < oldestUse) {
        oldestUse = entry.lastUsed;
        oldestKey = key;
      }
    }
    if (!oldestKey) return;
    conversationStates.delete(oldestKey);
  }
}

export interface HttpConversationSeedMessage {
  role?: unknown;
  content?: unknown;
}

export interface WithHttpSessionAgentOptions {
  /**
   * Drop cached chat history and re-apply seedMessages. Shared sessions
   * persist on disk; another participant may have appended turns since
   * this cache entry was written.
   */
  replaceHistory?: boolean;
}

function invalidateServerAgent(agent: StatefulServerAgent): void {
  serverAgentPromise = null;
  neutralConversationState = null;
  try {
    agent.dispose?.();
  } catch {
    // The agent is already retired. Disposal must not hide the isolation error.
  }
}

/**
 * Serialize every HTTP agent turn through one host agent. Conversation state
 * and raw-recovery scope are swapped only while the global mutex is held, so
 * constructor-global delegate/verify providers can never point at another
 * tenant's agent.
 */
export async function withHttpSessionAgent<T>(
  sessionKey: string,
  operation: (agent: ServerAgent) => Promise<T>,
  seedMessages: ReadonlyArray<HttpConversationSeedMessage> = [],
  options: WithHttpSessionAgentOptions = {},
): Promise<T> {
  const run = globalTurnTail.then(async () => {
    const agent = await getServerAgent();
    const neutralState = neutralConversationState;
    if (!neutralState) {
      invalidateServerAgent(agent);
      throw ApiServerError.internal('HTTP agent neutral state is unavailable');
    }
    const persistent = isPersistentSessionKey(sessionKey);
    const stored = persistent ? conversationStates.get(sessionKey) : undefined;
    const state = cloneConversationState(stored?.state ?? neutralState);
    const replaceHistory = options.replaceHistory === true;
    if (replaceHistory) {
      state.messages = [];
      state.chatHistory = [];
    }
    if (!stored) {
      // The manager's archive/snapshot namespace is conversation-owned too.
      // Never let two cold sessions inherit the neutral agent's constructor ID.
      state.contextManagerState.sessionId = sessionKey;
    }
    let setupCompleted = false;
    let operationFailed = false;
    let operationError: unknown;
    let operationResult!: T;

    try {
      agent.importConversationState(state);
      agent.setRecoverySessionId(sessionKey);

      const shouldSeed = seedMessages.length > 0 && (replaceHistory || !stored);
      if (shouldSeed) {
        if (typeof agent.addToHistory !== 'function') {
          throw ApiServerError.internal(
            'HTTP agent does not support conversation seeding',
          );
        }
        for (const message of seedMessages) {
          if (
            (message.role === 'system' || message.role === 'user' || message.role === 'assistant') &&
            typeof message.content === 'string'
          ) {
            agent.addToHistory({
              role: message.role,
              content: message.content,
            });
          }
        }
      }

      setupCompleted = true;
      operationResult = await operation(agent);
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }

    let cleanupError: ApiServerError | null = null;
    if (setupCompleted && !operationFailed && persistent) {
      try {
        const exported = cloneConversationState(agent.exportConversationState());
        conversationStates.set(sessionKey, {
          state: exported,
          lastUsed: ++useSequence,
        });
        evictConversationStates();
      } catch {
        cleanupError = ApiServerError.internal(
          'Failed to export isolated HTTP conversation state',
        );
      }
    }

    try {
      agent.importConversationState(cloneConversationState(neutralState));
    } catch {
      cleanupError ??= ApiServerError.internal(
        'Failed to restore neutral HTTP agent state',
      );
    }

    try {
      agent.setRecoverySessionId(undefined);
    } catch {
      cleanupError ??= ApiServerError.internal('Failed to clear HTTP recovery scope');
    }

    // A failed or abandoned turn can mutate state that is not part of the
    // explicit conversation snapshot (provider caches, tool instances, plugin
    // globals). Retire the host before another tenant can use it.
    if (cleanupError || !setupCompleted || operationFailed) invalidateServerAgent(agent);
    if (cleanupError) throw cleanupError;
    if (operationFailed) throw operationError;
    return operationResult;
  });
  globalTurnTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Test-only deterministic cleanup for the module-scoped agent and LRU. */
export async function __resetHttpAgentSessionCacheForTests(): Promise<void> {
  await globalTurnTail.catch(() => undefined);
  const pending = serverAgentPromise;
  serverAgentPromise = null;
  neutralConversationState = null;
  conversationStates.clear();
  useSequence = 0;
  globalTurnTail = Promise.resolve();
  if (pending) {
    try {
      const agent = await pending;
      agent.dispose?.();
    } catch {
      // Failed creation already released its resources.
    }
  }
}

export function __getHttpAgentSessionCacheSizeForTests(): number {
  return conversationStates.size;
}
