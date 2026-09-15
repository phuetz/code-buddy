/** P6 — resume without an ID: picker, non-TTY behaviour and local recap. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clientSpy = vi.hoisted(() => ({ constructed: 0 }));
vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: class {
    constructor() { clientSpy.constructed += 1; }
  },
}));

import { buildSessionRecap, filterSessions, pickSession } from '../../src/cli/session-picker.js';
import { pickRecentSession, resumeSessionById } from '../../src/cli/session-commands.js';

function fakeTty(): { input: NodeJS.ReadStream; output: NodeJS.WriteStream; written: () => string } {
  const input = new PassThrough() as unknown as NodeJS.ReadStream & { setRawMode: (v: boolean) => void };
  Object.assign(input, { isTTY: true, setRawMode: vi.fn() });
  let text = '';
  const output = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.assign(output, { isTTY: true });
  (output as unknown as PassThrough).on('data', (chunk) => { text += chunk.toString(); });
  return { input, output, written: () => text };
}

function writeSession(dir: string, id: string, name: string, lastAccessedAt: string, messages: unknown[]) {
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, name, workingDirectory: `/work/${name}`, model: 'm', messages, createdAt: lastAccessedAt, lastAccessedAt }), { mode: 0o600 });
}

describe('session picker (P6)', () => {
  let dir: string;
  const previous = process.env.CODEBUDDY_SESSIONS_DIR;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'picker-'));
    process.env.CODEBUDDY_SESSIONS_DIR = dir;
    writeSession(dir, 'aaaa1111-remise', 'remise facture', '2026-09-15T10:00:00Z', [
      { type: 'user', content: 'corrige la remise', timestamp: '2026-09-15T10:00:00Z' },
      { type: 'tool_result', content: 'ok', timestamp: '2026-09-15T10:00:01Z', toolCall: { id: '1', type: 'function', function: { name: 'view_file', arguments: '{"path":"src/facture.ts"}' } } },
      { type: 'assistant', content: 'Remise corrigée, tests verts.', timestamp: '2026-09-15T10:00:02Z' },
    ]);
    writeSession(dir, 'bbbb2222-docs', 'documentation', '2026-09-15T09:00:00Z', [{ type: 'user', content: 'docs', timestamp: '2026-09-15T09:00:00Z' }]);
    writeSession(dir, 'cccc3333-ci', 'pipeline ci', '2026-09-15T08:00:00Z', [{ type: 'user', content: 'ci', timestamp: '2026-09-15T08:00:00Z' }]);
    vi.resetModules();
    const { resetSessionStore } = await import('../../src/persistence/session-store.js') as { resetSessionStore?: () => void };
    resetSessionStore?.();
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.CODEBUDDY_SESSIONS_DIR;
    else process.env.CODEBUDDY_SESSIONS_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('filters by name, id and working directory, then fuzzy subsequence', () => {
    const sessions = [
      { id: 'aaaa1111', name: 'remise facture', workingDirectory: '/work/a', lastAccessedAt: new Date(), messages: [] },
      { id: 'bbbb2222', name: 'documentation', workingDirectory: '/work/docs', lastAccessedAt: new Date(), messages: [] },
    ];
    expect(filterSessions(sessions, 'FACT').map((s) => s.id)).toEqual(['aaaa1111']);
    expect(filterSessions(sessions, 'bbbb').map((s) => s.id)).toEqual(['bbbb2222']);
    expect(filterSessions(sessions, 'dcmt').map((s) => s.id)).toEqual(['bbbb2222']);
  });

  it('non-TTY without ID prints the list, sets exit code 1 and never waits for input', async () => {
    const input = new PassThrough() as unknown as NodeJS.ReadStream;
    const output = new PassThrough() as unknown as NodeJS.WriteStream;
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')); });
    try {
      const picked = await pickRecentSession(20, { input, output });
      expect(picked).toBeNull();
      expect(process.exitCode).toBe(1);
      expect(logs.join('\n')).toContain('remise facture');
      expect(logs.join('\n')).toContain('No interactive terminal');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('TTY picker: ↓ then Enter selects the second most recent session', async () => {
    const tty = fakeTty();
    const pending = pickRecentSession(20, tty);
    await new Promise((r) => setTimeout(r, 20));
    (tty.input as unknown as PassThrough).write('\x1b[B');
    await new Promise((r) => setTimeout(r, 10));
    (tty.input as unknown as PassThrough).write('\r');
    expect(await pending).toBe('bbbb2222-docs');
    expect(tty.written()).toContain('Resume a session');
  });

  it('TTY picker: typing filters and Esc cancels', async () => {
    const sessions = [{ id: 'x1', name: 'alpha', lastAccessedAt: new Date(), messages: [] }, { id: 'x2', name: 'beta', lastAccessedAt: new Date(), messages: [] }];
    const tty = fakeTty();
    const typed = pickSession(sessions, tty);
    (tty.input as unknown as PassThrough).write('bet');
    await new Promise((r) => setTimeout(r, 10));
    (tty.input as unknown as PassThrough).write('\r');
    expect((await typed)?.id).toBe('x2');
    const tty2 = fakeTty();
    const cancelled = pickSession(sessions, tty2);
    (tty2.input as unknown as PassThrough).write('\x1b');
    await new Promise((r) => setTimeout(r, 60));
    (tty2.input as unknown as PassThrough).write('\x1b');
    expect(await cancelled).toBeNull();
  });

  it('resume prints a local recap (files, last exchanges) without constructing an LLM client', async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')); });
    try {
      await resumeSessionById('aaaa1111');
    } finally {
      logSpy.mockRestore();
    }
    const text = logs.join('\n');
    expect(text).toContain('Recap (local, no model call): 1 user / 1 assistant turns, 1 tool call(s)');
    expect(text).toContain('Files touched: src/facture.ts');
    expect(text).toContain('Last answer: Remise corrigée, tests verts.');
    expect(clientSpy.constructed).toBe(0);
    expect(buildSessionRecap({ messages: [] })).toMatchObject({ messageCount: 0, filesTouched: [] });
  });
});
