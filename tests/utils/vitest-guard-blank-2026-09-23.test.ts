/**
 * Garde Vitest (revue finale isolation, D1).
 * Lancer le processus avec CODEBUDDY_HOME vide ou blanc : la garde doit avoir
 * installé un profil jetable avant ce fichier. Une valeur laissée vide résout
 * le profil réel — ce test doit alors échouer.
 */
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getCodeBuddyHome } from '../../src/utils/codebuddy-home.js';

describe('garde Vitest et CODEBUDDY_HOME vide', () => {
  it('installe un profil jetable et refuse le profil réel', () => {
    const resolved = getCodeBuddyHome();
    const real = path.join(os.homedir(), '.codebuddy');
    const env = process.env.CODEBUDDY_HOME ?? '';
    console.log('QA_GUARD ' + JSON.stringify({ env, resolved, home: os.homedir() }));
    expect(env.trim(), 'CODEBUDDY_HOME vide laissé en place').not.toBe('');
    expect(resolved).toBe(env.trim());
    expect(resolved).not.toBe(real);
    expect(resolved.startsWith(real + path.sep)).toBe(false);
    expect(resolved.includes(`${path.sep}codebuddy-vitest-home-`)).toBe(true);
  });
});
