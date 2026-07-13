import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INCOMPLETE_TURN_HOLD_MS,
  isLikelyIncompleteVoiceTurn,
  joinVoiceTurnFragments,
  resolveIncompleteTurnHoldMs,
} from '../../src/sensory/voice-turn-taking.js';

describe('voice turn taking', () => {
  it('holds unfinished French and English thoughts', () => {
    expect(isLikelyIncompleteVoiceTurn('Je voulais te dire que')).toBe(true);
    expect(isLikelyIncompleteVoiceTurn('On pourrait commencer par…')).toBe(true);
    expect(isLikelyIncompleteVoiceTurn('I was thinking because')).toBe(true);
  });

  it('does not delay clearly completed turns', () => {
    expect(isLikelyIncompleteVoiceTurn('Explique-moi cette fonctionnalité.')).toBe(false);
    expect(isLikelyIncompleteVoiceTurn('Pourquoi le ciel est bleu ?')).toBe(false);
    expect(isLikelyIncompleteVoiceTurn('Lisa, arrête')).toBe(false);
  });

  it('joins fragments without duplicating whitespace', () => {
    expect(joinVoiceTurnFragments('je pensais que  ', '  tu avais raison')).toBe(
      'je pensais que tu avais raison',
    );
  });

  it('bounds the continuation hold and supports disabling it', () => {
    expect(resolveIncompleteTurnHoldMs({})).toBe(DEFAULT_INCOMPLETE_TURN_HOLD_MS);
    expect(resolveIncompleteTurnHoldMs({ CODEBUDDY_VOICE_INCOMPLETE_HOLD_MS: '0' })).toBe(0);
    expect(resolveIncompleteTurnHoldMs({ CODEBUDDY_VOICE_INCOMPLETE_HOLD_MS: '9999' })).toBe(3000);
  });
});
