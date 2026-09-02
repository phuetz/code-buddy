import { describe, it, expect } from 'vitest';
import { scanForSecrets, redactSecrets } from '../../src/fleet/privacy-lint.js';

describe('Revue G6 - Trou 7 : Lint de vie privée qui laisse passer un IBAN formaté autrement', () => {
  it('doit détecter un IBAN français au format RIB standard (FR76 30006 00001 12345678901 89)', () => {
    // Format RIB usuel en France : 4 + 5 + 5 + 11 + 2
    const ribFrench = 'Veuillez virer le montant sur le compte FR76 30006 00001 12345678901 89 pour validation.';
    const result = scanForSecrets(ribFrench);

    // VULNÉRABILITÉ : La regex exige des groupes de 4 caractères strict (\s?[A-Z0-9]{4})
    // et ignore les formats bancaires réels (RIB 5+5+11)
    expect(result.hasSecrets).toBe(true);
    expect(result.findings.some((f) => f.ruleId === 'pii-iban')).toBe(true);
  });

  it('doit détecter et masquer un IBAN en minuscules ou séparé par des tirets', () => {
    const ibanLower = 'Mon compte bancaire est fr76 3000 6000 0112 3456 7890 189';
    const ibanDashed = 'IBAN: FR76-3000-6000-0112-3456-7890-189';

    // VULNÉRABILITÉ : Manque le flag case-insensitive 'i' et les tirets '-'
    const resLower = scanForSecrets(ibanLower);
    const resDashed = scanForSecrets(ibanDashed);

    expect(resLower.hasSecrets).toBe(true);
    expect(resDashed.hasSecrets).toBe(true);

    const redactedLower = redactSecrets(ibanLower);
    expect(redactedLower).not.toContain('fr76');

    const redactedDashed = redactSecrets(ibanDashed);
    expect(redactedDashed).not.toContain('FR76');
  });
});
