/**
 * Lot 2 A — interactive (TUI) turns are persisted to the session file.
 * Real SessionStore (JSON files in a temp dir); the agent method runs against a
 * minimal agent shape so no provider or client is constructed.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeBuddyAgent } from '../../src/agent/codebuddy-agent.js';
import type { ChatEntry } from '../../src/agent/types.js';
import { SessionStore } from '../../src/persistence/session-store.js';

type AgentShape = {
  sessionStore: SessionStore;
  historyManager: { getChatHistory: () => ChatEntry[] };
  interactivePersistence: Promise<void>;
  getCurrentModel: () => string;
  saveCurrentSession: () => Promise<void>;
};

function fakeAgent(store: SessionStore, history: ChatEntry[]): AgentShape & { persist: () => Promise<void> } {
  const shape: AgentShape = {
    sessionStore: store,
    historyManager: { getChatHistory: () => history },
    interactivePersistence: Promise.resolve(),
    getCurrentModel: () => 'fixture-model',
    saveCurrentSession: () => store.updateCurrentSession(history),
  };
  return Object.assign(shape, { persist: () => CodeBuddyAgent.prototype.persistInteractiveSession.call(shape as never) });
}

const entry = (type: ChatEntry['type'], content: string): ChatEntry => ({ type, content, timestamp: new Date() });

describe('interactive session persistence (lot 2 A)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-persist-'));
    vi.stubEnv('CODEBUDDY_SESSIONS_DIR', dir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const files = () => fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

  it('creates the session on the first turn, then rewrites it without duplicating turns', async () => {
    const store = new SessionStore({ useSQLite: false });
    const history: ChatEntry[] = [entry('user', 'Corrige la remise'), entry('assistant', 'Remise corrigée.')];
    const agent = fakeAgent(store, history);
    await agent.persist();
    expect(files()).toHaveLength(1);
    const id = store.getCurrentSessionId()!;
    history.push(entry('user', 'Et la TVA ?'), entry('assistant', 'TVA corrigée.'));
    await agent.persist();
    await agent.persist();
    const saved = await new SessionStore({ useSQLite: false }).loadSession(id);
    expect(files()).toHaveLength(1);
    expect(saved?.name).toBe('Corrige la remise');
    expect(saved?.messages.map((m) => m.content)).toEqual(['Corrige la remise', 'Remise corrigée.', 'Et la TVA ?', 'TVA corrigée.']);
  });

  it('continues a resumed session in place and leaves other sessions untouched', async () => {
    const store = new SessionStore({ useSQLite: false });
    const witness = await store.createSession('témoin', 'fixture-model');
    await store.updateCurrentSession([entry('user', 'WITNESS'), entry('assistant', 'W')]);
    const witnessBytes = fs.readFileSync(path.join(dir, `${witness.id}.json`), 'utf8');
    const resumed = await store.createSession('reprise', 'fixture-model');
    await store.updateCurrentSession([entry('user', 'old question')]);
    const history = [entry('user', 'old question'), entry('user', 'new question'), entry('assistant', 'new answer')];
    await fakeAgent(store, history).persist();
    const saved = await store.loadSession(resumed.id);
    expect(saved?.messages.map((m) => m.content)).toEqual(['old question', 'new question', 'new answer']);
    expect(fs.readFileSync(path.join(dir, `${witness.id}.json`), 'utf8')).toBe(witnessBytes);
    expect(files()).toHaveLength(2);
  });

  it('writes nothing without a user message or in ephemeral mode', async () => {
    const store = new SessionStore({ useSQLite: false });
    await fakeAgent(store, [entry('assistant', 'banner')]).persist();
    expect(files()).toHaveLength(0);
    store.setEphemeral(true);
    await fakeAgent(store, [entry('user', 'secret draft')]).persist();
    expect(files()).toHaveLength(0);
    expect(store.getCurrentSessionId()).toBeNull();
  });

  it('serializes concurrent calls into one session and never throws', async () => {
    const store = new SessionStore({ useSQLite: false });
    const history = [entry('user', 'first'), entry('assistant', 'one')];
    const agent = fakeAgent(store, history);
    await Promise.all([agent.persist(), agent.persist(), agent.persist()]);
    expect(files()).toHaveLength(1);
    const failing = fakeAgent(store, history);
    failing.saveCurrentSession = () => Promise.reject(new Error('disk full'));
    await expect(failing.persist()).resolves.toBeUndefined();
  });
});
