/**
 * Fleet P8 — privacy lint detection tests. Heuristic patterns; we
 * mostly check no false negatives on known secret shapes and that
 * obvious safe content stays clean.
 */
import { describe, expect, it } from 'vitest';
import { scanForSecrets } from '../../src/fleet/privacy-lint';

describe('scanForSecrets', () => {
  it('returns no matches for plain text', () => {
    const out = scanForSecrets('What is the weather like in Paris today?');
    expect(out.hasSecrets).toBe(false);
    expect(out.matches).toEqual([]);
  });

  it('detects an OpenAI sk- key (high confidence)', () => {
    const out = scanForSecrets('My key is sk-abcdef1234567890ABCDEF1234567890');
    expect(out.hasSecrets).toBe(true);
    expect(out.highConfidence).toBe(true);
    expect(out.matches[0].kind).toBe('env-key');
  });

  it('detects an Anthropic sk-ant- key', () => {
    const out = scanForSecrets('export ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnop1234567890qrstuvwx');
    expect(out.matches.some((m) => m.kind === 'env-key')).toBe(true);
  });

  it('detects an AWS access key id', () => {
    const out = scanForSecrets('AKIAIOSFODNN7EXAMPLE used in prod');
    expect(out.matches.some((m) => m.kind === 'env-key')).toBe(true);
  });

  it('detects a GitHub PAT', () => {
    const out = scanForSecrets(
      'token: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(out.matches.some((m) => m.kind === 'env-key')).toBe(true);
  });

  it('detects a Google AIza key', () => {
    const out = scanForSecrets(
      'GEMINI_API_KEY=AIzaSyAbcdefghijklmnopqrstuvwxyz1234567A',
    );
    expect(out.matches.some((m) => m.kind === 'env-key')).toBe(true);
  });

  it('detects a JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const out = scanForSecrets(`auth: Bearer ${jwt}`);
    expect(out.matches.some((m) => m.kind === 'jwt')).toBe(true);
  });

  it('detects a PEM private key block', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAxxx\n-----END RSA PRIVATE KEY-----';
    const out = scanForSecrets(`Here is a key: ${pem}`);
    expect(out.matches.some((m) => m.kind === 'private-key-pem')).toBe(true);
    expect(out.highConfidence).toBe(true);
  });

  it('detects multi-line dotenv blocks', () => {
    const env = `\nDATABASE_URL=postgres://user:pass@host\nAPI_KEY=secret\nDEBUG=1\n`;
    const out = scanForSecrets(env);
    expect(out.matches.some((m) => m.kind === 'dotenv-block')).toBe(true);
  });

  it('detects private home paths', () => {
    const out = scanForSecrets(
      'Help me debug this issue in /home/patrice/Documents/private',
    );
    expect(out.matches.some((m) => m.kind === 'private-path')).toBe(true);
  });

  it('preview redacts most of the matched secret', () => {
    const out = scanForSecrets('sk-anbcdefghijklmnopqrstuvwx12345');
    const preview = out.matches[0].preview;
    expect(preview).toContain('redacted');
    expect(preview).not.toContain('mnopqr');
  });

  it('avoids overlapping matches when several patterns hit the same range', () => {
    const out = scanForSecrets(
      'AIzaSyAbcdefghijklmnopqrstuvwxyz1234567A in /home/patrice/foo',
    );
    // env-key + private-path should both register as separate matches.
    expect(out.matches.length).toBeGreaterThanOrEqual(2);
    const ranges = out.matches.map((m) => `${m.start}-${m.end}`);
    expect(new Set(ranges).size).toBe(ranges.length);
  });

  describe('PII patterns (V1.2.x)', () => {
    it('detects US Social Security numbers (xxx-xx-xxxx)', () => {
      const out = scanForSecrets('SSN on file: 123-45-6789, please verify.');
      expect(out.matches.some((m) => m.kind === 'pii-ssn')).toBe(true);
      expect(out.highConfidence).toBe(true);
    });

    it('rejects SSN-shaped strings with reserved prefixes (000, 666, 9xx)', () => {
      // SSA never issued these — they're not real SSNs.
      const out = scanForSecrets('Test data: 000-12-3456 and 666-78-9012 and 900-12-3456');
      expect(out.matches.some((m) => m.kind === 'pii-ssn')).toBe(false);
    });

    it('detects FR IBAN', () => {
      const out = scanForSecrets('Virement: FR76 3000 4000 0312 3456 7890 143');
      expect(out.matches.some((m) => m.kind === 'pii-iban')).toBe(true);
    });

    it('detects DE IBAN without spaces', () => {
      const out = scanForSecrets('IBAN DE89370400440532013000 for payments.');
      expect(out.matches.some((m) => m.kind === 'pii-iban')).toBe(true);
    });

    it('rejects an IBAN-shaped value with an invalid MOD-97 checksum', () => {
      const out = scanForSecrets('Test value: DE89370400440532013001');
      expect(out.matches.some((m) => m.kind === 'pii-iban')).toBe(false);
    });

    it('detects E.164 international phone numbers', () => {
      const out = scanForSecrets('Call me at +33 6 12 34 56 78 when you can.');
      expect(out.matches.some((m) => m.kind === 'pii-phone')).toBe(true);
    });

    it('detects French national phone numbers', () => {
      const out = scanForSecrets('Mon numéro: 06.12.34.56.78');
      expect(out.matches.some((m) => m.kind === 'pii-phone')).toBe(true);
    });

    it('detects Visa credit card numbers (Luhn-valid)', () => {
      // 4111111111111111 = canonical Visa test card, passes Luhn.
      const out = scanForSecrets('Card: 4111111111111111 exp 12/27');
      expect(out.matches.some((m) => m.kind === 'pii-credit-card')).toBe(true);
      expect(out.highConfidence).toBe(true);
    });

    it('detects Amex credit card numbers', () => {
      // 378282246310005 = canonical Amex test card.
      const out = scanForSecrets('Amex: 378282246310005');
      expect(out.matches.some((m) => m.kind === 'pii-credit-card')).toBe(true);
    });

    it('skips digit runs that look like cards but fail Luhn', () => {
      // 4111111111111112 — flips the last digit, breaks Luhn.
      const out = scanForSecrets('Random sequence: 4111111111111112 ignore');
      expect(out.matches.some((m) => m.kind === 'pii-credit-card')).toBe(false);
    });

    it('does not flag normal sentences with numbers', () => {
      const out = scanForSecrets(
        'I bought 1234 apples in 2025 for 99 euros, total 99 cents lost.',
      );
      expect(out.matches.some((m) => m.kind === 'pii-credit-card')).toBe(false);
      expect(out.matches.some((m) => m.kind === 'pii-ssn')).toBe(false);
    });
  });
});
