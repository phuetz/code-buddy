import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { VoiceInputConfig } from '../../src/input/voice-input-enhanced.js';

const mocks = vi.hoisted(() => ({
  commandExists: vi.fn(),
}));

vi.mock('../../src/utils/command-exists.js', () => ({
  commandExists: mocks.commandExists,
}));

import { VoiceInputManager } from '../../src/input/voice-input-enhanced.js';

function setVoiceConfig(manager: VoiceInputManager, config: Partial<VoiceInputConfig>): void {
  const target = manager as unknown as { config: VoiceInputConfig };
  target.config = { ...manager.getConfig(), ...config };
}

describe('VoiceInputManager availability and errors', () => {
  const savedOpenAiKey = process.env.OPENAI_API_KEY;
  const realHomedir = os.homedir();
  const homedirSpy = vi.spyOn(os, 'homedir');

  afterEach(async () => {
    vi.clearAllMocks();
    homedirSpy.mockReturnValue(realHomedir);
    if (savedOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = savedOpenAiKey;
    }
  });

  it('accepts OPENAI_API_KEY for whisper-api availability', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    mocks.commandExists.mockResolvedValue(true);
    const manager = new VoiceInputManager({ provider: 'whisper-api' });
    setVoiceConfig(manager, { provider: 'whisper-api', apiKey: undefined });

    try {
      await expect(manager.isAvailable()).resolves.toEqual({ available: true });
    } finally {
      manager.dispose();
    }
  });

  it('does not advertise the unimplemented system STT provider as available', async () => {
    mocks.commandExists.mockResolvedValue(true);
    const manager = new VoiceInputManager({ provider: 'system' });
    setVoiceConfig(manager, { provider: 'system' });

    try {
      const availability = await manager.isAvailable();
      expect(availability.available).toBe(false);
      expect(availability.reason).toContain('System speech recognition is not implemented');
    } finally {
      manager.dispose();
    }
  });

  it('does not throw when startRecording emits an availability error without listeners', async () => {
    mocks.commandExists.mockResolvedValue(false);
    const manager = new VoiceInputManager({ provider: 'whisper-local' });
    setVoiceConfig(manager, { provider: 'whisper-local' });

    try {
      await expect(manager.startRecording()).resolves.toBeUndefined();
      expect(manager.getState().isRecording).toBe(false);
    } finally {
      manager.dispose();
    }
  });

  it('saves voice config with owner-only permissions', async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), 'voice-config-home-'));
    homedirSpy.mockReturnValue(tempHome);
    mocks.commandExists.mockResolvedValue(true);
    const manager = new VoiceInputManager({ provider: 'whisper-api' });
    setVoiceConfig(manager, { apiKey: 'sk-test-secret' });

    try {
      manager.saveConfig();
      const configDir = path.join(tempHome, '.codebuddy');
      const configPath = path.join(configDir, 'voice-config.json');

      expect(fs.existsSync(configPath)).toBe(true);
      // POSIX mode bits only: Windows reports 0o666 whatever the chmod.
      if (process.platform !== 'win32') {
        expect(fs.statSync(configDir).mode & 0o777).toBe(0o700);
        expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
      }
      expect(fs.readFileSync(configPath, 'utf8')).toContain('sk-test-secret');
    } finally {
      manager.dispose();
      await rm(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
