/**
 * `CODEBUDDY_VOICE_MAX_TOKENS` says how long the robot should talk. It is an
 * operator decision, not a hint: Patrice set 48 and heard a 656-character answer
 * split into fourteen phrases, because the budget was computed as
 * `Math.max(96, min(512, max(configured, conversationTokenBudget(...))))` — the
 * floor and the automatic budget both overrode him.
 */
import { describe, expect, it } from 'vitest';
import { __testSummaryMaxTokens } from '../../src/sensory/agent-reply.js';

// Long enough that the automatic budget would ask for far more than 48.
const LONG = 'Explique-moi en détail comment fonctionne la boucle vocale du robot. '.repeat(20);

describe('spoken reply token budget', () => {
  it('honours an explicit short budget instead of raising it to a floor', () => {
    expect(__testSummaryMaxTokens(LONG, { CODEBUDDY_VOICE_MAX_TOKENS: '48' })).toBe(48);
  });

  it('honours an explicit generous budget too', () => {
    expect(__testSummaryMaxTokens('court', { CODEBUDDY_VOICE_MAX_TOKENS: '200' })).toBe(200);
  });

  it('never exceeds the ceiling, however large the request', () => {
    expect(__testSummaryMaxTokens(LONG, { CODEBUDDY_VOICE_MAX_TOKENS: '99999' })).toBe(512);
  });

  it('ignores a nonsense value rather than muting the robot', () => {
    const auto = __testSummaryMaxTokens(LONG, {});
    expect(__testSummaryMaxTokens(LONG, { CODEBUDDY_VOICE_MAX_TOKENS: 'beaucoup' })).toBe(auto);
    expect(__testSummaryMaxTokens(LONG, { CODEBUDDY_VOICE_MAX_TOKENS: '0' })).toBe(auto);
  });

  it('keeps the automatic budget unchanged when nothing is configured', () => {
    expect(__testSummaryMaxTokens(LONG, {})).toBeGreaterThanOrEqual(96);
    expect(__testSummaryMaxTokens(LONG, {})).toBeLessThanOrEqual(512);
  });
});
