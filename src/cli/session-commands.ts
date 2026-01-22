/**
 * Session management commands for Code Buddy CLI
 *
 * Handles session continuation and resumption
 */

import { logger } from "../utils/logger.js";

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
    const date = session.lastAccessedAt.toLocaleDateString();
    const time = session.lastAccessedAt.toLocaleTimeString();
    console.log(`  ${session.id.slice(0, 8)} - ${session.name}`);
    console.log(`    ${session.messages.length} messages | ${date} ${time}`);
  });

  console.log('\nUse --resume <id> to resume a session');
}
