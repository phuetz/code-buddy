import { describe, expect, it } from 'vitest';

import { __voiceAudioPlayerTest } from '../../src/sensory/voice-loop.js';
import { streamToSpeech } from '../../src/sensory/voice-stream.js';

// Audit 2026-09-24, B2: the player's exit code was ignored, so a line the audio
// device never played (busy ALSA device, missing player…) was still counted as
// "spoken" and entered the conversation memory. GLaDOS and Pipecat both count
// what was actually played; none of the Jarvis projects does.
const passthroughGuard = (fn: () => Promise<unknown>): Promise<void> => fn().then(() => undefined);
const noUnlink = async (): Promise<void> => {};

async function* sentences(): AsyncGenerator<string> {
  yield 'Première phrase. Deuxième phrase.';
}

describe('what counts as spoken', () => {
  it('defaultPlay reports a player that exits in error as not played', async () => {
    const failing = Promise.resolve({ cmd: 'false', stdinArgs: [], fileArgs: () => [] });
    const played = await __voiceAudioPlayerTest.defaultPlay('/nonexistent.wav', { alreadyNormalized: true }, failing);
    expect(played).toBe(false);
  });

  it('defaultPlay reports a player that exits cleanly as played', async () => {
    const working = Promise.resolve({ cmd: 'true', stdinArgs: [], fileArgs: () => [] });
    const played = await __voiceAudioPlayerTest.defaultPlay('/nonexistent.wav', { alreadyNormalized: true }, working);
    expect(played).toBe(true);
  });

  it('a stream whose player fails on every segment has spoken nothing', async () => {
    const result = await streamToSpeech({
      stream: sentences(),
      synth: async (t) => `wav:${t}`,
      play: async () => false,
      guard: passthroughGuard,
      unlink: noUnlink,
    });
    expect(result.played).toBe(false);
    expect(result.spoken).toBe('');
  });

  it('only the segments actually played are recorded as spoken', async () => {
    const result = await streamToSpeech({
      stream: sentences(),
      synth: async (t) => `wav:${t}`,
      play: async (wav) => wav !== 'wav:Première phrase.',
      guard: passthroughGuard,
      unlink: noUnlink,
    });
    expect(result.played).toBe(true);
    expect(result.spoken).toBe('Deuxième phrase.');
  });
});
