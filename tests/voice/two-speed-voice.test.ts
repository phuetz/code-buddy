import { describe, expect, it } from 'vitest';

import {
  resolveTwoSpeedShortMaxChars,
  selectTwoSpeedTtsRoute,
  twoSpeedTtsEnabled,
} from '../../src/voice/two-speed-voice.js';

describe('two-speed voice policy', () => {
  it('is a strict opt-in and leaves every phrase on the established route by default', () => {
    expect(twoSpeedTtsEnabled({})).toBe(false);
    expect(selectTwoSpeedTtsRoute('Oui.', {})).toEqual({
      route: 'default',
      reason: 'feature-disabled',
    });
    expect(selectTwoSpeedTtsRoute('Une réponse beaucoup plus longue.'.repeat(8), {})).toEqual({
      route: 'default',
      reason: 'feature-disabled',
    });
  });

  it('routes at most 80 characters locally and longer continuations to ElevenLabs', () => {
    const env = { CODEBUDDY_TTS_TWO_SPEED: 'true' };
    expect(resolveTwoSpeedShortMaxChars(env)).toBe(80);
    expect(selectTwoSpeedTtsRoute('a'.repeat(80), env)).toEqual({
      route: 'local',
      reason: 'short<=80',
    });
    expect(selectTwoSpeedTtsRoute('a'.repeat(81), env)).toEqual({
      route: 'elevenlabs',
      reason: 'long>80',
    });
  });

  it('honours a bounded custom threshold', () => {
    const env = {
      CODEBUDDY_TTS_TWO_SPEED: 'true',
      CODEBUDDY_TTS_SHORT_MAX_CHARS: '12',
    };
    expect(resolveTwoSpeedShortMaxChars(env)).toBe(12);
    expect(selectTwoSpeedTtsRoute('123456789012', env).route).toBe('local');
    expect(selectTwoSpeedTtsRoute('1234567890123', env).route).toBe('elevenlabs');
  });

  it.each([
    ['backchannel', 'Alors…'],
    ['opening', 'Une ouverture volontairement plus longue que le seuil configuré.'],
    ['reminder', "C'est l'heure de prendre le traitement prévu ce matin."],
    ['conv3-first', 'Première phrase autonome de CONV3, même lorsqu’elle dépasse le seuil.'],
  ] as const)('routes the %s hint locally regardless of length', (hint, text) => {
    expect(selectTwoSpeedTtsRoute(text, {
      CODEBUDDY_TTS_TWO_SPEED: 'true',
      CODEBUDDY_TTS_SHORT_MAX_CHARS: '5',
    }, hint)).toEqual({ route: 'local', reason: hint });
  });

  it('recognizes the fixed repair prompt “pardon ?” as a local route', () => {
    expect(selectTwoSpeedTtsRoute('Pardon ?', {
      CODEBUDDY_TTS_TWO_SPEED: 'true',
      CODEBUDDY_TTS_SHORT_MAX_CHARS: '5',
    })).toEqual({ route: 'local', reason: 'repair' });
    expect(selectTwoSpeedTtsRoute("Pardon, je n'ai pas compris.", {
      CODEBUDDY_TTS_TWO_SPEED: 'true',
      CODEBUDDY_TTS_SHORT_MAX_CHARS: '5',
    })).toEqual({ route: 'local', reason: 'repair' });
  });
});
