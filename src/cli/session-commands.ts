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

function printSessionSummary(session: CliSessionSummary): void {
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

  console.log(`  ${sessionId(session).slice(0, 8)} - ${sessionName(session)}`);
  console.log(`    ${messageCount(session)} messages | ${date} ${time}`.trimEnd());
  if (parent) {
    console.log(`    parent: ${parent.slice(0, 8)}`);
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
    .description('Resume a saved session by ID or partial ID')
    .argument('<sessionId>', 'session ID or unique prefix')
    .action(async (sessionId: string) => {
      await resumeSessionById(sessionId);
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
  console.log(`Resuming session: ${lastSession.name} (${lastSession.id.slice(0, 8)})`);
  console.log(
    `   ${lastSession.messages.length} messages, last accessed: ${lastSession.lastAccessedAt.toLocaleString()}\n`
  );
}

/**
 * Resume a specific session by ID (--resume flag)
 */
export async function resumeSessionById(sessionId: string): Promise<void> {
  const { getSessionStore } = await import('../persistence/session-store.js');
  const sessionStore = getSessionStore();
  const session = await sessionStore.getSessionByPartialId(sessionId);

  if (!session) {
    logger.error(`Session not found: ${sessionId}`);
    console.log('\nRecent sessions:');
    const recent = await sessionStore.getRecentSessions(5);
    recent.forEach((s) => {
      console.log(`   ${s.id.slice(0, 8)} - ${s.name} (${s.messages.length} messages)`);
    });
    process.exit(1);
  }

  await sessionStore.resumeSession(session.id);
  console.log(`Resuming session: ${session.name} (${session.id.slice(0, 8)})`);
  console.log(
    `   ${session.messages.length} messages, last accessed: ${session.lastAccessedAt.toLocaleString()}\n`
  );
}

/**
 * List recent sessions
 */
export async function listSessions(count: number = 10): Promise<void> {
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
