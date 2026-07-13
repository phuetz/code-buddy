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
import {
  normalizePeerChatProviderId,
  type PeerChatProviderId,
  type PeerChatProviderInfo,
} from './peer-chat-client-factory.js';
import { beginFleetWork } from './fleet-load.js';
import { registerPeerMethod, unregisterPeerMethod } from '../server/websocket/peer-rpc.js';
import {
  broadcastChatSessionEnd,
  broadcastChatSessionGoal,
  broadcastChatSessionStart,
  broadcastChatSessionTurn,
} from '../server/websocket/fleet-bridge.js';
import { resolveGoalJudgeClientFailOpen } from '../goals/goal-judge-client.js';
import { judgeGoal } from '../goals/goal-judge.js';
import { resolveGoalsConfig } from '../goals/goal-manager.js';
import {
  applyJudgeOutcome,
  createGoalState,
  formatGoalStatusLine,
  getGoalJudgeCriteria,
  normalizeGoalState,
  renderSubgoalsBlock,
  type GoalState,
} from '../goals/goal-state.js';
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
export type PeerSessionClientResolver = (
  provider: PeerChatProviderId,
  model?: string,
) => { client: CodeBuddyClient; info: PeerChatProviderInfo } | null;

interface ChatSessionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatSession {
  sessionId: string;
  systemPrompt: string;
  provider?: PeerChatProviderId;
  model?: string;
  dispatchProfile?: FleetDispatchProfile;
  toolPolicy?: FleetDispatchToolPolicy;
  toolDecisions?: FleetDispatchToolDecision[];
  toolset?: FleetHermesToolsetDescriptor;
  /** User/assistant turns only — system prompt is held separately and prepended on each call. */
  messages: ChatSessionMessage[];
  /** Standing goal attached via `peer.chat-session.goal` (Hermes gateway parity). */
  goal?: GoalState;
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
let cachedProviderInfo: PeerChatProviderInfo | null = null;
let cachedResolver: PeerSessionClientResolver | null = null;
const providerClients = new Map<PeerChatProviderId, {
  client: CodeBuddyClient;
  info: PeerChatProviderInfo;
}>();
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

function parsePeerSessionProvider(value: unknown, methodName: string): PeerChatProviderId | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizePeerChatProviderId(value);
  if (!normalized) {
    throw new Error(`${methodName}: unknown provider "${String(value)}"`);
  }
  return normalized;
}

function assertPeerSessionContinueProvider(
  params: Record<string, unknown>,
  session: ChatSession,
  methodName: string,
): void {
  if (params.provider === undefined) return;
  const requested = parsePeerSessionProvider(params.provider, methodName);
  if (!session.provider) {
    throw new Error(
      `${methodName}: provider cannot be set on continue for a legacy/default session; start a new session with provider "${requested}"`,
    );
  }
  if (requested !== session.provider) {
    throw new Error(
      `${methodName}: provider "${requested}" does not match session provider "${session.provider}"; start a new session to change provider`,
    );
  }
}

function resolvePeerSessionClient(
  provider: PeerChatProviderId | undefined,
  model: string | undefined,
  methodName: string,
): { client: CodeBuddyClient; providerResolved?: PeerChatProviderId } {
  if (!provider) {
    const client = cachedGetter?.() ?? null;
    if (!client) {
      throw new Error(
        `CLIENT_UNAVAILABLE: no LLM client wired on this peer (${methodName} cannot answer)`,
      );
    }
    return {
      client,
      ...(cachedProviderInfo ? { providerResolved: cachedProviderInfo.provider } : {}),
    };
  }
  if (cachedProviderInfo?.provider === provider) {
    const client = cachedGetter?.() ?? null;
    if (client) return { client, providerResolved: provider };
  }
  let resolved = providerClients.get(provider);
  if (!resolved && cachedResolver) {
    resolved = cachedResolver(provider, model) ?? undefined;
    if (resolved) providerClients.set(provider, resolved);
  }
  if (!resolved || resolved.info.provider !== provider) {
    throw new Error(
      `PROVIDER_UNAVAILABLE: ${provider} is not configured on this peer (${methodName})`,
    );
  }
  return { client: resolved.client, providerResolved: resolved.info.provider };
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

function resolvePeerGoalMaxTurns(raw: unknown): number {
  if (raw === undefined) return resolveGoalsConfig().maxTurns;
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    throw new Error('peer.chat-session.goal: maxTurns must be a positive integer');
  }
  return raw;
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
    provider: session.provider,
    model: session.model,
    dispatchProfile: session.dispatchProfile,
    toolPolicy: session.toolPolicy,
    toolDecisions: session.toolDecisions,
    toolset: session.toolset,
    messages: [...session.messages],
    ...(session.goal ? { goal: { ...session.goal, subgoals: [...session.goal.subgoals] } } : {}),
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
  };
}

