import { describe, expect, it } from 'vitest';

import { summarizeCall } from '../src/renderer/utils/call-model';

describe('summarizeCall', () => {
  it('computes duration and unique speaker count', () => {
    expect(
      summarizeCall([
        { id: 'a', speaker: 'Agent', text: 'Bonjour', startSec: 10, endSec: 15 },
        { id: 'b', speaker: 'Client', text: 'OK', startSec: 16, endSec: 40 },
        { id: 'c', speaker: 'Agent', text: 'Merci', startSec: 42, endSec: 45 },
      ])
    ).toEqual({ durationSec: 35, speakerCount: 2 });
  });

  it('handles empty transcripts', () => {
    expect(summarizeCall([])).toEqual({ durationSec: 0, speakerCount: 0 });
  });
});
