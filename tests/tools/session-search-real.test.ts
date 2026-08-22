import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatEntry } from '../../src/agent/types.js';

let tempHome: string;
let previousHome: string | undefined;
let previousSessionsDir: string | undefined;

async function resetStores(): Promise<void> {
  const { resetSessionStore } = await import('../../src/persistence/session-store.js');
  const { resetDatabaseManager } = await import('../../src/database/database-manager.js');
  const { resetSessionRepository } = await import('../../src/database/repositories/session-repository.js');
  resetSessionStore();
  resetSessionRepository();
  resetDatabaseManager();
}

function message(type: ChatEntry['type'], content: string): ChatEntry {
  return {
    type,
    content,
    timestamp: new Date(),
  };
}

describe('session_search real saved-session integration', () => {
  beforeEach(async () => {
    previousHome = process.env.CODEBUDDY_HOME;
    previousSessionsDir = process.env.CODEBUDDY_SESSIONS_DIR;
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-session-search-'));
    process.env.CODEBUDDY_HOME = tempHome;
    process.env.CODEBUDDY_SESSIONS_DIR = path.join(tempHome, 'sessions');
    await resetStores();
  });

  afterEach(async () => {
    await resetStores();
    if (previousHome === undefined) {
      delete process.env.CODEBUDDY_HOME;
    } else {
      process.env.CODEBUDDY_HOME = previousHome;
    }
    if (previousSessionsDir === undefined) {
      delete process.env.CODEBUDDY_SESSIONS_DIR;
    } else {
      process.env.CODEBUDDY_SESSIONS_DIR = previousSessionsDir;
    }
    await fs.rm(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('finds a real persisted session through the agent tool', async () => {
    const uniqueTerm = `hermesneedle${Math.random().toString(36).slice(2, 10)}`;
    const { getSessionStore } = await import('../../src/persistence/session-store.js');
    const store = getSessionStore();
    const session = await store.createSession('Hermes parity recall', 'real-test-model');

    await store.addMessageToCurrentSession(
      message('user', 'Please keep this recall session searchable.'),
    );
    await store.addMessageToCurrentSession(
      message('assistant', `Saved into the real session store with marker ${uniqueTerm}.`),
    );

    const { createSessionTools } = await import('../../src/tools/registry/session-tools.js');
    const searchTool = createSessionTools().find((tool) => tool.name === 'session_search');
    expect(searchTool).toBeDefined();

    const result = await searchTool!.execute({ query: uniqueTerm, limit: 5 });
    expect(result.success, result.error).toBe(true);
    expect(result.output).toBeTruthy();

    const payload = JSON.parse(result.output!) as {
      query: string;
      total: number;
      sessions: Array<{
        id: string;
        name: string;
        model: string;
        messageCount: number;
        citation: { sessionId: string; messageId?: number; role?: string; snippet: string; label: string };
        match: { snippet: string; role?: string; citation?: { sessionId: string; snippet: string } };
      }>;
      citations: Array<{ sessionId: string; snippet: string; label: string }>;
    };

    expect(payload.query).toBe(uniqueTerm);
    expect(payload.total).toBe(1);
    expect(payload.sessions[0]).toMatchObject({
      id: session.id,
      model: 'real-test-model',
      messageCount: 2,
    });
    expect(payload.sessions[0]?.match.snippet).toContain(uniqueTerm);
    expect(payload.sessions[0]?.match.role).toBe('assistant');
    expect(payload.sessions[0]?.citation.sessionId).toBe(session.id);
    expect(payload.sessions[0]?.citation.snippet).toContain(uniqueTerm);
    expect(payload.sessions[0]?.citation.label).toContain(session.id);
    expect(payload.citations[0]?.sessionId).toBe(session.id);
  });
});