/** What the post-turn judge reports back to the remote caller. */
interface SessionGoalTurnReport {
  status: string;
  verdict: string;
  reason: string;
  turnsUsed: number;
  maxTurns: number;
  message: string;
  /**
   * Present when the judge said "continue" under budget. The CALLER drives
   * the loop (Hermes gateway parity): send this back as the next
   * `peer.chat-session.continue` prompt to keep working toward the goal.
   */
  continuationPrompt?: string;
}

/**
 * Post-turn goal hook shared by `continue` and `continue-stream`. Judges the
 * assistant's response against the session goal, applies the Hermes decision
 * ladder, and returns the report embedded in the RPC response. The judge is
 * fail-open; this never throws. The caller persists the session afterwards.
 */
async function evaluateSessionGoalAfterTurn(
  session: ChatSession,
  assistantText: string,
  baseClient: CodeBuddyClient,
): Promise<SessionGoalTurnReport | null> {
  const goal = session.goal;
  if (!goal || goal.status !== 'active') return null;
  if (!assistantText.trim()) {
    goal.status = 'paused';
    goal.pausedReason = 'empty response (nothing to evaluate)';
    const report: SessionGoalTurnReport = {
      status: 'paused',
      verdict: 'skipped',
      reason: goal.pausedReason,
      turnsUsed: goal.turnsUsed,
      maxTurns: goal.maxTurns,
      message: '⏸ Goal paused — the peer produced no judgeable response.',
    };
    broadcastChatSessionGoal({
      sessionId: session.sessionId,
      status: report.status,
      verdict: report.verdict,
      turnsUsed: report.turnsUsed,
      maxTurns: report.maxTurns,
    });
    return report;
  }

  let report: SessionGoalTurnReport;
  try {
    const config = resolveGoalsConfig();
    const judgeClient = await resolveGoalJudgeClientFailOpen(baseClient, config.judgeModel);
    const criteria = getGoalJudgeCriteria(goal);
    const outcome = await judgeGoal(judgeClient, {
      goal: goal.goal,
      lastResponse: assistantText,
      ...(criteria.length ? { subgoals: criteria } : {}),
      ...(config.judgeModel ? { model: config.judgeModel } : {}),
      maxTokens: config.judgeMaxTokens,
      timeoutMs: config.judgeTimeoutMs,
    });
    const decision = applyJudgeOutcome(goal, outcome);
    report = {
      status: decision.status,
      verdict: decision.verdict,
      reason: decision.reason,
      turnsUsed: goal.turnsUsed,
      maxTurns: goal.maxTurns,
      message: decision.message,
      ...(decision.continuationPrompt ? { continuationPrompt: decision.continuationPrompt } : {}),
    };
  } catch (err) {
    logger.warn('[peer-session-bridge] goal evaluation failed — skipping this turn', {
      sessionId: session.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  broadcastChatSessionGoal({
    sessionId: session.sessionId,
    status: report.status,
    verdict: report.verdict,
    turnsUsed: report.turnsUsed,
    maxTurns: report.maxTurns,
  });
  return report;
}

/**
 * Register the `peer.chat-session.*` methods. The `getClient` closure
 * is captured and called fresh on each invocation so the caller can
 * swap clients dynamically (mirror of `wirePeerChatBridge`).
 *
 * Idempotent — a second call is a no-op (does NOT replace the cached
 * getter; un-wire first if you need to swap).
 */
export async function wirePeerSessionBridge(
  getClient: PeerChatClientGetter,
  providerInfo?: PeerChatProviderInfo | null,
  resolveClient?: PeerSessionClientResolver,
): Promise<void> {
  if (wired) {
    logger.debug('[peer-session-bridge] wire() called while already wired — no-op');
    return;
  }
  cachedGetter = getClient;
  cachedProviderInfo = providerInfo ?? null;
  cachedResolver = resolveClient ?? null;

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
      const goal = p.goal ? normalizeGoalState(p.goal) : null;
      const persistedProvider = normalizePeerChatProviderId(p.provider);
      sessions.set(p.sessionId, {
        sessionId: p.sessionId,
        systemPrompt: p.systemPrompt,
        ...(persistedProvider ? { provider: persistedProvider } : {}),
        model: p.model,
        dispatchProfile: p.dispatchProfile,
        toolPolicy: p.toolPolicy,
        toolDecisions: p.toolDecisions,
        toolset: p.toolset,
        messages: [...p.messages],
        ...(goal && goal.status !== 'cleared' ? { goal } : {}),
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
    const provider = parsePeerSessionProvider(params.provider, 'peer.chat-session.start');
    const providerResolved = provider
      ? resolvePeerSessionClient(provider, model, 'peer.chat-session.start').providerResolved
      : undefined;

    const sessionId = newSessionId();
    const session: ChatSession = {
      sessionId,
      systemPrompt,
      provider,
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
      ...(provider ? { providerRequested: provider } : {}),
      ...(providerResolved ? { providerResolved } : {}),
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
    assertPeerSessionContinueProvider(params, session, 'peer.chat-session.continue');

    // FIFO serialise: chain onto the session's pending promise so
    // concurrent continue() calls run one after the other rather than
    // racing on session.messages.
    const run = async (): Promise<{
      text: string;
      finishReason: string | null | undefined;
      usage: unknown;
      traceId: string;
      goal?: SessionGoalTurnReport;
      dispatchProfile?: FleetDispatchProfile;
      toolPolicy?: FleetDispatchToolPolicy;
      toolDecisions?: FleetDispatchToolDecision[];
      toolset?: FleetHermesToolsetDescriptor;
      providerRequested?: PeerChatProviderId;
      providerResolved?: PeerChatProviderId;
    }> => {
      const selected = resolvePeerSessionClient(
        session.provider,
        session.model,
        'peer.chat-session.continue',
      );
      const client = selected.client;

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
      const doneLoad = beginFleetWork('peer.chat-session');
      try {
        response = await client.chat(requestMessages, undefined, chatOptions);
      } catch (err) {
        // Roll back the user message we appended so a retry doesn't
        // double-count it. Keeps session state consistent with what the
        // model has actually seen.
        session.messages.pop();
        throw err;
      } finally {
        doneLoad();
      }

      const text = response?.choices?.[0]?.message?.content ?? '';
      session.messages.push({ role: 'assistant', content: text });
      session.lastUsedAt = Date.now();

      // Goal Ralph-loop (Hermes gateway parity): judge the turn server-side,
      // mutate the session goal state, and report the verdict to the caller
      // (who drives the continuation). Runs BEFORE the disk flush so the
      // snapshot below persists the updated goal counters.
      const goalReport = await evaluateSessionGoalAfterTurn(session, text, client);

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
        ...(session.provider ? { providerRequested: session.provider } : {}),
        ...(selected.providerResolved ? { providerResolved: selected.providerResolved } : {}),
        ...(goalReport ? { goal: goalReport } : {}),
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
    assertPeerSessionContinueProvider(params, session, 'peer.chat-session.continue-stream');

    const run = async (): Promise<{
      text: string;
      finishReason: string | null | undefined;
      usage: unknown;
      traceId: string;
      goal?: SessionGoalTurnReport;
      dispatchProfile?: FleetDispatchProfile;
      toolPolicy?: FleetDispatchToolPolicy;
      toolDecisions?: FleetDispatchToolDecision[];
      toolset?: FleetHermesToolsetDescriptor;
      providerRequested?: PeerChatProviderId;
      providerResolved?: PeerChatProviderId;
    }> => {
      const selected = resolvePeerSessionClient(
        session.provider,
        session.model,
        'peer.chat-session.continue-stream',
      );
      const client = selected.client;

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

      // Goal Ralph-loop — same server-side judge as the non-streaming path.
      const goalReport = await evaluateSessionGoalAfterTurn(session, aggregate, client);

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
        ...(session.provider ? { providerRequested: session.provider } : {}),
        ...(selected.providerResolved ? { providerResolved: selected.providerResolved } : {}),
        ...(goalReport ? { goal: goalReport } : {}),
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
      provider: s.provider,
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

  // Goal Ralph-loop controls (Hermes gateway parity). One method, action-
  // dispatched: set | status | pause | resume | clear | subgoal-add |
  // subgoal-list | subgoal-remove | subgoal-clear. Mirrors the /goal +
  // /subgoal slash surface. Setting a NEW goal while one is active is
  // rejected (Hermes mid-run rule) — pause/clear first. status/pause/
  // resume/clear are safe mid-turn: they only touch goal metadata.
  registerPeerMethod('peer.chat-session.goal', async (params, ctx) => {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
    const action = typeof params.action === 'string' ? params.action : 'status';
    if (!sessionId) {
      throw new Error('peer.chat-session.goal: sessionId is required (string)');
    }
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error(`SESSION_NOT_FOUND: no session with id "${sessionId}"`);
    }

    const persist = async (): Promise<void> => {
      try {
        await getPeerSessionStore().save(snapshot(session));
      } catch (err) {
        logger.warn('[peer-session-bridge] save on goal mutation failed', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    const emitGoal = (status: string): void => {
      broadcastChatSessionGoal({
        sessionId,
        status,
        ...(session.goal ? { turnsUsed: session.goal.turnsUsed, maxTurns: session.goal.maxTurns } : {}),
      });
    };
    const goalView = (): Record<string, unknown> =>
      session.goal
        ? {
            goal: session.goal.goal,
            status: session.goal.status,
            turnsUsed: session.goal.turnsUsed,
            maxTurns: session.goal.maxTurns,
            subgoals: [...session.goal.subgoals],
            ...(session.goal.goalPlan ? { goalPlan: session.goal.goalPlan } : {}),
            ...(session.goal.lastVerdict ? { lastVerdict: session.goal.lastVerdict } : {}),
            ...(session.goal.lastReason ? { lastReason: session.goal.lastReason } : {}),
            ...(session.goal.pausedReason ? { pausedReason: session.goal.pausedReason } : {}),
            statusLine: formatGoalStatusLine(session.goal),
          }
        : { status: 'none', statusLine: formatGoalStatusLine(null) };

    switch (action) {
      case 'set': {
        const text = typeof params.goal === 'string' ? params.goal.trim() : '';
        if (!text) {
          throw new Error('peer.chat-session.goal: action "set" requires goal text (string)');
        }
        if (session.goal?.status === 'active') {
          throw new Error(
            'GOAL_ACTIVE: a goal is already active on this session. ' +
              'Use action "status"/"pause"/"clear" mid-run; clear it before setting a new goal.'
          );
        }
        const maxTurns = resolvePeerGoalMaxTurns(params.maxTurns);
        session.goal = createGoalState(text, maxTurns);
        await persist();
        emitGoal('active');
        return { ...goalView(), traceId: ctx.traceId };
      }
      case 'status':
        return { ...goalView(), traceId: ctx.traceId };
      case 'pause': {
        if (!session.goal || !['active', 'paused'].includes(session.goal.status)) {
          return { ...goalView(), traceId: ctx.traceId };
        }
        session.goal.status = 'paused';
        session.goal.pausedReason = 'user-paused';
        await persist();
        emitGoal('paused');
        return { ...goalView(), traceId: ctx.traceId };
      }
      case 'resume': {
        if (!session.goal || session.goal.status !== 'paused') {
          return { ...goalView(), traceId: ctx.traceId };
        }
        session.goal.status = 'active';
        delete session.goal.pausedReason;
        delete session.goal.lastVerdict;
        delete session.goal.lastReason;
        session.goal.consecutiveParseFailures = 0;
        session.goal.turnsUsed = 0; // Hermes resume semantics: budget reset
        await persist();
        emitGoal('active');
        return { ...goalView(), traceId: ctx.traceId };
      }
      case 'clear': {
        const had = Boolean(session.goal);
        delete session.goal;
        await persist();
        if (had) emitGoal('cleared');
        return { cleared: had, ...goalView(), traceId: ctx.traceId };
      }
      case 'subgoal-add': {
        const text = typeof params.text === 'string' ? params.text.trim() : '';
        if (!text) {
          throw new Error('peer.chat-session.goal: action "subgoal-add" requires text (string)');
        }
        if (!session.goal || !['active', 'paused'].includes(session.goal.status)) {
          throw new Error('NO_ACTIVE_GOAL: set a goal before adding subgoals');
        }
        session.goal.subgoals.push(text);
        await persist();
        return { ...goalView(), traceId: ctx.traceId };
      }
      case 'subgoal-list':
        return {
          ...goalView(),
          rendered: session.goal ? renderSubgoalsBlock(session.goal.subgoals) : '',
          traceId: ctx.traceId,
        };
      case 'subgoal-remove': {
        const index = typeof params.index === 'number' ? params.index : NaN;
        if (!session.goal || !['active', 'paused'].includes(session.goal.status)) {
          throw new Error('NO_ACTIVE_GOAL: set a goal before removing subgoals');
        }
        if (!Number.isSafeInteger(index) || index < 1) {
          throw new Error('peer.chat-session.goal: subgoal index must be a positive integer');
        }
        if (index > session.goal.subgoals.length) {
          throw new Error(
            `peer.chat-session.goal: subgoal index out of range (1..${session.goal.subgoals.length})`
          );
        }
        const [removed] = session.goal.subgoals.splice(index - 1, 1);
        await persist();
        return { removed, ...goalView(), traceId: ctx.traceId };
      }
      case 'subgoal-clear': {
        if (!session.goal || !['active', 'paused'].includes(session.goal.status)) {
          throw new Error('NO_ACTIVE_GOAL: set a goal before clearing subgoals');
        }
        const previous = session.goal.subgoals.length;
        session.goal.subgoals = [];
        await persist();
        return { cleared: previous, ...goalView(), traceId: ctx.traceId };
      }
      default:
        throw new Error(
          `peer.chat-session.goal: unknown action "${action}" (expected set | status | pause | resume | clear | subgoal-add | subgoal-list | subgoal-remove | subgoal-clear)`
        );
    }
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

/** Detach all registered methods. Idempotent. Does NOT clear in-memory sessions. */
export function unwirePeerSessionBridge(): void {
  if (!wired) return;
  unregisterPeerMethod('peer.chat-session.start');
  unregisterPeerMethod('peer.chat-session.continue');
  unregisterPeerMethod('peer.chat-session.continue-stream');
  unregisterPeerMethod('peer.chat-session.goal');
  unregisterPeerMethod('peer.chat-session.list');
  unregisterPeerMethod('peer.chat-session.end');
  cachedGetter = null;
  cachedProviderInfo = null;
  cachedResolver = null;
  providerClients.clear();
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
    unregisterPeerMethod('peer.chat-session.goal');
    unregisterPeerMethod('peer.chat-session.list');
    unregisterPeerMethod('peer.chat-session.end');
  } catch {
    /* peer-rpc may not be initialised in some test setups */
  }
  cachedGetter = null;
  cachedProviderInfo = null;
  cachedResolver = null;
  providerClients.clear();
  wired = false;
  sessions.clear();
}

/** Test-only — read-only snapshot of live sessions (count + ids). */
export function _listSessionsForTests(): Array<{
  sessionId: string;
  messageCount: number;
  lastUsedAt: number;
  dispatchProfile?: FleetDispatchProfile;
  provider?: PeerChatProviderId;
}> {
  return Array.from(sessions.values()).map((s) => ({
    sessionId: s.sessionId,
    messageCount: s.messages.length,
    lastUsedAt: s.lastUsedAt,
    dispatchProfile: s.dispatchProfile,
    provider: s.provider,
  }));
}
