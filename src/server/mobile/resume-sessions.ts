/**
 * Read and continue CLI / Cowork-handoff sessions (mobile, CLI, Cowork).
 *
 * Storage is the existing SessionStore JSON tree (CODEBUDDY_SESSIONS_DIR or
 * ~/.codebuddy/sessions). No SQLite schema change. Secrets are redacted
 * before any payload leaves the process; JWT tokens are never echoed.
 *
 * Shared-session extension: owner + explicit authorizedUserIds, per-session
 * turn mutex, author/seq on persisted messages, live fan-out via the existing
 * WebSocket broadcast() (not a second channel).
 */

import type { NextFunction, Request, Response } from 'express';
import { getDataRedactionEngine } from '../../security/data-redaction.js';
import {
  SessionStore,
  type Session,
  type SessionMessage,
} from '../../persistence/session-store.js';
import { verifyToken } from '../auth/jwt.js';
import {
  buildHttpAgentSessionKey,
  withHttpSessionAgent,
} from '../http-agent-sessions.js';
import { runAgentCompletion } from '../agent-adapter.js';
import { logger } from '../../utils/logger.js';
import {
  broadcastSharedSessionMessage,
  listSharedParticipants,
} from '../sessions/shared-presence.js';

export type ResumeOrigin = 'cli' | 'cowork' | 'mobile';

export interface ResumeSessionSummary {
  id: string;
  title: string;
  origin: ResumeOrigin;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ResumeSessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  authorUserId?: string;
  seq?: number;
}

export interface ResumeSessionDetail extends ResumeSessionSummary {
  messages: ResumeSessionMessage[];
}

export interface ResumeContinueResult {
  id: string;
  title: string;
  origin: ResumeOrigin;
  reply: string;
  messageCount: number;
  authorUserId: string;
  seq: number;
}

export type ResumeTurnRunner = (input: {
  sessionId: string;
  userId: string;
  history: ResumeSessionMessage[];
  message: string;
}) => Promise<{ reply: string }>;

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const USER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const MAX_LIST = 50;
const MAX_MESSAGE_CHARS = 100_000;
const MAX_DETAIL_MESSAGES = 400;
const ASSISTANT_AUTHOR = 'assistant';

let resumeTurnRunner: ResumeTurnRunner | null = null;
let storeFactory: (() => SessionStore) | null = null;
const sessionTurnTails = new Map<string, Promise<void>>();

export function setResumeTurnRunnerForTests(runner: ResumeTurnRunner | null): void {
  resumeTurnRunner = runner;
}

export function setResumeSessionStoreFactoryForTests(factory: (() => SessionStore) | null): void {
  storeFactory = factory;
}

export function resetSessionTurnQueueForTests(): void {
  sessionTurnTails.clear();
}

/**
 * Resolve once every queued session turn has settled. A WebSocket turn sends
 * `chat_response` BEFORE it persists the turn (latency), so a test that stops at
 * the response still has a session write, and its `.lock` file, in flight.
 * Awaiting this before deleting the sessions directory removes that race
 * (ENOTEMPTY on Windows, 2026-09-23).
 */
export async function drainSessionTurnQueueForTests(): Promise<void> {
  await Promise.all([...sessionTurnTails.values()]);
}

export function isResumeSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

export function isSharedProfileId(value: string): boolean {
  return USER_ID_RE.test(value);
}

function createStore(): SessionStore {
  return storeFactory ? storeFactory() : new SessionStore({ useSQLite: false });
}

export function enqueueSessionTurn<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = sessionTurnTails.get(sessionId) ?? Promise.resolve();
  const current = previous.then(task, task);
  sessionTurnTails.set(sessionId, current.then(() => undefined, () => undefined));
  return current;
}

export function inferResumeOrigin(session: Pick<Session, 'id' | 'metadata'>): ResumeOrigin {
  const metadata = session.metadata ?? {};
  const handoff = metadata.handoffSource;
  const surface = metadata.surface;
  const origin = metadata.origin;
  if (handoff === 'cowork' || origin === 'cowork' || session.id.startsWith('cowork-')) {
    return 'cowork';
  }
  if (surface === 'mobile' || origin === 'mobile') {
    return 'mobile';
  }
  return 'cli';
}

export function resumeSessionOwner(session: Pick<Session, 'metadata'>): string | undefined {
  const raw = session.metadata?.ownerUserId;
  if (typeof raw !== 'string') return undefined;
  const owner = raw.trim();
  return owner || undefined;
}

