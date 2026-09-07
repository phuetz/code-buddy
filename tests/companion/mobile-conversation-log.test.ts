import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendConversationLog,
  readConversationLog,
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
});
