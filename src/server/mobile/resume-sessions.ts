/**
 * Read and continue CLI / Cowork-handoff sessions from the mobile PWA.
 *
 * Storage is the existing SessionStore JSON tree (CODEBUDDY_SESSIONS_DIR or
 * ~/.codebuddy/sessions). No SQLite schema change. Secrets are redacted
 * before any payload leaves the process; JWT tokens are never echoed.
 */

import type { NextFunction, Request, Response } from 'express';
import { getDataRedactionEngine } from '../../security/data-redaction.js';
import {
  SessionStore,
  type Session,
  type SessionMessage,
} from '../../persistence/session-store.js';
import {
  listUnifiedSessions,
  materializeUnifiedSession,
} from '../../persistence/unified-session-index.js';
import { verifyToken } from '../auth/jwt.js';
import {
  buildHttpAgentSessionKey,
  withHttpSessionAgent,
} from '../http-agent-sessions.js';
import { runAgentCompletion } from '../agent-adapter.js';
import { logger } from '../../utils/logger.js';

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
}

export type ResumeTurnRunner = (input: {
  sessionId: string;
  userId: string;
  history: ResumeSessionMessage[];
  message: string;
}) => Promise<{ reply: string }>;

const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_LIST = 50;
const MAX_MESSAGE_CHARS = 100_000;
const MAX_DETAIL_MESSAGES = 400;

let resumeTurnRunner: ResumeTurnRunner | null = null;
let storeFactory: (() => SessionStore) | null = null;

export function setResumeTurnRunnerForTests(runner: ResumeTurnRunner | null): void {
  resumeTurnRunner = runner;
}

export function setResumeSessionStoreFactoryForTests(factory: (() => SessionStore) | null): void {
  storeFactory = factory;
}

export function isResumeSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

function createStore(): SessionStore {
  return storeFactory ? storeFactory() : new SessionStore({ useSQLite: false });
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

/**
 * A session tagged with ownerUserId is visible only to that JWT subject.
 * Untagged local (CLI) sessions belong to the machine owner: the configured
 * CODEBUDDY_OWNER_USER_ID, or any authenticated caller when that env is unset.
 */
export function canAccessResumeSession(
  session: Pick<Session, 'metadata'>,
  userId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!userId) return false;
  const owner = resumeSessionOwner(session);
  if (owner) return owner === userId;
  const configured = (env.CODEBUDDY_OWNER_USER_ID ?? '').trim();
  if (!configured) return true;
  return userId === configured;
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

function visibleMessages(session: Session): ResumeSessionMessage[] {
  const out: ResumeSessionMessage[] = [];
  for (const message of session.messages) {
    if (message.type !== 'user' && message.type !== 'assistant') continue;
    if (typeof message.content !== 'string' || !message.content.trim()) continue;
    out.push({
      role: message.type,
      content: redactText(message.content).slice(0, MAX_MESSAGE_CHARS),
      timestamp: message.timestamp,
    });
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

export async function listResumeSessions(userId: string): Promise<ResumeSessionSummary[]> {
  return listUnifiedSessions({ ownerUserId: userId, limit: MAX_LIST }).map((row) => ({
    id: row.id,
    title: row.title,
    origin: row.origin as ResumeOrigin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messageCount: row.messageCount,
  }));
}

export async function loadResumeSession(
  sessionId: string,
  userId: string,
): Promise<ResumeSessionDetail | null> {
  if (!isResumeSessionId(sessionId)) return null;
  const store = createStore();
  const materialized = await materializeUnifiedSession(sessionId, { ownerUserId: userId });
  const resolvedId = materialized?.id ?? sessionId;
  const session = await store.loadSession(resolvedId);
  if (!session || !canAccessResumeSession(session, userId)) return null;
  return {
    ...toSummary(session),
    messages: visibleMessages(session),
  };
}

async function defaultTurnRunner(input: {
  sessionId: string;
  userId: string;
  history: ResumeSessionMessage[];
  message: string;
}): Promise<{ reply: string }> {
  const sessionKey = buildHttpAgentSessionKey(`user:${input.userId}`, input.sessionId);
  const reply = await withHttpSessionAgent(
    sessionKey,
    async (agent) => {
      const result = await runAgentCompletion(agent, input.message, { surface: 'mobile' });
      return result.content || '';
    },
    input.history.map((row) => ({ role: row.role, content: row.content })),
  );
  return { reply: redactText(reply) };
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
  const store = createStore();
  const materialized = await materializeUnifiedSession(sessionId, { ownerUserId: userId });
  const resolvedId = materialized?.id ?? sessionId;
  const session = await store.loadSession(resolvedId);
  if (!session || !canAccessResumeSession(session, userId)) {
    return { error: 'not_found' };
  }

  const history = visibleMessages(session);
  const runner = resumeTurnRunner ?? defaultTurnRunner;
  const { reply } = await runner({
    sessionId: resolvedId,
    userId,
    history,
    message: trimmed,
  });
  const now = new Date().toISOString();
  const userMessage: SessionMessage = {
    type: 'user',
    content: trimmed,
    timestamp: now,
  };
  const assistantMessage: SessionMessage = {
    type: 'assistant',
    content: reply,
    timestamp: now,
  };
  session.messages = [...session.messages, userMessage, assistantMessage];
  session.lastAccessedAt = new Date();
  session.metadata = {
    ...session.metadata,
    lastSurface: 'mobile',
    ownerUserId: resumeSessionOwner(session) ?? userId,
  };
  await store.saveSession(session);
  return {
    id: resolvedId,
    title: redactText(session.name || session.id).slice(0, 200),
    origin: inferResumeOrigin(session),
    reply: redactText(reply),
    messageCount: session.messages.length,
  };
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

export function seedHistoryForAgent(session: Session): Array<{ role: 'user' | 'assistant'; content: string }> {
  return visibleMessages(session).map((row) => ({ role: row.role, content: row.content }));
}

export async function persistMobileResumeTurn(
  sessionId: string,
  userId: string,
  userText: string,
  assistantText: string,
): Promise<void> {
  if (!isResumeSessionId(sessionId) || !userText.trim()) return;
  const store = createStore();
  const session = await store.loadSession(sessionId);
  if (!session || !canAccessResumeSession(session, userId)) return;
  const now = new Date().toISOString();
  session.messages = [
    ...session.messages,
    { type: 'user', content: userText, timestamp: now },
    { type: 'assistant', content: assistantText, timestamp: now },
  ];
  session.lastAccessedAt = new Date();
  session.metadata = {
    ...session.metadata,
    lastSurface: 'mobile',
    ownerUserId: resumeSessionOwner(session) ?? userId,
  };
  await store.saveSession(session);
}

export async function loadAccessibleResumeSession(
  sessionId: string,
  userId: string | undefined,
): Promise<Session | null> {
  if (!userId || !isResumeSessionId(sessionId)) return null;
  const store = createStore();
  const materialized = await materializeUnifiedSession(sessionId, { ownerUserId: userId });
  const session = await store.loadSession(materialized?.id ?? sessionId);
  if (!session || !canAccessResumeSession(session, userId)) return null;
  return session;
}
