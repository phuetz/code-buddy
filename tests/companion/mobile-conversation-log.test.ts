import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendConversationLog,
  CONVERSATION_LOG_MAX_BYTES,
  readConversationLog,
  resolveConversationLogFile,
} from '../../src/companion/mobile-conversation-log.js';

describe('mobile conversation log (lot 4)', () => {
  const previous = process.env.CODEBUDDY_MOBILE_CONVERSATIONS_DIR;

  afterEach(() => {
    if (previous === undefined) delete process.env.CODEBUDDY_MOBILE_CONVERSATIONS_DIR;
    else process.env.CODEBUDDY_MOBILE_CONVERSATIONS_DIR = previous;
  });

  it('appends jsonl 0600 and pages with before/limit', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-conv-'));
    process.env.CODEBUDDY_MOBILE_CONVERSATIONS_DIR = dir;
    const env = { ...process.env, CODEBUDDY_MOBILE_CONVERSATIONS_DIR: dir };
    appendConversationLog('user-a', [
      { id: 'c-1', role: 'user', text: 'un', ts: 1 },
      { id: 'c-2', role: 'assistant', text: 'deux', ts: 2 },
      { id: 'c-3', role: 'user', text: 'trois', ts: 3 },
    ], env);
    const names = readdirSync(dir);
    expect(names).toHaveLength(1);
    const file = path.join(dir, names[0]!);
    expect(readFileSync(file, 'utf8').split('\n').filter(Boolean)).toHaveLength(3);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const page = readConversationLog('user-a', { before: 'c-3', limit: 2 }, env);
    expect(page.map((row) => row.id)).toEqual(['c-1', 'c-2']);
  });

  it('rotates a jsonl past 5 MiB keeping a single .1 generation', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-conv-rot-'));
    const env = { ...process.env, CODEBUDDY_MOBILE_CONVERSATIONS_DIR: dir };
    const file = resolveConversationLogFile('user-a', env);
    expect(file).toBeTruthy();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file!, `${'x'.repeat(CONVERSATION_LOG_MAX_BYTES + 16)}\n`, { mode: 0o600 });
    appendConversationLog('user-a', [{ id: 'n1', role: 'user', text: 'hi', ts: 1 }], env);
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(statSync(file!).size).toBeLessThan(CONVERSATION_LOG_MAX_BYTES);
    expect(statSync(`${file}.1`).size).toBeGreaterThan(CONVERSATION_LOG_MAX_BYTES);
    writeFileSync(file!, `${'y'.repeat(CONVERSATION_LOG_MAX_BYTES + 16)}\n`, { mode: 0o600 });
    appendConversationLog('user-a', [{ id: 'n2', role: 'user', text: 'again', ts: 2 }], env);
    const generations = readdirSync(dir).filter((name) => name.endsWith('.1'));
    expect(generations).toHaveLength(1);
    expect(readFileSync(`${file}.1`, 'utf8').startsWith('y')).toBe(true);
  });

  it('purges conversation logs older than 90 days on open', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-conv-age-'));
    const env = { ...process.env, CODEBUDDY_MOBILE_CONVERSATIONS_DIR: dir };
    const file = resolveConversationLogFile('user-a', env);
    expect(file).toBeTruthy();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file!, '{"id":"old","role":"user","text":"gone","ts":1}\n', { mode: 0o600 });
    const old = (Date.now() - 91 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(file!, old, old);
    expect(readConversationLog('user-a', {}, env)).toEqual([]);
    expect(existsSync(file!)).toBe(false);
  });
});
