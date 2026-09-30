/**
 * Session management commands for Code Buddy CLI
 *
 * Handles session continuation and resumption
 */

import type { Command } from 'commander';
import { logger } from '../utils/logger.js';

interface CliSessionSummary {
  id?: unknown;
  name?: unknown;
  messages?: unknown;
  lastAccessedAt?: unknown;
  metadata?: unknown;
}

function metadataRecord(session: CliSessionSummary): Record<string, unknown> | undefined {
  return session.metadata && typeof session.metadata === 'object'
    ? session.metadata as Record<string, unknown>
    : undefined;
}

function parentSessionId(session: CliSessionSummary): string | undefined {
  const metadata = metadataRecord(session);
  const parent = metadata?.parentSessionId ||
    metadata?.branchedFrom ||
    metadata?.clonedFrom ||
    metadata?.forkedFrom;

  return typeof parent === 'string' ? parent : undefined;
}

function sessionId(session: CliSessionSummary): string {
  return typeof session.id === 'string' && session.id.trim().length > 0
    ? session.id
    : 'unknown';
}

function sessionName(session: CliSessionSummary): string {
  return typeof session.name === 'string' && session.name.trim().length > 0
    ? session.name
    : '(unnamed)';
}

function messageCount(session: CliSessionSummary): number {
  return Array.isArray(session.messages) ? session.messages.length : 0;
}

function sessionLastAccessed(session: CliSessionSummary): Date | null {
  const value = session.lastAccessedAt;
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}

