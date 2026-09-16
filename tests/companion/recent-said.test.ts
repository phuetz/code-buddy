/**
 * C6 — elle se souvient de ce qu'elle a dit, voix et Telegram, persisté 7 jours.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'path';
import {
  RECENT_SAID_WINDOW_MS,
  hasSaidOpener,
  pickUnsaidLine,
  recentOpeners,
  rememberSaid,
} from '../../src/companion/recent-said.js';
import { openerKey } from '../../src/companion/reply-augment.js';
import { pickAwayLine } from '../../src/companion/away-mode.js';

function tmpFile(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'said-'));
  return { dir, path: join(dir, 'recent-said.json') };
}

describe('C6 recent-said ring', () => {
  afterEach(() => {
    delete process.env.CODEBUDDY_COMPANION_PERSONA;
    delete process.env.CODEBUDDY_COMPANION_RECENT_SAID_FILE;
  });

  it('default persona writes nothing (byte-identical)', () => {
    const { dir, path } = tmpFile();
    try {
      delete process.env.CODEBUDDY_COMPANION_PERSONA;
      const ring = rememberSaid('Bonjour. Belle journée.', 'voice', Date.now(), path);
      expect(ring).toEqual([]);
      expect(existsSync(path)).toBe(false);
      expect(hasSaidOpener(openerKey('Bonjour. Belle journée.'), Date.now(), path)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('does not replay the same opener on the other channel', () => {
    const { dir, path } = tmpFile();
    try {
      process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
      process.env.CODEBUDDY_COMPANION_RECENT_SAID_FILE = path;
      const now = Date.now();
      const spoken = 'Bonjour. Juste un bonjour, pas un roman.';
      rememberSaid(spoken, 'voice', now, path);
      expect(hasSaidOpener(openerKey(spoken), now, path)).toBe(true);
      expect(recentOpeners(now, path)).toContain(openerKey(spoken));

      const telegram = pickAwayLine('morning', {
        rng: () => 0,
        now,
        statePath: path,
        env: process.env,
      });
      expect(telegram).toBeTruthy();
      expect(openerKey(telegram)).not.toBe(openerKey(spoken));
      expect(telegram).not.toBe(spoken);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('drops entries older than 7 days', () => {
    const { dir, path } = tmpFile();
    try {
      process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
      const now = 1_800_000_000_000;
      rememberSaid('Bonjour. Une vieille ouverture.', 'telegram', now - RECENT_SAID_WINDOW_MS - 1000, path);
      expect(hasSaidOpener(openerKey('Bonjour. Une vieille ouverture.'), now, path)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('pickUnsaidLine skips used openers then falls back', () => {
    const { dir, path } = tmpFile();
    try {
      process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
      const now = Date.now();
      const pool = ['Alpha bravo charlie delta.', 'Echo foxtrot golf hotel.'];
      rememberSaid(pool[0]!, 'telegram', now, path);
      const next = pickUnsaidLine(pool, { rng: () => 0, now, statePath: path });
      expect(next).toBe(pool[1]);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
