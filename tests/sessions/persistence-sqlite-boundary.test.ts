import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ChatEntry } from '../../src/agent/types.js';

const db = vi.hoisted(() => ({
  createSession: vi.fn(), addMessage: vi.fn(), getMessages: vi.fn(),
  getSessionById: vi.fn(), searchMessages: vi.fn(),
}));
vi.mock('../../src/database/repositories/session-repository.js', () => ({
  getSessionRepository: () => db,
  SessionRepository: class {},
}));
import { SessionStore } from '../../src/persistence/session-store.js';
let dir: string;
let store: SessionStore;
const entry: ChatEntry = { type: 'tool_result', content: 'tool-summary', timestamp: new Date('2026-01-01'),
  toolCall: { id: 'tool-123', type: 'function', function: { name: 'bash', arguments: '{"command":"npm test"}' } },
  toolResult: { success: false, error: 'failure', output: 'failed assertion' },
};
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-db-boundary-'));
  vi.stubEnv('CODEBUDDY_SESSIONS_DIR', dir);
  vi.stubEnv('SESSION_ENCRYPTION', 'false');
  store = new SessionStore({ useSQLite: true, encryptionKeyPath: path.join(dir, 'key') });
});
afterEach(async () => { vi.resetAllMocks(); vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true }); });

it('preserves tool details through the SQLite write and search conversion boundary', async () => {
  const session = await store.createSession('fixture');
  await store.addMessageToCurrentSession(entry);
  const written = db.addMessage.mock.calls[0]![0];
  expect(written.tool_calls).toEqual([entry.toolCall]);
  expect(written.metadata.sessionMessage.toolResult).toEqual(entry.toolResult);
  const message = { ...written, id: 1, created_at: entry.timestamp.toISOString() };
  db.getMessages.mockReturnValue([message]);
  db.searchMessages.mockReturnValue([{ session: { id: session.id, name: 'fixture', project_path: dir, model: 'test', created_at: session.createdAt.toISOString(), updated_at: session.lastAccessedAt.toISOString() }, message, snippet: 'tool-summary', score: 1 }]);
  // Exercise DB fallback, rather than accidentally reading the JSON copy.
  await fs.unlink(path.join(dir, session.id + '.json'));
  const found = await store.searchSessions('tool-summary');
  expect(found).toHaveLength(1);
  expect(store.convertMessagesToChatEntries(found[0]!.messages)).toEqual([entry]);
});

it('does not create a plaintext SQLite mirror for encrypted appends and clones', async () => {
  vi.stubEnv('SESSION_ENCRYPTION', 'true');
  const session = await store.createSession('fixture');
  await store.addMessageToCurrentSession(entry);
  vi.stubEnv('SESSION_ENCRYPTION', 'false');
  const clone = await store.cloneSession(session.id);
  expect(clone!.messages[0]!.toolResult).toEqual(entry.toolResult);
  expect(db.addMessage).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(dir, clone!.id + '.json'), 'utf8')).not.toContain('failed assertion');
});
