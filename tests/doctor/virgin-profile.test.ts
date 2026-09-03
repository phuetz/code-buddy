import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { runDoctorChecks } from '../../src/doctor/index.js';
import { SettingsManager } from '../../src/utils/settings-manager.js';

function resetSettingsManager(): void {
  (SettingsManager as unknown as { instance?: SettingsManager }).instance = undefined;
}

describe('doctor on a virgin profile', () => {
  const homes: string[] = [];

  afterEach(() => {
    resetSettingsManager();
    for (const home of homes.splice(0)) {
      try {
        rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      } catch {
        /* ignore */
      }
    }
  });

  it('does not write grok defaults or claim grok-code-fast-1 is the saved Ollama model', async () => {
    const home = mkdtempSync(join(tmpdir(), 'gk32-doctor-virgin-'));
    homes.push(home);
    const previousHome = process.env.HOME;
    const previousOllama = process.env.OLLAMA_HOST;
    process.env.HOME = home;
    process.env.OLLAMA_HOST = 'http://127.0.0.1:11434';
    resetSettingsManager();

    try {
      const checks = await runDoctorChecks(home);
      const settingsPath = join(home, '.codebuddy', 'user-settings.json');
      expect(existsSync(settingsPath)).toBe(false);

      const ready = checks.find((check) => check.name === 'AI provider ready');
      expect(ready).toBeDefined();
      expect(ready!.message).not.toMatch(/grok-code-fast-1/);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousOllama === undefined) delete process.env.OLLAMA_HOST;
      else process.env.OLLAMA_HOST = previousOllama;
      resetSettingsManager();
    }
  });
});
