import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { restoreSessionHistory } from '../../src/persistence/session-history.js';
import { SessionStore } from '../../src/persistence/session-store.js';
import { SessionFacade } from '../../src/agent/facades/session-facade.js';
import { SessionEncryption } from '../../src/security/session-encryption.js';
import type { CheckpointManager } from '../../src/checkpoints/checkpoint-manager.js';
import type { ChatEntry } from '../../src/agent/types.js';

let dir: string;
let store: SessionStore;
let facade: SessionFacade;
const history: ChatEntry[] = [
  { type: 'user', content: 'private-session-fixture', timestamp: new Date('2026-01-01') },
  { type: 'tool_call', content: '', timestamp: new Date('2026-01-01'), toolCall: {
    id: 'call-123', type: 'function', function: { name: 'bash', arguments: '{"command":"npm test"}' },
  } },
  { type: 'tool_result', content: 'failed', timestamp: new Date('2026-01-01'), toolCall: {
    id: 'call-123', type: 'function', function: { name: 'bash', arguments: '{"command":"npm test"}' },
  }, toolResult: { success: false, output: 'assertion failed', error: 'exit 1' } },
];

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-session-integrity-'));
  vi.stubEnv('CODEBUDDY_SESSIONS_DIR', dir);
  vi.stubEnv('SESSION_ENCRYPTION', 'false');
  store = new SessionStore({ useSQLite: false, encryptionKeyPath: path.join(dir, 'key') });
  facade = new SessionFacade({ sessionStore: store, checkpointManager: {} as CheckpointManager });
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('session persistence integrity', () => {
  it('preserves tool ids, arguments, results and plural calls after a fresh load', async () => {
    const session = await store.createSession('fixture');
    const entries = [...history, { type: 'assistant' as const, content: '', timestamp: new Date(), toolCalls: [history[1]!.toolCall!] }];
    await facade.saveCurrentSession(entries);
    const fresh = new SessionStore({ useSQLite: false });
    const restored = await fresh.loadSession(session.id);
    expect(fresh.convertMessagesToChatEntries(restored!.messages)).toEqual(entries);
  });

  it('decrypts for resume, export and fork, keeping forks and metadata saves encrypted', async () => {
    vi.stubEnv('SESSION_ENCRYPTION', 'true');
    const session = await store.createSession('fixture');
    await facade.saveCurrentSession(history);
    const file = path.join(dir, session.id + '.json');
    expect(await fs.readFile(file, 'utf8')).not.toContain(history[0]!.content);
    const fresh = new SessionStore({ useSQLite: false, encryptionKeyPath: path.join(dir, 'key') });
    vi.stubEnv('SESSION_ENCRYPTION', 'false');
    const restored = await fresh.resumeSession(session.id);
    expect(fresh.convertMessagesToChatEntries(restored!.messages)).toEqual(history);
    expect(await fresh.exportSessionToFile(session.id, path.join(dir, 'export.md'))).toBeTruthy();
    expect(await fs.readFile(path.join(dir, 'export.md'), 'utf8')).toContain(history[0]!.content);
    await fresh.attachUsageToCurrentSession({ inputTokens: 1, outputTokens: 2, totalCost: 0 });
    expect(await fs.readFile(file, 'utf8')).not.toContain(history[0]!.content);
    const forkFacade = new SessionFacade({ sessionStore: fresh, checkpointManager: {} as CheckpointManager });
    await forkFacade.forkSessionAtTurn(session.id, 'fork-fixture', 1);
    expect(await fs.readFile(path.join(dir, 'fork-fixture.json'), 'utf8')).not.toContain(history[0]!.content);
    expect((await fresh.loadSession('fork-fixture'))!.messages[0]!.content).toBe(history[0]!.content);
  });

  it('refuses encryption failure without changing the previous bytes', async () => {
    const session = await store.createSession('fixture');
    const file = path.join(dir, session.id + '.json');
    const before = await fs.readFile(file, 'utf8');
    vi.stubEnv('SESSION_ENCRYPTION', 'true');
    vi.spyOn(SessionEncryption.prototype, 'encryptObject').mockImplementation(() => { throw new Error('crypto failed'); });
    await expect(facade.saveCurrentSession(history)).rejects.toThrow(/crypto|encrypt/i);
    expect(await fs.readFile(file, 'utf8')).toBe(before);
  });

  it('refuses missing keys without creating replacements or overwriting the session', async () => {
    vi.stubEnv('SESSION_ENCRYPTION', 'true');
    const session = await store.createSession('fixture');
    await facade.saveCurrentSession(history);
    const before = await fs.readFile(path.join(dir, session.id + '.json'), 'utf8');
    await fs.unlink(path.join(dir, 'key'));
    const fresh = new SessionStore({ useSQLite: false, encryptionKeyPath: path.join(dir, 'key') });
    await expect(fresh.loadSession(session.id)).rejects.toThrow(/key|decrypt/i);
    expect(await fs.stat(path.join(dir, 'key')).then(() => true, () => false)).toBe(false);
    expect(await fs.readFile(path.join(dir, session.id + '.json'), 'utf8')).toBe(before);
  });

  it('reads legacy encrypted ChatEntry envelopes with typed timestamps', async () => {
    const session = await store.createSession('fixture');
    const enc = new SessionEncryption({ keyPath: path.join(dir, 'key') });
    await enc.initialize();
    session.messages = [{ type: 'assistant', timestamp: new Date().toISOString(), content: JSON.stringify({ __encrypted: true, data: enc.encryptObject(history) }) }];
    await store.saveSession(session);
    const restored = await store.loadSession(session.id);
    expect(store.convertMessagesToChatEntries(restored!.messages)).toEqual(history);
  });
});

