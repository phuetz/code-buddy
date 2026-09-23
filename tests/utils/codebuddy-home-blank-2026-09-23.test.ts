/**
 * Lectures de CODEBUDDY_HOME (home-vide).
 * Le cas « vide ou blanc = non défini » est celui prouvé dans
 * tests/utils/profile-isolation-2026-09-22.test.ts du candidat.
 * Le reste de ce fichier (getCodexAuthPath, détection de fournisseur, D6)
 * n'est pas le correctif validé et n'est pas importé.
 * Le chemin du registre CKG remplace src/search/vector-index-factory.ts,
 * absent de la branche principale : le ledger passe par getCodeBuddyHome().
 */
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getCheckpointPath } from '../../src/agent/autonomous/checkpoint-manager.js';
import { getCodeBuddyPath, isCustomCodeBuddyHome } from '../../src/utils/codebuddy-home.js';

describe('CODEBUDDY_HOME vide ou blanc', () => {
  const saved = process.env.CODEBUDDY_HOME;
  const savedGrok = process.env.GROK_HOME;

  afterEach(() => {
    if (saved === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = saved;
    if (savedGrok === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = savedGrok;
  });

  it('traite vide, espaces, tabulation, CR et LF comme non défini', () => {
    delete process.env.GROK_HOME;
    for (const value of ['', '   ', '\t', '\r', '\n']) {
      process.env.CODEBUDDY_HOME = value;
      expect(getCodeBuddyPath('x')).toBe(path.join(os.homedir(), '.codebuddy', 'x'));
      expect(isCustomCodeBuddyHome()).toBe(false);
      expect(getCheckpointPath('z')).toBe(
        path.join(os.homedir(), '.codebuddy', 'runs', 'z', 'state.json'),
      );
      expect(getCodeBuddyPath('collective', 'ckg-ledger.jsonl')).toBe(
        path.join(os.homedir(), '.codebuddy', 'collective', 'ckg-ledger.jsonl'),
      );
    }
  });

  it('conserve un profil explicite entouré d’espaces', () => {
    delete process.env.GROK_HOME;
    const profile = path.join(os.tmpdir(), 'profil-explicite-espaces');
    process.env.CODEBUDDY_HOME = `  ${profile}  `;
    expect(getCodeBuddyPath('x')).toBe(path.join(profile, 'x'));
    expect(isCustomCodeBuddyHome()).toBe(true);
  });
});
