/**
 * In-memory presence for a shared SessionStore thread.
 *
 * Delivery uses the existing WebSocket `broadcast()` (injected) with a
 * target filter on `boundSessionId`. This is not a second channel.
 */

import type { WebSocketResponse } from '../types.js';

export type SharedSurface = 'cli' | 'cowork' | 'mobile' | 'unknown';

export interface SharedParticipant {
  connectionId: string;
  userId: string;
  surface: SharedSurface;
  joinedAt: string;
}

export interface SharedSessionMessageEvent {
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  authorUserId: string;
  timestamp: string;
}

export interface SharedBroadcastTarget {
  boundSessionId?: string;
}

type SharedBroadcaster = (
  message: WebSocketResponse,
  scopeFilter?: string,
  targetFilter?: (target: SharedBroadcastTarget) => boolean,
) => string[];

const participants = new Map<string, SharedParticipant>();
const connectionSession = new Map<string, string>();
let broadcaster: SharedBroadcaster | null = null;

export function normalizeSharedSurface(raw: unknown): SharedSurface {
  if (raw === 'cli' || raw === 'cowork' || raw === 'mobile') return raw;
  return 'unknown';
}

export function bindSharedSessionBroadcaster(fn: SharedBroadcaster | null): void {
  broadcaster = fn;
}

export function attachSharedParticipant(input: {
  connectionId: string;
  userId: string;
  sessionId: string;
  surface?: unknown;
}): SharedParticipant[] {
  const previous = connectionSession.get(input.connectionId);
  if (previous && previous !== input.sessionId) {
    participants.delete(input.connectionId);
    connectionSession.delete(input.connectionId);
  }
  const existing = participants.get(input.connectionId);
  const joinedAt = existing && previous === input.sessionId
    ? existing.joinedAt
    : new Date().toISOString();
  participants.set(input.connectionId, {
    connectionId: input.connectionId,
    userId: input.userId,
    surface: normalizeSharedSurface(input.surface),
    joinedAt,
  });
  connectionSession.set(input.connectionId, input.sessionId);
  return listSharedParticipants(input.sessionId);
}

export function detachSharedParticipant(
  connectionId: string,
): { sessionId: string; participants: SharedParticipant[] } | undefined {
  const sessionId = connectionSession.get(connectionId);
  connectionSession.delete(connectionId);
  participants.delete(connectionId);
  if (!sessionId) return undefined;
  return { sessionId, participants: listSharedParticipants(sessionId) };
}

export function listSharedParticipants(sessionId: string): SharedParticipant[] {
  const out: SharedParticipant[] = [];
  for (const [connectionId, bound] of connectionSession) {
    if (bound !== sessionId) continue;
    const participant = participants.get(connectionId);
    if (participant) out.push(participant);
  }
  return out.sort((a, b) => {
    const byJoin = a.joinedAt.localeCompare(b.joinedAt);
    if (byJoin !== 0) return byJoin;
    return a.connectionId.localeCompare(b.connectionId);
  });
}

export function broadcastSharedSession(
  sessionId: string,
  message: WebSocketResponse,
): string[] {
  if (!broadcaster) return [];
  return broadcaster(message, undefined, (target) => target.boundSessionId === sessionId);
}

export function broadcastSharedPresence(sessionId: string): string[] {
  return broadcastSharedSession(sessionId, {
    type: 'session_presence',
    payload: {
      sessionId,
      participants: listSharedParticipants(sessionId),
    },
    timestamp: new Date().toISOString(),
  });
}

export function broadcastSharedSessionMessage(
  sessionId: string,
  event: SharedSessionMessageEvent,
): string[] {
  return broadcastSharedSession(sessionId, {
    type: 'session_message',
    payload: {
      sessionId,
      seq: event.seq,
      role: event.role,
      content: event.content,
      authorUserId: event.authorUserId,
      timestamp: event.timestamp,
    },
    timestamp: event.timestamp,
  });
}

export function resetSharedPresenceForTests(): void {
  participants.clear();
  connectionSession.clear();
}
