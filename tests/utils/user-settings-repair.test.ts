import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SettingsManager, getSettingsManager } from '../../src/utils/settings-manager.js';
import { logger } from '../../src/utils/logger.js';

function resetSettingsManager(): void {
  (SettingsManager as unknown as { instance: SettingsManager | undefined }).instance = undefined;
}

describe('user-settings.json empty-file handling', () => {
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

  it('keeps an empty file untouched, returns no model, and warns once', () => {
    fs.writeFileSync(userSettingsPath, '');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const manager = getSettingsManager({ userSettingsPath, projectSettingsPath });
    const loaded = manager.loadUserSettings();
    expect(loaded.defaultModel).toBeUndefined();
    expect(fs.readFileSync(userSettingsPath, 'utf8')).toBe('');
    const noticeLogs = warn.mock.calls.filter((call) =>
      String(call[0]).includes('unselected in-memory configuration'),
    );
    expect(noticeLogs).toHaveLength(1);
    manager.loadUserSettings();
    const noticeLogsAfter = warn.mock.calls.filter((call) =>
      String(call[0]).includes('unselected in-memory configuration'),
    );
    expect(noticeLogsAfter).toHaveLength(1);
    expect(fs.readFileSync(userSettingsPath, 'utf8')).toBe('');
    warn.mockRestore();
  });
});
