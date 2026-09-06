import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SettingsManager, getSettingsManager } from '../../src/utils/settings-manager.js';
import { logger } from '../../src/utils/logger.js';

function resetSettingsManager(): void {
  (SettingsManager as unknown as { instance: SettingsManager | undefined }).instance = undefined;
}

describe('user-settings.json empty-file repair', () => {
  let tmpDir: string;
  let userSettingsPath: string;
  let projectSettingsPath: string;

  beforeEach(() => {
    const root = path.join(process.cwd(), '_qa', 'tg');
    fs.mkdirSync(root, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(root, 'settings-'));
    const cfg = path.join(tmpDir, '.codebuddy');
    fs.mkdirSync(cfg, { recursive: true });
    userSettingsPath = path.join(cfg, 'user-settings.json');
    projectSettingsPath = path.join(cfg, 'settings.json');
    resetSettingsManager();
  });

  afterEach(() => {
    resetSettingsManager();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rewrites an empty user-settings.json with defaults, once, and logs it', () => {
    fs.writeFileSync(userSettingsPath, '');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const manager = getSettingsManager({ userSettingsPath, projectSettingsPath });
    const loaded = manager.loadUserSettings();
    expect(loaded.defaultModel).toBeTruthy();
    const rewritten = fs.readFileSync(userSettingsPath, 'utf8');
    expect(rewritten.trim().length).toBeGreaterThan(2);
    expect(JSON.parse(rewritten)).toMatchObject({ defaultModel: loaded.defaultModel });
    const repairLogs = warn.mock.calls.filter((call) =>
      String(call[0]).includes('restored defaults once'),
    );
    expect(repairLogs).toHaveLength(1);
    manager.loadUserSettings();
    const repairLogsAfter = warn.mock.calls.filter((call) =>
      String(call[0]).includes('restored defaults once'),
    );
    expect(repairLogsAfter).toHaveLength(1);
    warn.mockRestore();
  });
});
