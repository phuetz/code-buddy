import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UpdateChannelManager } from '../../src/utils/session-enhancements.js';

describe('UpdateChannelManager channel metadata', () => {
  const originalBetaVersion = process.env.CODEBUDDY_BETA_VERSION;
  const originalBetaDate = process.env.CODEBUDDY_BETA_DATE;

  beforeEach(() => {
    UpdateChannelManager.resetInstance();
  });

  afterEach(() => {
    if (originalBetaVersion === undefined) {
      delete process.env.CODEBUDDY_BETA_VERSION;
    } else {
      process.env.CODEBUDDY_BETA_VERSION = originalBetaVersion;
    }

    if (originalBetaDate === undefined) {
      delete process.env.CODEBUDDY_BETA_DATE;
    } else {
      process.env.CODEBUDDY_BETA_DATE = originalBetaDate;
    }
  });

  it('derives channel versions from the installed package metadata', () => {
    const manager = UpdateChannelManager.getInstance();
    const stable = manager.getLatestVersion('stable');
    const beta = manager.getLatestVersion('beta');

    expect(stable.version).toMatch(/\d+\.\d+\.\d+/);
    expect(beta.version).toContain('beta');
  });

  it('allows environment overrides for channel metadata', () => {
    process.env.CODEBUDDY_BETA_VERSION = '9.9.9-beta.9';
    process.env.CODEBUDDY_BETA_DATE = '2026-03-01T10:00:00.000Z';

    const manager = UpdateChannelManager.getInstance();
    const beta = manager.getLatestVersion('beta');

    expect(beta.version).toBe('9.9.9-beta.9');
    expect(beta.date).toBe('2026-03-01T10:00:00.000Z');
  });
});