export function resumeAuthorizedUserIds(session: Pick<Session, 'metadata'>): string[] {
  const raw = session.metadata?.authorizedUserIds;
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const id = entry.trim();
    if (id && isSharedProfileId(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * A session tagged with ownerUserId is visible to that JWT subject and to
 * profiles listed in metadata.authorizedUserIds. Untagged local (CLI)
 * sessions belong to the machine owner: CODEBUDDY_OWNER_USER_ID, or any
 * authenticated caller when that env is unset. There is no public share.
 */
export function canAccessResumeSession(
  session: Pick<Session, 'metadata'>,
  userId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!userId) return false;
  const owner = resumeSessionOwner(session);
  if (owner) {
    if (owner === userId) return true;
    return resumeAuthorizedUserIds(session).includes(userId);
  }
  const configured = (env.CODEBUDDY_OWNER_USER_ID ?? '').trim();
  if (!configured) return true;
  if (userId === configured) return true;
  return resumeAuthorizedUserIds(session).includes(userId);
}

function redactText(text: string): string {
  try {
    return getDataRedactionEngine().redact(text).redacted;
  } catch {
    return text;
  }
}

function iso(value: Date | string | undefined): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(0).toISOString();
}

function nextSeq(session: Session): number {
  const raw = session.metadata?.messageSeq;
  const current = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  return current + 1;
}

function visibleMessages(session: Session): ResumeSessionMessage[] {
  const out: ResumeSessionMessage[] = [];
  for (const message of session.messages) {
    if (message.type !== 'user' && message.type !== 'assistant') continue;
    if (typeof message.content !== 'string' || !message.content.trim()) continue;
    const row: ResumeSessionMessage = {
      role: message.type,
      content: redactText(message.content).slice(0, MAX_MESSAGE_CHARS),
      timestamp: message.timestamp,
    };
    if (typeof message.authorUserId === 'string' && message.authorUserId) {
      row.authorUserId = message.authorUserId;
    }
    if (typeof message.seq === 'number' && Number.isFinite(message.seq)) {
      row.seq = message.seq;
    }
    out.push(row);
    if (out.length >= MAX_DETAIL_MESSAGES) break;
  }
  return out;
}

function toSummary(session: Session): ResumeSessionSummary {
  return {
    id: session.id,
    title: redactText(session.name || session.id).slice(0, 200),
    origin: inferResumeOrigin(session),
    createdAt: iso(session.createdAt),
    updatedAt: iso(session.lastAccessedAt),
    messageCount: session.messages.length,
  };
}

function fanOutPersistedTurn(
  sessionId: string,
  user: SessionMessage,
  assistant: SessionMessage,
): void {
  if (typeof user.seq === 'number' && user.authorUserId) {
    broadcastSharedSessionMessage(sessionId, {
      seq: user.seq,
      role: 'user',
      content: redactText(user.content).slice(0, MAX_MESSAGE_CHARS),
      authorUserId: user.authorUserId,
      timestamp: user.timestamp,
    });
  }
  if (typeof assistant.seq === 'number' && assistant.authorUserId) {
    broadcastSharedSessionMessage(sessionId, {
      seq: assistant.seq,
      role: 'assistant',
      content: redactText(assistant.content).slice(0, MAX_MESSAGE_CHARS),
      authorUserId: assistant.authorUserId,
      timestamp: assistant.timestamp,
    });
  }
}

export async function listResumeSessions(userId: string): Promise<ResumeSessionSummary[]> {
  const store = createStore();
  const sessions = store.listSessions();
  return sessions
    .filter((session) => canAccessResumeSession(session, userId))
    .sort((a, b) => b.lastAccessedAt.getTime() - a.lastAccessedAt.getTime())
    .slice(0, MAX_LIST)
    .map(toSummary);
}

export async function loadResumeSession(
  sessionId: string,
  userId: string,
): Promise<ResumeSessionDetail | null> {
  if (!isResumeSessionId(sessionId)) return null;
  const store = createStore();
  const session = await store.loadSession(sessionId);
  if (!session || !canAccessResumeSession(session, userId)) return null;
  return {
    ...toSummary(session),
    messages: visibleMessages(session),
  };
}

/** Shared resume threads share one HTTP agent cache, keyed by session not user. */
export const SHARED_RESUME_AGENT_PRINCIPAL = 'shared';

async function defaultTurnRunner(input: {
  sessionId: string;
  userId: string;
  history: ResumeSessionMessage[];
  message: string;
}): Promise<{ reply: string }> {
  const sessionKey = buildHttpAgentSessionKey(SHARED_RESUME_AGENT_PRINCIPAL, input.sessionId);
  const reply = await withHttpSessionAgent(
    sessionKey,
    async (agent) => {
      const result = await runAgentCompletion(agent, input.message, { surface: 'mobile' });
      return result.content || '';
    },
    input.history.map((row) => ({ role: row.role, content: row.content })),
    { replaceHistory: true },
  );
  return { reply: redactText(reply) };
}

async function persistTurnUnlocked(
  session: Session,
  store: SessionStore,
  userId: string,
  userText: string,
  assistantText: string,
  surface: string,
): Promise<{ user: SessionMessage; assistant: SessionMessage }> {
  const now = new Date().toISOString();
  const userSeq = nextSeq(session);
  const assistantSeq = userSeq + 1;
  const userMessage: SessionMessage = {
    type: 'user',
    content: userText,
    timestamp: now,
    authorUserId: userId,
    seq: userSeq,
  };
  const assistantMessage: SessionMessage = {
    type: 'assistant',
    content: assistantText,
    timestamp: now,
    authorUserId: ASSISTANT_AUTHOR,
    seq: assistantSeq,
  };
  session.messages = [...session.messages, userMessage, assistantMessage];
  session.lastAccessedAt = new Date();
  const authorized = resumeAuthorizedUserIds(session);
  session.metadata = {
    ...session.metadata,
    lastSurface: surface,
    ownerUserId: resumeSessionOwner(session) ?? userId,
    messageSeq: assistantSeq,
    ...(authorized.length ? { authorizedUserIds: authorized } : {}),
  };
  await store.saveSession(session);
  fanOutPersistedTurn(session.id, userMessage, assistantMessage);
  return { user: userMessage, assistant: assistantMessage };
}

export async function continueResumeSession(
  sessionId: string,
  userId: string,
  message: string,
): Promise<ResumeContinueResult | { error: 'not_found' | 'bad_request' }> {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > MAX_MESSAGE_CHARS) {
    return { error: 'bad_request' };
  }
  if (!isResumeSessionId(sessionId)) {
    return { error: 'not_found' };
  }
  return enqueueSessionTurn(sessionId, async () => {
    const store = createStore();
    const session = await store.loadSession(sessionId);
    if (!session || !canAccessResumeSession(session, userId)) {
      return { error: 'not_found' as const };
    }

    const history = visibleMessages(session);
    const runner = resumeTurnRunner ?? defaultTurnRunner;
    const { reply } = await runner({
      sessionId,
      userId,
      history,
      message: trimmed,
    });
    const persisted = await persistTurnUnlocked(
      session,
      store,
      userId,
      trimmed,
      reply,
      'http',
    );
    return {
      id: session.id,
      title: redactText(session.name || session.id).slice(0, 200),
      origin: inferResumeOrigin(session),
      reply: redactText(reply),
      messageCount: session.messages.length,
      authorUserId: userId,
      seq: persisted.user.seq ?? 0,
    };
  });
}

