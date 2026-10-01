import { describe, it, expect } from 'vitest';
import { secretsEqual } from '../../src/security/secret-compare.js';

describe('secretsEqual', () => {
  it('doit renvoyer true pour des chaînes identiques', () => {
    expect(secretsEqual('secret123', 'secret123')).toBe(true);
  });

  it('doit renvoyer false pour des chaînes différentes', () => {
    expect(secretsEqual('secret123', 'secret456')).toBe(false);
  });

  it('doit renvoyer false pour des chaînes de longueurs différentes', () => {
    expect(secretsEqual('secret123', 'secret12')).toBe(false);
    expect(secretsEqual('secret123', 'secret1234')).toBe(false);
  });

  it('doit renvoyer false si l\'un des arguments est undefined', () => {
    expect(secretsEqual('secret123', undefined)).toBe(false);
    expect(secretsEqual(undefined, 'secret123')).toBe(false);
    expect(secretsEqual(undefined, undefined)).toBe(false);
  });

  it('doit renvoyer false si l\'un des arguments est un nombre', () => {
    expect(secretsEqual('123', 123)).toBe(false);
    expect(secretsEqual(123, '123')).toBe(false);
  });
});
