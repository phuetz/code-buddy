/**
 * Peer chat-session bridge (Phase (d).20 + d.22 / Fleet V1.2 + V1.2-saga).
 *
 * Registers `peer.chat-session.start`, `peer.chat-session.continue`,
 * and `peer.chat-session.end` on the peer-rpc registry. Adds multi-turn
 * conversational state to what `peer.chat` (d.15) and `peer.chat-stream`
 * (d.19) already do as one-shot stateless RPCs.
 *
 * State lives in-memory on the peer that hosts the LLM client AND is
 * mirrored to disk via `peer-session-store.ts` (V1.2-saga). On boot
 * `wirePeerSessionBridge()` re-hydrates sessions younger than the idle
 * TTL so a restart doesn't drop callers' conversation history. The
 * caller owns the lifecycle: open with `start`, append turns with
 * `continue`, close with `end`. Sessions also self-purge after the
 * configured idle TTL (default 30 min, override via
 * `CODEBUDDY_PEER_SESSION_IDLE_MS`).
 *
 * Concurrent `continue` calls on the same session are serialised
 * FIFO so assistant messages don't interleave. Each call reads
 * `cachedGetter()` fresh, so swapping the wired client between turns
 * works the same way it does for `peer.chat`.
 *
 * Each lifecycle event (`start` / `continue` success / `end`) also
 * emits a `fleet:chat-session:*` broadcast so `/fleet listen`
 * consumers and `/fleet history` see chat-session activity. Payloads
 * are metadata only (sessionId, turnCount, usage) — never prompt
 * content or assistant text — so a remote listener can monitor
 * activity without sniffing conversations.
 *
 * Idempotent (mirror of peer-chat-bridge): a second wire call is a no-op.
 */

import type { CodeBuddyClient, ChatOptions } from '../codebuddy/client.js';
import { registerPeerMethod, unregisterPeerMethod } from '../server/websocket/peer-rpc.js';
import {
  broadcastChatSessionEnd,
  broadcastChatSessionStart,
  broadcastChatSessionTurn,
} from '../server/websocket/fleet-bridge.js';
import { logger } from '../utils/logger.js';
import {
  getPeerSessionStore,
  type PersistedChatSession,
} from './peer-session-store.js';
import {
  DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS,
  FLEET_DISPATCH_PROFILES,
  buildDispatchSystemPrompt,
  buildHermesToolsetDescriptor,
  getDispatchToolPolicy,
  isFleetDispatchProfile,
  mergeDispatchSystemPrompt,
  normalizeDispatchProfile,
  type FleetDispatchProfile,
  type FleetHermesToolsetDescriptor,
  type FleetDispatchToolDecision,
  type FleetDispatchToolPolicy,
} from './dispatch-profile.js';

/** Closure that returns the CodeBuddyClient to use, or null if none is wired. */
export type PeerChatClientGetter = () => CodeBuddyClient | null;

interface ChatSessionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatSession {
  sessionId: string;
  systemPrompt: string;
  model?: string;
  dispatchProfile?: FleetDispatchProfile;
  toolPolicy?: FleetDispatchToolPolicy;
  toolDecisions?: FleetDispatchToolDecision[];
  toolset?: FleetHermesToolsetDescriptor;
  /** User/assistant turns only — system prompt is held separately and prepended on each call. */
  messages: ChatSessionMessage[];
  createdAt: number;
  lastUsedAt: number;
  /** Promise chain for FIFO serialisation of concurrent `continue` calls. */
  pending: Promise<unknown>;
}

const DEFAULT_SYSTEM_PROMPT =
  'You are a peer LLM in a multi-Claude fleet. Answer concisely. Do not use tools.';
const DEFAULT_IDLE_MS = 30 * 60 * 1000;

const sessions = new Map<string, ChatSession>();
let cachedGetter: PeerChatClientGetter | null = null;
let wired = false;