export async function grantResumeAccess(
  sessionId: string,
  actorUserId: string,
  targetUserId: string,
): Promise<{ ok: true; authorizedUserIds: string[] } | { error: 'not_found' | 'bad_request' }> {
  const target = targetUserId.trim();
  if (!isResumeSessionId(sessionId) || !isSharedProfileId(target)) {
    return { error: 'not_found' };
  }
  if (target === actorUserId) {
    return { error: 'bad_request' };
  }
  return enqueueSessionTurn(sessionId, async () => {
    const store = createStore();
    const session = await store.loadSession(sessionId);
    if (!session || !canAccessResumeSession(session, actorUserId)) {
      return { error: 'not_found' as const };
    }
    const owner = resumeSessionOwner(session);
    if (owner && owner !== actorUserId) {
      return { error: 'not_found' as const };
    }
    if (!owner) {
      session.metadata = { ...session.metadata, ownerUserId: actorUserId };
    }
    const authorized = resumeAuthorizedUserIds(session);
    if (!authorized.includes(target)) authorized.push(target);
    session.metadata = {
      ...session.metadata,
      ownerUserId: resumeSessionOwner(session) ?? actorUserId,
      authorizedUserIds: authorized,
    };
    await store.saveSession(session);
    return { ok: true as const, authorizedUserIds: authorized };
  });
}

