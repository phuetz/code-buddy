import { describe, expect, it } from 'vitest';

import { runHermesRuntimeBackendSmoke } from '../../src/agent/hermes-runtime-backends.js';

describe('Hermes runtime backend live smoke runner', () => {
  it('runs the local backend smoke through a real Node subprocess', () => {
    const result = runHermesRuntimeBackendSmoke({
      backendId: 'local',
      env: process.env,
      now: () => new Date('2026-05-31T10:15:00.000Z'),
    });

    expect(result).toMatchObject({
      backendId: 'local',
      command: process.execPath,
      exitCode: 0,
      ok: true,
      status: 'passed',
    });
    expect(result.args).toContain('-e');
    expect(result.stdout).toContain('OK-HERMES-LOCAL');
    expect(result.output).toContain('OK-HERMES-LOCAL');
  });
});
