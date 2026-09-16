/**
 * `CODEBUDDY_VOICE_MAX_TOKENS` decides how long Lisa talks. Patrice set 48 and
 * heard 479-character replies split into a dozen phrases: outside the 'concise'
 * style the value was only a lower bound, and the automatic budget pushed it to
 * the 512 ceiling. Every one of his turns took the chitchat route, so this is the
 * budget he actually hears.
 */
import { describe, expect, it } from 'vitest';
import { __testVoiceMaxTokens } from '../../src/sensory/voice-loop.js';

const LONG = 'Explique-moi comment marche la boucle vocale et pourquoi elle coupe. '.repeat(12);

describe('spoken reply length budget (chitchat route)', () => {
  it('honours an explicit short budget in the default natural style', () => {
    expect(__testVoiceMaxTokens(LONG, [], { CODEBUDDY_VOICE_MAX_TOKENS: '48' })).toBe(48);
  });

  it('honours it in the developed style too, instead of multiplying past it', () => {
    expect(
      __testVoiceMaxTokens(LONG, [], {
        CODEBUDDY_VOICE_MAX_TOKENS: '48',
        CODEBUDDY_VOICE_RESPONSE_STYLE: 'developed',
      }),
    ).toBe(48);
  });

  it('honours a deliberately generous budget', () => {
    expect(__testVoiceMaxTokens('court', [], { CODEBUDDY_VOICE_MAX_TOKENS: '300' })).toBe(300);
  });

  it('never exceeds the ceiling', () => {
    expect(__testVoiceMaxTokens(LONG, [], { CODEBUDDY_VOICE_MAX_TOKENS: '9999' })).toBe(512);
  });

  it('ignores nonsense rather than muting the robot', () => {
    const auto = __testVoiceMaxTokens(LONG, [], {});
    expect(__testVoiceMaxTokens(LONG, [], { CODEBUDDY_VOICE_MAX_TOKENS: 'plein' })).toBe(auto);
    expect(__testVoiceMaxTokens(LONG, [], { CODEBUDDY_VOICE_MAX_TOKENS: '-5' })).toBe(auto);
  });

  it('leaves the automatic budget untouched when nothing is configured', () => {
    expect(__testVoiceMaxTokens(LONG, [], {})).toBeGreaterThanOrEqual(64);
    expect(__testVoiceMaxTokens(LONG, [], {})).toBeLessThanOrEqual(512);
    expect(__testVoiceMaxTokens(LONG, [], { CODEBUDDY_VOICE_RESPONSE_STYLE: 'concise' })).toBe(48);
  });
});