it('rehydrates paired tool evidence for the next provider request', async () => {
  const session = await store.createSession('fixture');
  await facade.saveCurrentSession(history);
  const loaded = await store.loadSession(session.id);
  const messages = restoreSessionHistory(store.convertMessagesToChatEntries(loaded!.messages));
  expect(messages).toEqual([
    { role: 'user', content: history[0]!.content },
    { role: 'assistant', content: '', tool_calls: [history[1]!.toolCall] },
    { role: 'tool', tool_call_id: 'call-123', content: JSON.stringify(history[2]!.toolResult) },
  ]);
});

it('retains legacy tool evidence without fabricating a paired call', () => {
  const entries = store.convertMessagesToChatEntries([{ type: 'tool_result', timestamp: new Date().toISOString(), content: 'compiler failed', toolCallName: 'bash', toolCallSuccess: false }]);
  const restored = restoreSessionHistory(entries);
  expect(restored[0]?.role).toBe('assistant');
  expect(restored[0]?.content).toContain('compiler failed');
});

it('keeps appended messages out of plaintext JSON including automatic titles', async () => {
  vi.stubEnv('SESSION_ENCRYPTION', 'true');
  const session = await store.createSession('fixture');
  await store.addMessageToCurrentSession(history[0]!);
  const raw = await fs.readFile(path.join(dir, session.id + '.json'), 'utf8');
  expect(raw).not.toContain(history[0]!.content);
  expect((await store.loadSession(session.id))!.messages[0]!.content).toBe(history[0]!.content);
});

it('detects tampered ciphertext and leaves the encrypted file intact', async () => {
  vi.stubEnv('SESSION_ENCRYPTION', 'true');
  const session = await store.createSession('fixture');
  await facade.saveCurrentSession(history);
  const file = path.join(dir, session.id + '.json');
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  const envelope = JSON.parse(data.messages[0].content);
  envelope.data.authTag = Buffer.alloc(16).toString('base64');
  data.messages[0].content = JSON.stringify(envelope);
  const corrupted = JSON.stringify(data);
  await fs.writeFile(file, corrupted);
  await expect(store.resumeSession(session.id)).rejects.toThrow(/decrypt/i);
  expect(await fs.readFile(file, 'utf8')).toBe(corrupted);
});

it('preserves structured fields in JSON export', async () => {
  const session = await store.createSession('fixture');
  await facade.saveCurrentSession(history);
  const exported = JSON.parse((await store.exportToJson(session.id))!);
  expect(store.convertMessagesToChatEntries(exported.messages)).toEqual(history);
});