function resolvePeerSessionProfile(params: Record<string, unknown>): {
  dispatchProfile?: FleetDispatchProfile;
  toolPolicy?: FleetDispatchToolPolicy;
  toolDecisions?: FleetDispatchToolDecision[];
  toolset?: FleetHermesToolsetDescriptor;
} {
  if (params.dispatchProfile === undefined) {
    return {};
  }
  if (!isFleetDispatchProfile(params.dispatchProfile)) {
    throw new Error(
      `peer.chat-session.start: dispatchProfile must be one of ${FLEET_DISPATCH_PROFILES.join(', ')}`,
    );
  }
  const dispatchProfile = normalizeDispatchProfile(params.dispatchProfile);
  const toolset = buildHermesToolsetDescriptor(
    dispatchProfile,
    [...DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS],
  );
  return {
    dispatchProfile,
    toolPolicy: getDispatchToolPolicy(dispatchProfile),
    toolDecisions: toolset.decisions,
    toolset,
  };
}

function resolvePeerSessionSystemPrompt(
  params: Record<string, unknown>,
  dispatchProfile?: FleetDispatchProfile,
): string {
  if (typeof params.systemPrompt === 'string' && params.systemPrompt.length > 0) {
    return dispatchProfile
      ? mergeDispatchSystemPrompt(params.systemPrompt, dispatchProfile)
      : params.systemPrompt;
  }
  if (dispatchProfile) {
    return buildDispatchSystemPrompt(dispatchProfile);
  }
  return DEFAULT_SYSTEM_PROMPT;
}

function sessionPolicyMetadata(session: ChatSession): {
  dispatchProfile?: FleetDispatchProfile;
  toolPolicy?: FleetDispatchToolPolicy;
  toolDecisions?: FleetDispatchToolDecision[];
  toolset?: FleetHermesToolsetDescriptor;
} {
  return {
    ...(session.dispatchProfile ? { dispatchProfile: session.dispatchProfile } : {}),
    ...(session.toolPolicy ? { toolPolicy: session.toolPolicy } : {}),
    ...(session.toolDecisions ? { toolDecisions: session.toolDecisions } : {}),
    ...(session.toolset ? { toolset: session.toolset } : {}),
  };
}

function assertPeerSessionContinueProfile(
  params: Record<string, unknown>,
  session: ChatSession,
  methodName: string,
): void {
  if (params.dispatchProfile === undefined) {
    return;
  }
  if (!isFleetDispatchProfile(params.dispatchProfile)) {
    throw new Error(
      `${methodName}: dispatchProfile must be one of ${FLEET_DISPATCH_PROFILES.join(', ')}`,
    );
  }
  const requestedProfile = normalizeDispatchProfile(params.dispatchProfile);
  if (!session.dispatchProfile) {
    throw new Error(
      `${methodName}: dispatchProfile cannot be set on continue for a session started without a profile; start a new session with dispatchProfile "${requestedProfile}"`,
    );
  }
  if (requestedProfile !== session.dispatchProfile) {
    throw new Error(
      `${methodName}: dispatchProfile "${requestedProfile}" does not match session profile "${session.dispatchProfile}"; start a new session to change profile`,
    );
  }
}

function getIdleMs(): number {
  const raw = process.env.CODEBUDDY_PEER_SESSION_IDLE_MS;
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_IDLE_MS;
}

function newSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `sess_${ts}_${rand}`;
}

/**
 * Opportunistic GC — drop sessions whose `lastUsedAt` is older than
 * the configured idle window. Called at the top of each `start` and
 * `continue` so we don't leak across long-running peers without
 * relying on a setInterval timer. V1.2-saga: also purges the disk
 * file and emits `fleet:chat-session:end` (reason='expired') for
 * each session that gets dropped.
 */
