import { describe, expect, it } from 'vitest';
import {
  COMPLETED_TURN_END_SILENCE_MS,
  DEFAULT_INCOMPLETE_TURN_HOLD_MS,
  SUSPENDED_TURN_END_SILENCE_MS,
  isLikelyIncompleteVoiceTurn,
  joinVoiceTurnFragments,
  resolveConversationalTurnEndSilenceMs,
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

  it('keeps the conversational endpoint heuristic strictly opt-in', () => {
    expect(resolveConversationalTurnEndSilenceMs('Tu viens ? ', {})).toBeNull();
    expect(resolveConversationalTurnEndSilenceMs('Je pensais donc', {})).toBeNull();
  });

  it('targets 350 ms for closed turns and 900 ms for suspended turns', () => {
    const enabled = { CODEBUDDY_SENSORY_TURN_HEURISTIC: 'true' };

    expect(resolveConversationalTurnEndSilenceMs('Tu viens ?', enabled)).toBe(
      COMPLETED_TURN_END_SILENCE_MS,
    );
    expect(resolveConversationalTurnEndSilenceMs('Très bien.', enabled)).toBe(
      COMPLETED_TURN_END_SILENCE_MS,
    );
    expect(resolveConversationalTurnEndSilenceMs('Je pensais donc', enabled)).toBe(
      SUSPENDED_TURN_END_SILENCE_MS,
    );
    expect(resolveConversationalTurnEndSilenceMs('Et…', enabled)).toBe(
      SUSPENDED_TURN_END_SILENCE_MS,
    );
  });
});
