import { describe, expect, it } from 'vitest';
import { shouldWireSpeechReaction } from '../../src/sensory/reactions.js';

describe('shouldWireSpeechReaction — the speech security invariant', () => {
  it('requires both the opt-in and a non-empty shared token', () => {
    expect(shouldWireSpeechReaction({ speech: 'true', token: 'secret' })).toBe(true);
    expect(shouldWireSpeechReaction({ speech: 'true', token: undefined })).toBe(false);
    expect(shouldWireSpeechReaction({ speech: 'true', token: '' })).toBe(false);
    expect(shouldWireSpeechReaction({ speech: 'false', token: 'secret' })).toBe(false);
    expect(shouldWireSpeechReaction({ token: 'secret' })).toBe(false);
  });
});
