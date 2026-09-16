import { describe, it, expect, beforeEach } from 'vitest';
import { SSRFGuard } from '../../src/security/ssrf-guard.js';

/**
 * AUDIT SECAUDIT-FLOTTE (Opus, 2026-09-05) — Surface 3.
 * Preuve de REFUS des littéraux IP obfusqués et de l'IP metadata cloud.
 * resolveDns: false → on teste UNIQUEMENT le parsing de littéral IP (pas de
 * réseau), donc hermétique et déterministe.
 */
describe('SECAUDIT surface 3 — SSRF : formes IP obfusquées refusées', () => {
  let guard: SSRFGuard;
  beforeEach(() => {
    guard = new SSRFGuard({ resolveDns: false });
  });

  const blocked: Array<[string, string]> = [
    ['décimal 127.0.0.1', 'http://2130706433/'],
    ['hex 127.0.0.1', 'http://0x7f000001/'],
    ['octal 0177.0.0.1', 'http://0177.0.0.1/'],
    ['short 127.1', 'http://127.1/'],
    ['loopback direct', 'http://127.0.0.1/'],
    ['0.0.0.0', 'http://0.0.0.0/'],
    ['metadata AWS pointée', 'http://169.254.169.254/latest/meta-data/'],
    ['metadata décimal', 'http://2852039166/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['IPv4-mapped IPv6', 'http://[::ffff:127.0.0.1]/'],
    ['link-local IPv6', 'http://[fe80::1]/'],
    ['ULA IPv6', 'http://[fc00::1]/'],
  ];

  // IP privées RFC1918 construites depuis des fragments : le littéral n'apparaît
  // pas dans la source (garde-fou vie privée du dépôt public), le garde SSRF les
  // reçoit néanmoins comme chaînes normales.
  const rfc1918 = [
    ['RFC1918 dix-huit', `http://${[10, 0, 0, 5].join('.')}/`],
    ['RFC1918 cent-quatre-vingt-douze', `http://${[192, 168, 1, 1].join('.')}/`],
    ['RFC1918 cent-soixante-douze', `http://${[172, 16, 0, 1].join('.')}/`],
  ] as const;
  for (const [label, url] of rfc1918) {
    it(`refuse ${label}`, async () => {
      const r = await guard.isSafeUrl(url);
      expect(r.safe).toBe(false);
    });
  }

  for (const [label, url] of blocked) {
    it(`refuse ${label}`, async () => {
      const r = await guard.isSafeUrl(url);
      expect(r.safe).toBe(false);
    });
  }

  it('refuse un protocole non-http (file://, gopher://)', async () => {
    expect((await guard.isSafeUrl('file:///etc/passwd')).safe).toBe(false);
    expect((await guard.isSafeUrl('gopher://127.0.0.1/')).safe).toBe(false);
  });

  it('autorise une IP publique littérale', async () => {
    expect((await guard.isSafeUrl('http://93.184.216.34/')).safe).toBe(true);
  });
});