function printSessionSummary(session: CliSessionSummary, origin?: string): void {
  const lastAccessed = sessionLastAccessed(session);
  const date = lastAccessed?.toLocaleDateString() ?? '(no date)';
  const time = lastAccessed?.toLocaleTimeString() ?? '';
  const parent = parentSessionId(session);
  const metadata = metadataRecord(session);
  const snippet = typeof metadata?.searchSnippet === 'string'
    ? oneLine(metadata.searchSnippet)
    : undefined;
  const role = typeof metadata?.searchRole === 'string'
    ? metadata.searchRole
    : undefined;
  const surface = origin
    ?? (typeof metadata?.handoffSource === 'string' ? metadata.handoffSource : undefined)
    ?? (typeof metadata?.origin === 'string' ? metadata.origin : undefined)
    ?? (typeof metadata?.surface === 'string' ? metadata.surface : undefined);

  console.log(`  ${sessionId(session)} - ${sessionName(session)}`);
  console.log(`    ${messageCount(session)} messages | ${date} ${time}`.trimEnd());
  if (surface) {
    console.log(`    origin: ${surface}`);
  }
  if (parent) {
    console.log(`    parent: ${parent}`);
  }
  if (snippet) {
    const roleText = role ? ` (${role})` : '';
    console.log(`    match${roleText}: ${clip(snippet, 140)}`);
  }
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

/**
 * Register saved-session subcommands.
 */
export function registerSessionCommands(program: Command): void {
  const session = program
    .command('session')
    .alias('sessions')
    .description('Manage saved sessions');

  session
    .command('list')
    .alias('ls')
    .description('List recent saved sessions')
    .option('--limit <count>', 'maximum number of sessions to show', parsePositiveInteger, 10)
    .action(async (options: { limit: number }) => {
      await listSessions(options.limit);
    });

  session
    .command('search')
    .description('Search saved sessions by content')
    .argument('<query...>', 'search query')
    .option('--limit <count>', 'maximum number of matches to show', parsePositiveInteger, 10)
    .action(async (queryParts: string[], options: { limit: number }) => {
      await searchSessions(queryParts.join(' '), options.limit);
    });

  session
    .command('resume')
    .description('Resume a saved session by ID or partial ID; without an ID, pick among recent sessions')
    .argument('[sessionId]', 'session ID or unique prefix (omit to pick interactively)')
    .option('--limit <count>', 'recent sessions offered by the picker', parsePositiveInteger, 20)
    .action(async (sessionId: string | undefined, options: { limit: number }) => {
      if (sessionId) {
        await resumeSessionById(sessionId);
        return;
      }
      const picked = await pickRecentSession(options.limit);
      if (!picked) return;
      await resumeSessionById(picked);
    });

  session
    .command('last')
    .description('Resume the most recently used session')
    .action(async () => {
      await resumeLastSession();
    });
}

/**
 * Resume the last session (--continue flag)
 */
export async function resumeLastSession(): Promise<void> {
  const { getSessionStore } = await import('../persistence/session-store.js');
  const sessionStore = getSessionStore();
  const lastSession = await sessionStore.getLastSession();

  if (!lastSession) {
    logger.error('No sessions found. Start a new session first.');
    process.exit(1);
  }

  await sessionStore.resumeSession(lastSession.id);
  console.log(`Resuming session: ${lastSession.name} (${lastSession.id})`);
  console.log(
    `   ${lastSession.messages.length} messages, last accessed: ${lastSession.lastAccessedAt.toLocaleString()}\n`
  );
}

export type SessionIdMatch<T extends { id: string }> =
  | { kind: 'found'; session: T }
  | { kind: 'ambiguous'; matches: T[] }
  | { kind: 'none' };

/**
 * Resolve a user-typed session id. An exact id always wins; otherwise a
 * prefix (then, for backward compatibility, a substring) must designate
 * exactly one session. Several candidates is an ambiguity, never "the first".
 */
export function resolveSessionIdMatch<T extends { id: string }>(sessions: readonly T[], id: string): SessionIdMatch<T> {
  const exact = sessions.find((s) => s.id === id);
  if (exact) return { kind: 'found', session: exact };
  for (const predicate of [(s: T) => s.id.startsWith(id), (s: T) => s.id.includes(id)]) {
    const matches = sessions.filter(predicate);
    if (matches.length === 1) return { kind: 'found', session: matches[0]! };
    if (matches.length > 1) return { kind: 'ambiguous', matches };
  }
  return { kind: 'none' };
}

export function reportAmbiguousSessionId(
  typedId: string,
  matches: ReadonlyArray<{ id: string; name: string; messages: readonly unknown[] }>,
): void {
  logger.error(`Ambiguous session id: ${typedId} matches ${matches.length} sessions.`);
  console.log('\nPaste more of the id (or the full id from `buddy session list`):');
  matches.slice(0, 10).forEach((s) => {
    console.log(`   ${s.id} - ${s.name} (${s.messages.length} messages)`);
  });
}

/**
 * Resume a specific session by ID (--resume flag)
 */
export async function resumeSessionById(sessionId: string): Promise<void> {
  const { getSessionStore } = await import('../persistence/session-store.js');
  const sessionStore = getSessionStore();
  let resolvedId = sessionId;
  try {
    const { materializeUnifiedSession } = await import('../persistence/unified-session-index.js');
    const materialized = await materializeUnifiedSession(sessionId);
    if (materialized?.id) resolvedId = materialized.id;
  } catch {
    // Index is advisory: a missing Cowork DB must not block a SessionStore resume.
  }
  // Refuse an ambiguous abbreviated id instead of resuming the first loose
  // match (same rule as materializeUnifiedSession).
  const match = resolveSessionIdMatch(await sessionStore.listSessions(), resolvedId);
  if (match.kind === 'ambiguous') {
    reportAmbiguousSessionId(sessionId, match.matches);
    process.exit(1);
  }
  const session = match.kind === 'found' ? match.session : null;

  if (!session) {
    logger.error(`Session not found: ${sessionId}`);
    console.log('\nRecent sessions:');
    const recent = await sessionStore.getRecentSessions(5);
    recent.forEach((s) => {
      console.log(`   ${s.id} - ${s.name} (${s.messages.length} messages)`);
    });
    process.exit(1);
  }

  await sessionStore.resumeSession(session.id);
  console.log(`Resuming session: ${session.name} (${session.id})`);
  console.log(
    `   ${session.messages.length} messages, last accessed: ${session.lastAccessedAt.toLocaleString()}`
  );
  const { buildSessionRecap, formatSessionRecap } = await import('./session-picker.js');
  console.log(`${formatSessionRecap(buildSessionRecap(session)).join('\n')}\n`);
  console.log(`Continue it in the terminal with: buddy --resume ${session.id}`);
}

/**
 * Offer recent sessions without requiring an ID (P6). Non-interactive stdio:
 * print the list and set exit code 1 (never waits for input). Returns the
 * chosen session id, or null.
 */
export async function pickRecentSession(
  limit = 20,
  streams: { input: NodeJS.ReadStream; output: NodeJS.WriteStream } = { input: process.stdin, output: process.stdout },
): Promise<string | null> {
  const { getSessionStore } = await import('../persistence/session-store.js');
  const sessions = await getSessionStore().getRecentSessions(limit);
  if (sessions.length === 0) {
    console.log('No sessions found.');
    process.exitCode = 1;
    return null;
  }
  if (!streams.input.isTTY || !streams.output.isTTY) {
    console.log(`Recent sessions (${sessions.length}):\n`);
    sessions.forEach((session) => printSessionSummary(session));
    console.log('\nNo interactive terminal: pass an ID, e.g. `buddy session resume <id>` or `buddy --resume <id>`.');
    process.exitCode = 1;
    return null;
  }
  const { pickSession } = await import('./session-picker.js');
  const picked = await pickSession(sessions, streams);
  if (!picked) {
    console.log('Cancelled.');
    process.exitCode = 1;
    return null;
  }
  return picked.id;
}

/**
 * List recent sessions
 */
export async function listSessions(count: number = 10): Promise<void> {
  try {
    const { listUnifiedSessions } = await import('../persistence/unified-session-index.js');
    const unified = listUnifiedSessions({ limit: count });
    if (unified.length > 0) {
      console.log(`Recent sessions (${unified.length}):\n`);
      for (const row of unified) {
        console.log(`  ${row.id} - ${row.title}`);
        console.log(`    ${row.messageCount} messages | ${new Date(row.updatedAt).toLocaleDateString()} ${new Date(row.updatedAt).toLocaleTimeString()}`.trimEnd());
        console.log(`    origin: ${row.origin}`);
      }
      console.log('\nUse `buddy sessions resume <id>` to resume a session');
      return;
    }
  } catch {
    // Fall back to SessionStore-only listing.
  }

  const { getSessionStore } = await import('../persistence/session-store.js');
  const sessionStore = getSessionStore();
  const sessions = await sessionStore.getRecentSessions(count);

  if (sessions.length === 0) {
    console.log('No sessions found.');
    return;
  }

  console.log(`Recent sessions (${sessions.length}):\n`);
  sessions.forEach((session) => {
    printSessionSummary(session);
  });

  console.log('\nUse `buddy session resume <id>` to resume a session');
}

/**
 * Search saved sessions by content.
 */
export async function searchSessions(query: string, count: number = 10): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) {
    logger.error('Search query is empty.');
    process.exit(1);
  }

  const { getSessionStore } = await import('../persistence/session-store.js');
  const sessionStore = getSessionStore();
  const sessions = (await sessionStore.searchSessions(trimmed)).slice(0, count);

  if (sessions.length === 0) {
    console.log(`No sessions found matching: ${trimmed}`);
    return;
  }

  console.log(`Session search results for "${trimmed}" (${sessions.length}):\n`);
  sessions.forEach((session) => {
    printSessionSummary(session);
  });

  console.log('\nUse `buddy session resume <id>` to resume a session');
}
