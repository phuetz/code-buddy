import { describe, expect, it } from 'vitest';
import {
  elevenLabsVoiceSettingsSignature,
  resolveElevenLabsVoiceSettings,
} from '../../src/voice/elevenlabs-voice.js';
import { resolveElevenLabsCacheVoice } from '../../src/voice/local-tts.js';

describe('réglages de rendu ElevenLabs de la voix du robot (voix douce)', () => {
  it('sans variable, aucun réglage n\'est envoyé et la clé de cache est inchangée', () => {
    const env = { CODEBUDDY_TTS_VOICE: 'elevenlabs:abc', CODEBUDDY_ELEVENLABS_MODEL: 'eleven_multilingual_v2' };
    expect(resolveElevenLabsVoiceSettings(env)).toBeUndefined();
    expect(resolveElevenLabsCacheVoice(env)).toBe('elevenlabs:abc:model=eleven_multilingual_v2:format=pcm_24000');
  });

  it('lit stabilité, similarité, style, présence et vitesse, bornés, et change la clé de cache', () => {
    const env = {
      CODEBUDDY_TTS_VOICE: 'elevenlabs:abc',
      CODEBUDDY_ELEVENLABS_MODEL: 'eleven_multilingual_v2',
      CODEBUDDY_ELEVENLABS_STABILITY: '0.8',
      CODEBUDDY_ELEVENLABS_SIMILARITY: '1.7',
      CODEBUDDY_ELEVENLABS_STYLE: '0.1',
      CODEBUDDY_ELEVENLABS_SPEAKER_BOOST: 'false',
      CODEBUDDY_ELEVENLABS_SPEED: '0.5',
    };
    expect(resolveElevenLabsVoiceSettings(env)).toEqual({
      stability: 0.8,
      similarityBoost: 1,
      style: 0.1,
      useSpeakerBoost: false,
      speed: 0.7,
    });
    const key = resolveElevenLabsCacheVoice(env);
    expect(key).toContain(':settings=');
    expect(key).not.toBe(resolveElevenLabsCacheVoice({ CODEBUDDY_TTS_VOICE: 'elevenlabs:abc' }));
    expect(elevenLabsVoiceSettingsSignature(env)).toContain('stability=0.8');
  });

  it('ignore une valeur non numérique', () => {
    expect(resolveElevenLabsVoiceSettings({ CODEBUDDY_ELEVENLABS_STABILITY: 'douce' })).toBeUndefined();
  });
});
