import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reserveVoiceQualification } from '../../src/sensory/voice-qualification-budget.js';

describe('voice qualification persistent budget', () => {
  it('reserves before sending and preserves the cap across callers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-budget-'));
    const env = { CODEBUDDY_VOICE_JEV_BUDGET_FILE: join(dir, 'budget.json'),
      CODEBUDDY_VOICE_JEV_MAX_REQUESTS: '2', CODEBUDDY_VOICE_JEV_EXPIRES_AT: '2030-01-01' };
    try {
      expect(reserveVoiceQualification(env, 1000)).toBe(true);
      expect(reserveVoiceQualification(env, 1000)).toBe(true);
      expect(reserveVoiceQualification(env, 1000)).toBe(false);
      expect(reserveVoiceQualification({}, 1000)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('fails closed on corruption, lock and expiry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-budget-'));
    const file = join(dir, 'budget.json');
    const env = { CODEBUDDY_VOICE_JEV_BUDGET_FILE: file, CODEBUDDY_VOICE_JEV_EXPIRES_AT: '2030-01-01' };
    try {
      writeFileSync(file, 'broken');
      expect(reserveVoiceQualification(env, 1000)).toBe(false);
      writeFileSync(file, '{"reserved":0}');
      writeFileSync(file + '.lock', '');
      expect(reserveVoiceQualification(env, 1000)).toBe(false);
      rmSync(file + '.lock');
      expect(reserveVoiceQualification(env, Date.parse('2031-01-01'))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