export function readMobileJwtUserId(req: Request): string | undefined {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const secret = process.env.JWT_SECRET ?? '';
  if (!token || !secret) return undefined;
  const payload = verifyToken(token, secret);
  const sub = payload && typeof payload.sub === 'string' ? payload.sub.trim() : '';
  return sub || undefined;
}

/** Resume routes require a real JWT — loopback without a token is not enough. */
export function requireResumeAccess(req: Request, res: Response, next: NextFunction): void {
  const userId = readMobileJwtUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'Session access requires a token' });
    return;
  }
  (req as Request & { resumeUserId: string }).resumeUserId = userId;
  next();
}

function resumeUserId(req: Request): string {
  return (req as Request & { resumeUserId?: string }).resumeUserId
    ?? readMobileJwtUserId(req)
    ?? '';
}

export async function handleListResumeSessions(req: Request, res: Response): Promise<void> {
  try {
    const sessions = await listResumeSessions(resumeUserId(req));
    res.json({ sessions });
  } catch (error) {
    logger.warn('Mobile resume session list failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to list sessions' });
  }
}

export async function handleGetResumeSession(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id ?? '');
  try {
    const session = await loadResumeSession(id, resumeUserId(req));
    if (!session) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(session);
  } catch (error) {
    logger.warn('Mobile resume session detail failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to load session' });
  }
}

export async function handleContinueResumeSession(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id ?? '');
  const message = typeof (req.body as { message?: unknown } | undefined)?.message === 'string'
    ? (req.body as { message: string }).message
    : '';
  try {
    const result = await continueResumeSession(id, resumeUserId(req), message);
    if ('error' in result) {
      if (result.error === 'bad_request') {
        res.status(400).json({ error: 'Bad request', message: 'message is required' });
        return;
      }
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(result);
  } catch (error) {
    logger.warn('Mobile resume session continue failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(502).json({ error: 'Continue failed' });
  }
}

export async function handleGrantResumeAccess(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id ?? '');
  const body = req.body as { userId?: unknown } | undefined;
  const target = typeof body?.userId === 'string' ? body.userId : '';
  try {
    const result = await grantResumeAccess(id, resumeUserId(req), target);
    if ('error' in result) {
      if (result.error === 'bad_request') {
        res.status(400).json({ error: 'Bad request' });
        return;
      }
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ id, authorizedUserIds: result.authorizedUserIds });
  } catch (error) {
    logger.warn('Shared session grant failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Grant failed' });
  }
}

export async function handleGetSharedPresence(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id ?? '');
  try {
    const session = await loadAccessibleResumeSession(id, resumeUserId(req));
    if (!session) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({
      sessionId: session.id,
      participants: listSharedParticipants(session.id),
    });
  } catch (error) {
    logger.warn('Shared session presence failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to load presence' });
  }
}

export function seedHistoryForAgent(session: Session): Array<{ role: 'user' | 'assistant'; content: string }> {
  return visibleMessages(session).map((row) => ({ role: row.role, content: row.content }));
}

export async function persistResumeTurnUnlocked(
  sessionId: string,
  userId: string,
  userText: string,
  assistantText: string,
  surface = 'websocket',
): Promise<void> {
  if (!isResumeSessionId(sessionId) || !userText.trim()) return;
  const store = createStore();
  const session = await store.loadSession(sessionId);
  if (!session || !canAccessResumeSession(session, userId)) return;
  await persistTurnUnlocked(session, store, userId, userText, assistantText, surface);
}

export async function persistMobileResumeTurn(
  sessionId: string,
  userId: string,
  userText: string,
  assistantText: string,
): Promise<void> {
  if (!isResumeSessionId(sessionId) || !userText.trim()) return;
  await enqueueSessionTurn(sessionId, () =>
    persistResumeTurnUnlocked(sessionId, userId, userText, assistantText, 'websocket'));
}

export async function loadAccessibleResumeSession(
  sessionId: string,
  userId: string | undefined,
): Promise<Session | null> {
  if (!userId || !isResumeSessionId(sessionId)) return null;
  const store = createStore();
  const session = await store.loadSession(sessionId);
  if (!session || !canAccessResumeSession(session, userId)) return null;
  return session;
}
