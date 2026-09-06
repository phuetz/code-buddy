/**
 * Tests for src/context/auto-compact-threshold.ts (post-Claude-Code-audit
 * helper, see the handover repo's propositions/AUDIT-COMPACTION-CLAUDE-CODE-2026-05-04.md
 * recommendation #1).
 *
 * Pure function tests: each call snapshots+restores the
 * CODEBUDDY_AUTOCOMPACT_BUFFER_TOKENS env var so tests don't leak.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  computeAutoCompactThreshold,
  pickBufferTokens,
  _getDefaultBufferTableForTests,
} from '../../src/context/auto-compact-threshold.js';

const ENV_KEY = 'CODEBUDDY_AUTOCOMPACT_BUFFER_TOKENS';
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalEnv;
});

// ---- pickBufferTokens ------------------------------------------------

describe('pickBufferTokens', () => {
  describe('default table', () => {
    it('exposes a "default" fallback', () => {
      const table = _getDefaultBufferTableForTests();
      expect(table.default).toBeGreaterThan(0);
      expect(typeof table.default).toBe('number');
    });

    it('returns the "default" value when no model is provided', () => {
      expect(pickBufferTokens(undefined)).toBe(_getDefaultBufferTableForTests().default);
      expect(pickBufferTokens('')).toBe(_getDefaultBufferTableForTests().default);
    });

    it('matches Claude Sonnet by substring (case-insensitive)', () => {
      expect(pickBufferTokens('claude-sonnet-4-6')).toBe(13_000);
      expect(pickBufferTokens('Claude-Sonnet-4-6')).toBe(13_000);
      expect(pickBufferTokens('CLAUDE-SONNET-3-5')).toBe(13_000);
    });

    it('matches Claude Haiku to a smaller buffer than Sonnet', () => {
      expect(pickBufferTokens('claude-haiku-4-5')).toBe(8_000);
    });

    it('matches Gemini Flash variants', () => {
      expect(pickBufferTokens('gemini-2.5-flash')).toBe(10_000);
      expect(pickBufferTokens('gemini-2.0-flash')).toBe(8_000);
    });

    it('matches Grok 3 vs 4 (different buffers)', () => {
      expect(pickBufferTokens('grok-3')).toBe(12_000);
      expect(pickBufferTokens('grok-4')).toBe(14_000);
    });

    it('falls back to "default" for an unknown model name', () => {
      expect(pickBufferTokens('llm-from-mars-9000')).toBe(_getDefaultBufferTableForTests().default);
    });
  });

  describe('per-call override (options.bufferTokensByModel)', () => {
    it('substring match wins over the default table', () => {
      expect(
        pickBufferTokens('claude-sonnet-4-6', { bufferTokensByModel: { 'sonnet': 99_999 } }),
      ).toBe(99_999);
    });

    it('case-insensitive on the override patterns', () => {
      expect(
        pickBufferTokens('claude-SONNET', { bufferTokensByModel: { 'Sonnet': 7_777 } }),
      ).toBe(7_777);
    });

    it('falls through to default table when no override pattern matches', () => {
      expect(
        pickBufferTokens('claude-sonnet-4-6', { bufferTokensByModel: { 'opus': 99_999 } }),
      ).toBe(13_000);
    });

    it('floors fractional override values', () => {
      expect(
        pickBufferTokens('xyz', { bufferTokensByModel: { 'xyz': 12_345.7 } }),
      ).toBe(12_345);
    });

    it('clamps negative overrides to 0', () => {
      expect(
        pickBufferTokens('xyz', { bufferTokensByModel: { 'xyz': -100 } }),
      ).toBe(0);
    });
  });

  describe('explicit options.bufferTokens override', () => {
    it('wins over the per-model table', () => {
      expect(
        pickBufferTokens('claude-sonnet', {
          bufferTokens: 5_000,
          bufferTokensByModel: { 'sonnet': 99_999 },
        }),
      ).toBe(5_000);
    });

    it('floors fractional values', () => {
      expect(pickBufferTokens('any', { bufferTokens: 7_500.9 })).toBe(7_500);
    });

    it('rejects negative values (falls through to other resolution paths)', () => {
      // Negative bufferTokens is invalid → ignored → table fallback
      const result = pickBufferTokens('claude-sonnet', { bufferTokens: -100 });
      expect(result).toBe(13_000);
    });

    it('rejects NaN/Infinity (falls through)', () => {
      expect(pickBufferTokens('claude-sonnet', { bufferTokens: NaN })).toBe(13_000);
      expect(pickBufferTokens('claude-sonnet', { bufferTokens: Infinity })).toBe(13_000);
    });
  });

  describe('CODEBUDDY_AUTOCOMPACT_BUFFER_TOKENS env override', () => {
    it('honors the env var when set (no per-call override)', () => {
      process.env[ENV_KEY] = '20000';
      expect(pickBufferTokens('claude-sonnet')).toBe(20_000);
    });

    it('per-call options.bufferTokens beats the env var', () => {
      process.env[ENV_KEY] = '20000';
      expect(pickBufferTokens('claude-sonnet', { bufferTokens: 5_000 })).toBe(5_000);
    });

    it('per-call bufferTokensByModel beats the env var', () => {
      process.env[ENV_KEY] = '20000';
      expect(
        pickBufferTokens('claude-sonnet', { bufferTokensByModel: { 'sonnet': 7_000 } }),
      ).toBe(7_000);
    });

    it('ignored when not numeric', () => {
      process.env[ENV_KEY] = 'not-a-number';
      // Falls through to default table
      expect(pickBufferTokens('claude-sonnet')).toBe(13_000);
    });

    it('accepts 0 (no buffer at all)', () => {
      process.env[ENV_KEY] = '0';
      expect(pickBufferTokens('claude-sonnet')).toBe(0);
    });
  });
});

// ---- computeAutoCompactThreshold -------------------------------------

describe('computeAutoCompactThreshold', () => {
  it('returns max − buffer when no percent is given', () => {
    // claude-sonnet has buffer 13_000, max 200_000 → 187_000
    expect(computeAutoCompactThreshold(200_000, 'claude-sonnet-4-6')).toBe(187_000);
  });

  it('applies percent on top of (max − buffer)', () => {
    // (200_000 − 13_000) × 0.85 = 158_950
    expect(
      computeAutoCompactThreshold(200_000, 'claude-sonnet-4-6', { percent: 85 }),
    ).toBe(158_950);
  });

  it('uses the default buffer when model is unknown', () => {
    const expected = 100_000 - _getDefaultBufferTableForTests().default;
    expect(computeAutoCompactThreshold(100_000, 'unknown-llm-9000')).toBe(expected);
  });

  it('clamps to 0 when buffer exceeds the context window', () => {
    expect(computeAutoCompactThreshold(5_000, 'claude-sonnet')).toBe(0);
  });

  it('returns 0 when maxContextTokens is invalid', () => {
    expect(computeAutoCompactThreshold(0, 'claude-sonnet')).toBe(0);
    expect(computeAutoCompactThreshold(-100, 'claude-sonnet')).toBe(0);
    expect(computeAutoCompactThreshold(NaN, 'claude-sonnet')).toBe(0);
    expect(computeAutoCompactThreshold(Infinity, 'claude-sonnet')).toBe(0);
  });

  it('honors options.bufferTokens override', () => {
    expect(
      computeAutoCompactThreshold(200_000, 'claude-sonnet', { bufferTokens: 1_000 }),
    ).toBe(199_000);
  });

  it('honors options.percent edge: 100 = full effective budget', () => {
    expect(
      computeAutoCompactThreshold(200_000, 'claude-sonnet', { percent: 100 }),
    ).toBe(187_000);
  });

  it('rejects out-of-range percent (>100) — falls back to no-percent path', () => {
    expect(
      computeAutoCompactThreshold(200_000, 'claude-sonnet', { percent: 150 }),
    ).toBe(187_000);
  });

  it('rejects 0 percent — falls back to no-percent path (defensive)', () => {
    // percent=0 is degenerate (always trigger compact); we ignore it.
    expect(
      computeAutoCompactThreshold(200_000, 'claude-sonnet', { percent: 0 }),
    ).toBe(187_000);
  });

  it('rejects NaN percent', () => {
    expect(
      computeAutoCompactThreshold(200_000, 'claude-sonnet', { percent: NaN }),
    ).toBe(187_000);
  });

  it('floors fractional thresholds', () => {
    // (200_000 − 13_000) × 0.123 = 23_001 (floor of 23001.01)
    const result = computeAutoCompactThreshold(200_000, 'claude-sonnet', { percent: 12.3 });
    expect(result).toBe(Math.floor((200_000 - 13_000) * 0.123));
    expect(Number.isInteger(result)).toBe(true);
  });

  describe('integration: end-to-end with env override', () => {
    it('env CODEBUDDY_AUTOCOMPACT_BUFFER_TOKENS wins when no per-call override', () => {
      process.env[ENV_KEY] = '5000';
      try {
        expect(computeAutoCompactThreshold(100_000, 'claude-sonnet')).toBe(95_000);
      } finally {
        delete process.env[ENV_KEY];
      }
    });
  });
});
