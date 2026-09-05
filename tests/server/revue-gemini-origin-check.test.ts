import { describe, it, expect } from 'vitest';
import { isOriginAllowed } from '../../src/server/origin-check.js';

describe('Revue G6 - Trou 8 : Origine non loopback acceptée par wildcard localhost', () => {
  it('doit refuser les origines non loopback qui usurpent le préfixe localhost:*', () => {
    const allowed = ['http://localhost:*', 'http://127.0.0.1:*'];

    // Origines légitimes loopback
    expect(isOriginAllowed('http://localhost:3000', allowed)).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:8080', allowed)).toBe(true);

    // VULNÉRABILITÉ : La regex produite par replace(/\*/g, '.*') est ^http:\/\/localhost:.*$
    // Tout nom de domaine commençant par http://localhost: ou http://localhost. est accepté !
    expect(isOriginAllowed('http://localhost:8080.evil.com', allowed)).toBe(false);
    expect(isOriginAllowed('http://localhost:attacker.com', allowed)).toBe(false);
    expect(isOriginAllowed('http://localhost.evil.com:3000', allowed)).toBe(false);
  });
});
