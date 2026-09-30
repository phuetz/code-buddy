import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ settings: undefined as Record<string, string> | undefined }));
vi.mock('../../src/utils/settings-manager.js', () => ({
  getSettingsManager: () => ({ readUserSettingsIfPresent: () => state.settings }),
}));
vi.mock('../../src/wizard/environment-detection.js', () => ({
  detectEnvironment: async () => ({
    capabilities: [{ id: 'ollama', available: true, kind: 'local',
      models: ['local-instruct'], modelDetails: [{ name: 'local-instruct' }],
      baseURL: 'http://localhost:11434/v1' }],
  }),
}));
import { runDoctorChecks } from '../../src/doctor/index.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'doctor-local-env-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('CODEBUDDY_HOME', join(home, '.codebuddy'));
  vi.stubEnv('CODEBUDDY_PROVIDER', 'ollama');
  vi.stubEnv('OLLAMA_HOST', 'http://localhost:11434');
  for (const key of ['OLLAMA_MODEL', 'GROK_MODEL', 'CODEBUDDY_MODEL']) vi.stubEnv(key, '');
  state.settings = undefined;
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); });

describe('doctor local environment on a virgin HOME', () => {
  it.each(['GROK_MODEL', 'OLLAMA_MODEL'])('accepts an advertised model from %s without writing settings', async key => {
    vi.stubEnv(key, 'local-instruct');
    const ready = (await runDoctorChecks(home, { offline: true })).find(c => c.name === 'AI provider ready');
    expect(ready?.status).toBe('ok');
    expect(ready?.message).toContain('local-instruct');
    expect(existsSync(join(home, '.codebuddy', 'user-settings.json'))).toBe(false);
  });
  it('does not let an ambient Ollama override a forced cloud provider', async () => {
    vi.stubEnv('CODEBUDDY_PROVIDER', 'openai');
    vi.stubEnv('GROK_MODEL', 'local-instruct');
    const ready = (await runDoctorChecks(home, { offline: true })).find(c => c.name === 'AI provider ready');
    expect(ready?.status).toBe('warn');
  });
  it('reports a requested missing tag even if saved settings point to an installed tag', async () => {
    state.settings = { provider: 'ollama', model: 'local-instruct', defaultModel: 'local-instruct' };
    vi.stubEnv('OLLAMA_MODEL', 'unavailable-tag');
    const ready = (await runDoctorChecks(home, { offline: true })).find(c => c.name === 'AI provider ready');
    expect(ready?.status).toBe('warn');
    expect(ready?.message).toContain('unavailable-tag');
  });
});
