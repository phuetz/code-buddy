import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(() => {
    throw new Error('command not found');
  }),
}));

import { checkTtsProviders } from '../../src/doctor/index.js';

describe('doctor TTS guidance', () => {
  let previousKey: string | undefined;

  beforeEach(() => {
    previousKey = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
  });

  afterEach(() => {
    if (previousKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = previousKey;
  });

  it('explains the Pocket/ElevenLabs paths and does not recommend espeak', () => {
    const check = checkTtsProviders()[0];

    expect(check?.status).toBe('warn');
    expect(check?.message).toContain('Pocket');
    expect(check?.message).toContain('ElevenLabs');
    expect(check?.message.toLowerCase()).not.toContain('espeak');
    expect(check?.message).not.toContain('edge-tts');
  });
});