async function purgeExpired(now: number, idleMs: number): Promise<void> {
  const dropped: string[] = [];
  for (const [id, session] of sessions) {
    if (now - session.lastUsedAt > idleMs) {
      sessions.delete(id);
      dropped.push(id);
    }
  }
  for (const id of dropped) {
    try {
      await getPeerSessionStore().delete(id);
    } catch (err) {
      logger.warn('[peer-session-bridge] purgeExpired disk delete failed', {
        sessionId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    broadcastChatSessionEnd({ sessionId: id, reason: 'expired' });
  }
}

/** Build a {@link PersistedChatSession} snapshot from an in-memory session. */
function snapshot(session: ChatSession): PersistedChatSession {
  return {
    sessionId: session.sessionId,
    systemPrompt: session.systemPrompt,
    model: session.model,
    dispatchProfile: session.dispatchProfile,
    toolPolicy: session.toolPolicy,
    toolDecisions: session.toolDecisions,
    toolset: session.toolset,
    messages: [...session.messages],
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
  };
}

/**
 * Register the `peer.chat-session.*` methods. The `getClient` closure
 * is captured and called fresh on each invocation so the caller can
 * swap clients dynamically (mirror of `wirePeerChatBridge`).
 *
 * Idempotent — a second call is a no-op (does NOT replace the cached
 * getter; un-wire first if you need to swap).
 */
export async function wirePeerSessionBridge(getClient: PeerChatClientGetter): Promise<void> {
  if (wired) {
    logger.debug('[peer-session-bridge] wire() called while already wired — no-op');
    return;
  }
  cachedGetter = getClient;

  // V1.2-saga — replay sessions from disk that haven't idled out.
  // Best-effort: if the store can't be read (perms, corrupt dir), we
  // continue with an empty in-memory map rather than refusing to wire.
  try {
    const store = getPeerSessionStore();
    const idleMs = getIdleMs();
    const now = Date.now();
    await store.purgeExpired(now, idleMs);
    const persisted = await store.loadAll();
    for (const p of persisted) {
      if (now - p.lastUsedAt > idleMs) continue; // double-check vs the boundary
      sessions.set(p.sessionId, {
        sessionId: p.sessionId,
        systemPrompt: p.systemPrompt,
        model: p.model,
        dispatchProfile: p.dispatchProfile,
        toolPolicy: p.toolPolicy,
        toolDecisions: p.toolDecisions,
        toolset: p.toolset,
        messages: [...p.messages],
        createdAt: p.createdAt,
        lastUsedAt: p.lastUsedAt,
        pending: Promise.resolve(),
      });
    }
    if (sessions.size > 0) {
      logger.info(
        `[peer-session-bridge] hydrated ${sessions.size} session(s) from disk`,
      );
    }
  } catch (err) {
    logger.warn('[peer-session-bridge] hydrate failed — continuing with empty state', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  registerPeerMethod('peer.chat-session.start', async (params, ctx) => {
    const idleMs = getIdleMs();
    const now = Date.now();
    await purgeExpired(now, idleMs);

    const profile = resolvePeerSessionProfile(params);
    const systemPrompt = resolvePeerSessionSystemPrompt(params, profile.dispatchProfile);
    const model =
      typeof params.model === 'string' && params.model.length > 0 ? params.model : undefined;

    const sessionId = newSessionId();
    const session: ChatSession = {
      sessionId,
      systemPrompt,
      model,
      dispatchProfile: profile.dispatchProfile,
      toolPolicy: profile.toolPolicy,
      toolDecisions: profile.toolDecisions,
      toolset: profile.toolset,
      messages: [],
      createdAt: now,
      lastUsedAt: now,
      pending: Promise.resolve(),
    };
    sessions.set(sessionId, session);

    // V1.2-saga — persist before returning so a crash right after the
    // RPC response (when the caller starts pushing turns) still finds
    // the record on disk. Failure logs but doesn't fail the RPC: the
    // in-memory state is authoritative within this process.
    try {
      await getPeerSessionStore().save(snapshot(session));
    } catch (err) {
      logger.warn('[peer-session-bridge] save on start failed', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    broadcastChatSessionStart({
      sessionId,
      model,
      ...(profile.dispatchProfile ? { dispatchProfile: profile.dispatchProfile } : {}),
    });

    return {
      sessionId,
      expiresAt: now + idleMs,
      traceId: ctx.traceId,
      ...(profile.dispatchProfile ? { dispatchProfile: profile.dispatchProfile } : {}),
      ...(profile.toolPolicy ? { toolPolicy: profile.toolPolicy } : {}),
      ...(profile.toolDecisions ? { toolDecisions: profile.toolDecisions } : {}),
      ...(profile.toolset ? { toolset: profile.toolset } : {}),
    };
  });

  registerPeerMethod('peer.chat-session.continue', async (params, ctx) => {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
    const prompt = typeof params.prompt === 'string' ? params.prompt : '';
    if (!sessionId) {
      throw new Error('peer.chat-session.continue: sessionId is required (string)');
    }
    if (!prompt) {
      throw new Error('peer.chat-session.continue: prompt is required (string)');
    }

    const idleMs = getIdleMs();
    const now = Date.now();
    await purgeExpired(now, idleMs);

    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error(`SESSION_NOT_FOUND: no session with id "${sessionId}"`);
    }
    if (now - session.lastUsedAt > idleMs) {
      // Defensive — purgeExpired should already have evicted, but a
      // race between two callers could leave us here.
      sessions.delete(sessionId);
      try {
        await getPeerSessionStore().delete(sessionId);
      } catch {
        /* best-effort */
      }
      broadcastChatSessionEnd({ sessionId, reason: 'expired' });
      throw new Error(`SESSION_EXPIRED: session "${sessionId}" idled past ${idleMs}ms`);
    }
    assertPeerSessionContinueProfile(params, session, 'peer.chat-session.continue');

    // FIFO serialise: chain onto the session's pending promise so
    // concurrent continue() calls run one after the other rather than
    // racing on session.messages.
    const run = async (): Promise<{
      text: string;
      finishReason: string | null | undefined;
      usage: unknown;
      traceId: string;
      dispatchProfile?: FleetDispatchProfile;
      toolPolicy?: FleetDispatchToolPolicy;
      toolDecisions?: FleetDispatchToolDecision[];
      toolset?: FleetHermesToolsetDescriptor;
    }> => {
      const client = cachedGetter?.() ?? null;
      if (!client) {
        throw new Error(
          'CLIENT_UNAVAILABLE: no LLM client wired on this peer (peer.chat-session.continue cannot answer)',
        );
      }

      session.messages.push({ role: 'user', content: prompt });
      const requestMessages = [
        { role: 'system' as const, content: session.systemPrompt },
        ...session.messages,
      ];
      const chatOptions: ChatOptions | undefined = session.model
        ? { model: session.model }
        : undefined;

      const turnStartedAt = Date.now();
      let response: Awaited<ReturnType<CodeBuddyClient['chat']>>;
      try {
        response = await client.chat(requestMessages, undefined, chatOptions);
      } catch (err) {
        // Roll back the user message we appended so a retry doesn't
        // double-count it. Keeps session state consistent with what the
        // model has actually seen.
        session.messages.pop();
        throw err;
      }

      const text = response?.choices?.[0]?.message?.content ?? '';
      session.messages.push({ role: 'assistant', content: text });
      session.lastUsedAt = Date.now();

      // V1.2-saga — flush the new turn to disk before returning so a
      // crash mid-conversation can be replayed on next boot. Failure
      // logs but doesn't fail the turn: the caller already got an
      // answer; losing only the disk record is acceptable.
      try {
        await getPeerSessionStore().save(snapshot(session));
      } catch (err) {
        logger.warn('[peer-session-bridge] save on continue failed', {
          sessionId: session.sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // turnCount = number of full user/assistant exchanges. messages
      // alternates user/assistant so length / 2 (rounded down) is the
      // count of completed exchanges.
      const turnCount = Math.floor(session.messages.length / 2);
      broadcastChatSessionTurn({
        sessionId: session.sessionId,
        turnCount,
        elapsedMs: Date.now() - turnStartedAt,
        usage: response?.usage,
      });

      return {
        text,
        finishReason: response?.choices?.[0]?.finish_reason,
        usage: response?.usage,
        traceId: ctx.traceId,
        ...sessionPolicyMetadata(session),
      };
    };

    const next = session.pending.then(run, run);
    // Swallow rejections on the chain so a failed turn doesn't poison
    // every subsequent continue() with the same error.
    session.pending = next.catch(() => undefined);
    return next;
  });

  // Streaming variant of `continue` — mirrors `peer.chat-stream`
  // (Phase d.19). Same FIFO serialisation, same history accumulation,
  // same persistence + events as `continue`, but the assistant deltas
  // are pushed via `ctx.emitChunk` as they're produced. The final
  // response still carries the aggregated text + usage so callers
  // without streaming transport support get a usable answer either way.
  registerPeerMethod('peer.chat-session.continue-stream', async (params, ctx) => {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
    const prompt = typeof params.prompt === 'string' ? params.prompt : '';
    if (!sessionId) {
      throw new Error('peer.chat-session.continue-stream: sessionId is required (string)');
    }
    if (!prompt) {
      throw new Error('peer.chat-session.continue-stream: prompt is required (string)');
    }

    const idleMs = getIdleMs();
    const now = Date.now();
    await purgeExpired(now, idleMs);

    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error(`SESSION_NOT_FOUND: no session with id "${sessionId}"`);
    }
    if (now - session.lastUsedAt > idleMs) {
      sessions.delete(sessionId);
      try {
        await getPeerSessionStore().delete(sessionId);
      } catch {
        /* best-effort */
      }
      broadcastChatSessionEnd({ sessionId, reason: 'expired' });
      throw new Error(`SESSION_EXPIRED: session "${sessionId}" idled past ${idleMs}ms`);
    }
    assertPeerSessionContinueProfile(params, session, 'peer.chat-session.continue-stream');

    const run = async (): Promise<{
      text: string;
      finishReason: string | null | undefined;
      usage: unknown;
      traceId: string;
      dispatchProfile?: FleetDispatchProfile;
      toolPolicy?: FleetDispatchToolPolicy;
      toolDecisions?: FleetDispatchToolDecision[];
      toolset?: FleetHermesToolsetDescriptor;
    }> => {
      const client = cachedGetter?.() ?? null;
      if (!client) {
        throw new Error(
          'CLIENT_UNAVAILABLE: no LLM client wired on this peer (peer.chat-session.continue-stream cannot answer)',
        );
      }

      session.messages.push({ role: 'user', content: prompt });
      const requestMessages = [
        { role: 'system' as const, content: session.systemPrompt },
        ...session.messages,
      ];
      const chatOptions: ChatOptions | undefined = session.model
        ? { model: session.model }
        : undefined;

      const turnStartedAt = Date.now();
      let aggregate = '';
      let finishReason: string | null | undefined;
      let usage: unknown;
      try {
        const stream = client.chatStream(requestMessages, undefined, chatOptions);
        for await (const chunk of stream as AsyncIterable<{
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
          usage?: unknown;
        }>) {
          const delta = chunk?.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            aggregate += delta;
            ctx.emitChunk?.(delta);
          }
          const fr = chunk?.choices?.[0]?.finish_reason;
          if (fr) finishReason = fr;
          if (chunk?.usage) usage = chunk.usage;
        }
      } catch (err) {
        // Mirror the non-streaming `continue` rollback: if the model
        // bailed before producing any answer we drop the user turn
        // entirely. If we did get partial text, persist it as the
        // assistant message so the conversation stays coherent on
        // retry — the next `continue` will see what the model said
        // before the error.
        if (aggregate.length === 0) {
          session.messages.pop();
        } else {
          session.messages.push({ role: 'assistant', content: aggregate });
          session.lastUsedAt = Date.now();
          try {
            await getPeerSessionStore().save(snapshot(session));
          } catch {
            /* best-effort */
          }
        }
        throw err;
      }

      session.messages.push({ role: 'assistant', content: aggregate });
      session.lastUsedAt = Date.now();

      try {
        await getPeerSessionStore().save(snapshot(session));
      } catch (err) {
        logger.warn('[peer-session-bridge] save on continue-stream failed', {
          sessionId: session.sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const turnCount = Math.floor(session.messages.length / 2);
      broadcastChatSessionTurn({
        sessionId: session.sessionId,
        turnCount,
        elapsedMs: Date.now() - turnStartedAt,
        usage,
      });

      return {
        text: aggregate,
        finishReason,
        usage,
        traceId: ctx.traceId,
        ...sessionPolicyMetadata(session),
      };
    };

    const next = session.pending.then(run, run);
    session.pending = next.catch(() => undefined);
    return next;
  });

  // Read-only snapshot of the in-memory sessions on this peer. Useful
  // for /fleet status --with-sessions and any external monitoring
  // tool that wants to know what conversations are open without
  // sniffing content. Metadata only — sessionId, turnCount,
  // ageMs, lastUsedMs, model. NEVER returns systemPrompt, messages,
  // or any conversation text.
  registerPeerMethod('peer.chat-session.list', async (_params, ctx) => {
    const idleMs = getIdleMs();
    const now = Date.now();
    // Drop expired entries before reporting so the caller doesn't
    // see ghosts that will vanish on the next dispatch.
    await purgeExpired(now, idleMs);
    const items = Array.from(sessions.values()).map((s) => ({
      sessionId: s.sessionId,
      turnCount: Math.floor(s.messages.length / 2),
      model: s.model,
      dispatchProfile: s.dispatchProfile,
      toolPolicy: s.toolPolicy,
      toolDecisions: s.toolDecisions,
      toolset: s.toolset,
      ageMs: now - s.createdAt,
      idleMs: now - s.lastUsedAt,
      expiresInMs: Math.max(0, idleMs - (now - s.lastUsedAt)),
    }));
    return {
      count: items.length,
      sessions: items,
      traceId: ctx.traceId,
    };
  });

  registerPeerMethod('peer.chat-session.end', async (params, ctx) => {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
    if (!sessionId) {
      throw new Error('peer.chat-session.end: sessionId is required (string)');
    }
    const closed = sessions.delete(sessionId);
    if (closed) {
      try {
        await getPeerSessionStore().delete(sessionId);
      } catch (err) {
        logger.warn('[peer-session-bridge] delete on end failed', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      broadcastChatSessionEnd({ sessionId, reason: 'end' });
    }
    return { closed, traceId: ctx.traceId };
  });

  wired = true;
  logger.debug('[peer-session-bridge] wired');
}

/** Detach all three methods. Idempotent. Does NOT clear in-memory sessions. */
export function unwirePeerSessionBridge(): void {
  if (!wired) return;
  unregisterPeerMethod('peer.chat-session.start');
  unregisterPeerMethod('peer.chat-session.continue');
  unregisterPeerMethod('peer.chat-session.continue-stream');
  unregisterPeerMethod('peer.chat-session.end');
  cachedGetter = null;
  wired = false;
  logger.debug('[peer-session-bridge] unwired');
}

/** Whether the bridge is currently registered on the peer-rpc registry. */
export function isPeerSessionBridgeWired(): boolean {
  return wired;
}

/**
 * Test-only — force-unwire even if state is desync'd, AND clear the
 * in-memory session map. Equivalent of `_unwireForTests` in
 * peer-chat-bridge.
 */
export function _unwireForTests(): void {
  try {
    unregisterPeerMethod('peer.chat-session.start');
    unregisterPeerMethod('peer.chat-session.continue');
    unregisterPeerMethod('peer.chat-session.continue-stream');
    unregisterPeerMethod('peer.chat-session.list');
    unregisterPeerMethod('peer.chat-session.end');
  } catch {
    /* peer-rpc may not be initialised in some test setups */
  }
  cachedGetter = null;
  wired = false;
  sessions.clear();
}

/** Test-only — read-only snapshot of live sessions (count + ids). */
export function _listSessionsForTests(): Array<{
  sessionId: string;
  messageCount: number;
  lastUsedAt: number;
  dispatchProfile?: FleetDispatchProfile;
}> {
  return Array.from(sessions.values()).map((s) => ({
    sessionId: s.sessionId,
    messageCount: s.messages.length,
    lastUsedAt: s.lastUsedAt,
    dispatchProfile: s.dispatchProfile,
  }));
}
