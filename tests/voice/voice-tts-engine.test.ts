import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const synthesizePocketWav = vi.hoisted(() => vi.fn());
const synthesizeTextToSpeech = vi.hoisted(() => vi.fn());

vi.mock('../../src/voice/local-tts.js', () => ({
  resolveTtsEngine: () => 'pocket',
  synthesizePocketWav,
}));
vi.mock('../../src/tools/text-to-speech-tool.js', () => ({ synthesizeTextToSpeech }));

import {
  __voiceAudioPlayerTest,
  makeVoiceReply,
} from '../../src/sensory/voice-loop.js';

describe('voice loop — one TTS engine per turn', () => {
  const previousCache = process.env.CODEBUDDY_TTS_CACHE;

  beforeEach(() => {
    process.env.CODEBUDDY_TTS_CACHE = 'false';
    synthesizePocketWav.mockReset();
    synthesizeTextToSpeech.mockReset();
  });

  afterEach(() => {
    if (previousCache === undefined) delete process.env.CODEBUDDY_TTS_CACHE;
    else process.env.CODEBUDDY_TTS_CACHE = previousCache;
  });

  it('does not switch to Piper after the locked Pocket engine fails a phrase', async () => {
    synthesizePocketWav
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const synth = __voiceAudioPlayerTest.makeDefaultSynth(undefined, undefined, 'pocket');

    await expect(synth('Première phrase.')).resolves.toContain('cb-voice-');
    await expect(synth('Deuxième phrase.')).rejects.toThrow('Pocket TTS synthesis failed');
    await expect(synth('Troisième phrase.')).resolves.toContain('cb-voice-');

    expect(synthesizePocketWav).toHaveBeenCalledTimes(3);
    expect(synthesizeTextToSpeech).not.toHaveBeenCalled();
  });

  it('keeps the public voice turn never-throws when its locked engine is unavailable', async () => {
    synthesizePocketWav.mockResolvedValue(false);
    const reply = makeVoiceReply({
      voice: '/tmp/fallback-voice.onnx',
      replyFn: async () => 'Cette réponse reste silencieuse proprement.',
      play: async () => undefined,
    });

    await expect(reply('Réponds-moi.')).resolves.toBeUndefined();
    expect(synthesizeTextToSpeech).not.toHaveBeenCalled();
  });
});
