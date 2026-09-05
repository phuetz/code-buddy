import { describe, expect, it } from 'vitest';

import { runDoctorChecks } from '../../src/doctor/index.js';

describe('doctor media and profile permissions', () => {
  it('reports ffmpeg, Piper and ~/.codebuddy permissions as first-class checks', async () => {
    const checks = await runDoctorChecks(process.cwd());

    const ffmpeg = checks.find((check) => check.name === 'ffmpeg');
    expect(ffmpeg).toBeDefined();
    expect(ffmpeg!.optional).toBe(true);
    expect(['ok', 'warn']).toContain(ffmpeg!.status);
    if (ffmpeg!.status === 'warn') {
      expect(ffmpeg!.message).toMatch(/not found/i);
      expect(ffmpeg!.message).toMatch(/optional/i);
    }

    const piper = checks.find((check) => check.name === 'Piper TTS');
    expect(piper).toBeDefined();
    expect(piper!.optional).toBe(true);
    expect(['ok', 'warn']).toContain(piper!.status);
    if (piper!.status === 'warn') {
      expect(piper!.message).toMatch(/not found/i);
      expect(piper!.message).toMatch(/optional/i);
    }

    const perms = checks.find((check) => check.name === 'Profile permissions');
    expect(perms).toBeDefined();
    expect(perms!.message).toMatch(/\.codebuddy/);
    expect(['ok', 'warn', 'error']).toContain(perms!.status);
  });
});
