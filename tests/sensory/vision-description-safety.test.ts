import { describe, expect, it } from 'vitest';
import {
  normalizeVisionDescription,
  redactVisionDescriptionForEgress,
} from '../../src/sensory/vision-description-safety.js';

describe('vision description safety', () => {
  it('bounds local descriptions and removes invisible controls', () => {
    expect(normalizeVisionDescription('  Un\u0000 hamburger\n visible  ', 30)).toBe(
      'Un hamburger visible',
    );
    expect(normalizeVisionDescription('x'.repeat(40), 12)).toHaveLength(12);
  });

  it('redacts known secrets, PII and private paths before authorised egress', () => {
    const result = redactVisionDescriptionForEgress(
      'mail test@example.com tel 06 12 34 56 78 clé sk-proj-abcdefghijklmnopqrstuvwxyz dans /home/user/secret.txt',
    );
    expect(result).toContain('[REDACTED:pii-email]');
    expect(result).toContain('[REDACTED:pii-phone]');
    expect(result).toContain('[REDACTED:env-key]');
    expect(result).not.toContain('test@example.com');
    expect(result).not.toContain('/home/user');
  });

  it('redacts the complete input before truncation can hide a multiline secret', () => {
    const result = redactVisionDescriptionForEgress(
      `${'x'.repeat(470)}-----BEGIN PRIVATE KEY-----\nTOP-SECRET-WORDS\n-----END PRIVATE KEY-----`,
      500,
    );
    expect(result).toContain('[REDACTED:private-key-pem]');
    expect(result).not.toContain('TOP-SECRET-WORDS');
  });

  it('canonicalizes zero-width obfuscation before scanning secrets', () => {
    const result = redactVisionDescriptionForEgress(
      'clé sk-proj-abcdefghij\u200bklmnopqrstuvwxyz123456',
    );
    expect(result).toContain('[REDACTED:env-key]');
    expect(result).not.toContain('sk-proj-');
  });
});
