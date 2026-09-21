import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CHANNEL_HISTORY_IDLE_MS,
  CHANNEL_HISTORY_MAX_TURNS,
  clearCompanionChannelHistoriesForTests,
  personKeyFromSession,
  readCompanionChannelHistory,
  rememberCompanionChannelTurn,
} from '../../src/companion/channel-history.js';

describe('companion channel history', () => {
  const dirs: string[] = [];

  afterEach(() => {
    clearCompanionChannelHistoriesForTests();
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function env(): NodeJS.ProcessEnv {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-channel-history-'));
    dirs.push(dir);
    return { ...process.env, CODEBUDDY_CHANNEL_HISTORY_DIR: dir };
  }

  it('collapses channel prefixes onto the same person', () => {
    expect(personKeyFromSession('telegram:42')).toBe('42');
    expect(personKeyFromSession('discord:42')).toBe('42');
    expect(personKeyFromSession('42')).toBe('42');
  });

  it('shares turns between telegram and discord for the same person', () => {
    const testEnv = env();
    rememberCompanionChannelTurn('telegram:patrice', 'j\u2019ai froid', 'Je suis l\u00e0.', testEnv, 1_000);
    const discord = readCompanionChannelHistory('discord:patrice', testEnv, 1_000);
    expect(discord).toEqual([
      { role: 'user', content: 'j\u2019ai froid' },
      { role: 'assistant', content: 'Je suis l\u00e0.' },
    ]);
  });

  it('survives a process-local cache clear by reading the file', () => {
    const testEnv = env();
    rememberCompanionChannelTurn('telegram:patrice', 'salut', 'Hey.', testEnv, 2_000);
    clearCompanionChannelHistoriesForTests();
    expect(readCompanionChannelHistory('whatsapp:patrice', testEnv, 2_000)).toEqual([
      { role: 'user', content: 'salut' },
      { role: 'assistant', content: 'Hey.' },
    ]);
  });

  it('drops stale history after seven idle days', () => {
    const testEnv = env();
    rememberCompanionChannelTurn('telegram:patrice', 'nuit', 'Dors.', testEnv, 10_000);
    const later = 10_000 + CHANNEL_HISTORY_IDLE_MS + 1;
    expect(readCompanionChannelHistory('telegram:patrice', testEnv, later)).toEqual([]);
  });

  it('keeps only the last 20 turns', () => {
    const testEnv = env();
    let now = 1;
    for (let i = 0; i < CHANNEL_HISTORY_MAX_TURNS + 4; i += 1) {
      rememberCompanionChannelTurn('cli:patrice', `u${i}`, `a${i}`, testEnv, now);
      now += 1;
    }
    const turns = readCompanionChannelHistory('cli:patrice', testEnv, now);
    expect(turns).toHaveLength(CHANNEL_HISTORY_MAX_TURNS);
    // Chaque appel enregistre DEUX tours (utilisateur puis assistant) : garder
      // CHANNEL_HISTORY_MAX_TURNS tours revient a garder la moitie des appels.
      // La valeur attendue se derive de la constante au lieu d'etre ecrite en dur.
      expect(turns[0]?.content).toBe(`u${CHANNEL_HISTORY_MAX_TURNS + 4 - CHANNEL_HISTORY_MAX_TURNS / 2}`);
  });

  it('can be disabled without writing a file', () => {
    const testEnv = { ...env(), CODEBUDDY_CHANNEL_HISTORY: 'false' };
    rememberCompanionChannelTurn('telegram:patrice', 'salut', 'Hey.', testEnv, 3_000);
    clearCompanionChannelHistoriesForTests();
    expect(readCompanionChannelHistory('telegram:patrice', testEnv, 3_000)).toEqual([]);
  });
});
