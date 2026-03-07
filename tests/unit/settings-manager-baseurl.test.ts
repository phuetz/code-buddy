// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

import { SettingsManager, getSettingsManager } from '../../src/utils/settings-manager.js';

function resetSettingsManager(): void {
  (SettingsManager as unknown as { instance: SettingsManager | undefined }).instance = undefined;
}

describe('SettingsManager baseURL hardening', () => {
  beforeEach(() => {
    resetSettingsManager();
    vi.clearAllMocks();
    delete process.env.GROK_BASE_URL;

    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined as unknown as string);
  });

  it('rejects baseURL containing credentials', () => {
    const manager = getSettingsManager();

    expect(() => {
      manager.updateUserSetting('baseURL', 'https://user:pass@example.com/v1');
    }).toThrow('Base URL must not contain credentials');
  });

  it('normalizes baseURL by removing trailing slash before persistence', () => {
    const manager = getSettingsManager();

    manager.updateUserSetting('baseURL', 'https://api.example.com/v1/');

    expect(fs.writeFileSync).toHaveBeenCalled();
    const serialized = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    const saved = JSON.parse(serialized);
    expect(saved.baseURL).toBe('https://api.example.com/v1');
  });

  it('ignores invalid GROK_BASE_URL and falls back to default', () => {
    process.env.GROK_BASE_URL = 'not-a-url';
    const manager = getSettingsManager();

    expect(manager.getBaseURL()).toBe('https://api.x.ai/v1');
  });
});
