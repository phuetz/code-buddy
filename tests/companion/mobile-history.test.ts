/**
 * Per-connection companion memory for the mobile PWA.
 *
 * Observed on the phone (2026-09-06): a selfie was served, then « Encore une ? »
 * got a stateless assistant reply — `produceCompanionReply` passed an EMPTY
 * history on every turn, so nothing of the conversation survived one message.
 *
 * The store never holds image bytes and never writes an identity in clear: the
 * file name is a hash of the JWT user id.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MOBILE_HISTORY_MAX_TURNS,
  appendCompanionHistory,
  isMobileHistoryPersistenceEnabled,
  loadMobileCompanionHistory,
  resolveMobileHistoryFile,
  saveMobileCompanionHistory,
} from '../../src/companion/mobile-history.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-mobile-history-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { CODEBUDDY_MOBILE_HISTORY_DIR: dir, ...extra } as NodeJS.ProcessEnv;
}

describe('appendCompanionHistory', () => {
  it('keeps the last turns only, bounded', () => {
    let history = appendCompanionHistory([], [{ role: 'user', content: 'a' }]);
    for (let i = 0; i < 40; i += 1) {
      history = appendCompanionHistory(history, [
        { role: 'user', content: `u${i}` },
        { role: 'assistant', content: `a${i}` },
      ]);
    }
    expect(history.length).toBe(MOBILE_HISTORY_MAX_TURNS);
    expect(history[history.length - 1]).toEqual({ role: 'assistant', content: 'a39' });
  });

  it('carries the selfie marker but never image bytes', () => {
    const history = appendCompanionHistory([], [
      { role: 'user', content: 'photo de toi' },
      { role: 'assistant', content: 'Hop.', kind: 'selfie' },
    ]);
    expect(history[1]).toEqual({ role: 'assistant', content: 'Hop.', kind: 'selfie' });
    expect(JSON.stringify(history)).not.toMatch(/base64|image\//);
  });

  it('drops empty turns', () => {
    expect(appendCompanionHistory([], [{ role: 'user', content: '   ' }])).toEqual([]);
  });
});

describe('mobile companion history persistence', () => {
  it('is opt-out: on by default, off with CODEBUDDY_MOBILE_HISTORY=false', () => {
    expect(isMobileHistoryPersistenceEnabled(env())).toBe(true);
    expect(isMobileHistoryPersistenceEnabled(env({ CODEBUDDY_MOBILE_HISTORY: 'false' }))).toBe(false);
  });

  it('round-trips a bounded history for a user id', () => {
    const turns = appendCompanionHistory([], [
      { role: 'user', content: 'Coucou' },
      { role: 'assistant', content: 'Coucou toi.', kind: undefined },
    ]);
    saveMobileCompanionHistory('user-42', turns, env());
    expect(loadMobileCompanionHistory('user-42', env())).toEqual([
      { role: 'user', content: 'Coucou' },
      { role: 'assistant', content: 'Coucou toi.' },
    ]);
  });

  it('never writes the user id in clear in the file name', () => {
    const file = resolveMobileHistoryFile('someone@example.test', env());
    expect(file).toBeTruthy();
    expect(path.basename(String(file))).not.toContain('someone');
    expect(path.basename(String(file))).toMatch(/^[0-9a-f]{16,}\.json$/);
  });

  it('refuses a traversal-shaped user id by hashing it, staying inside the dir', () => {
    const file = resolveMobileHistoryFile('../../etc/passwd', env());
    expect(file).toBeTruthy();
    expect(path.dirname(String(file))).toBe(dir);
  });

  it('writes nothing when persistence is disabled', () => {
    const disabled = env({ CODEBUDDY_MOBILE_HISTORY: 'false' });
    saveMobileCompanionHistory('user-42', [{ role: 'user', content: 'Coucou' }], disabled);
    expect(fs.existsSync(dir) && fs.readdirSync(dir).length).toBeFalsy();
    expect(loadMobileCompanionHistory('user-42', disabled)).toEqual([]);
  });

  it('returns an empty history on a corrupt file rather than throwing', () => {
    const file = String(resolveMobileHistoryFile('user-42', env()));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json');
    expect(loadMobileCompanionHistory('user-42', env())).toEqual([]);
  });
});
