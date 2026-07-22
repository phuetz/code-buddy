import { describe, expect, it } from 'vitest';
import {
  buildMemoryCallback,
  DEFAULT_VOICE_CALLBACK_GAP_MS,
  memoryCallbackHash,
  shouldOfferCallback,
} from '../../src/companion/voice-callbacks.js';

describe('spoken memory callbacks', () => {
  it('builds a natural callback from the latest open loop', () => {
    const callback = buildMemoryCallback({
      openLoops: ['On reparle du déploiement bleu plus tard.'],
      commitments: [],
      lastUserPoint: 'La migration est presque prête.',
    });

    expect(callback).toBe('Au fait, tu me parlais de « On reparle du déploiement bleu plus tard ».');
  });

  it('returns null for an empty episode and never invents a detail', () => {
    expect(buildMemoryCallback({ openLoops: [], commitments: [] })).toBeNull();
    expect(buildMemoryCallback(null)).toBeNull();
  });

  it('deduplicates a previously offered open loop by hash', () => {
    const episode = { openLoops: ['Reprendre le diagnostic du micro.'] };
    const first = buildMemoryCallback(episode);
    expect(first).not.toBeNull();

    const offered = new Set([memoryCallbackHash(first!)]);
    expect(buildMemoryCallback(episode, offered)).toBeNull();
  });

  it('can read the structured cues preserved in episode:recent text', () => {
    const callback = buildMemoryCallback(
      "Dernier point de l'utilisateur : Le build est vert. Engagement ou prochaine étape : Je vais vérifier Windows. Point encore ouvert : On reprend les tests demain.",
    );

    expect(callback).toContain('On reprend les tests demain');
    expect(callback).not.toContain('Le build est vert');
  });

  it('enforces the default and configured frequency windows', () => {
    const now = 10_000_000;
    expect(shouldOfferCallback(now, undefined, {})).toBe(true);
    expect(shouldOfferCallback(now, now - DEFAULT_VOICE_CALLBACK_GAP_MS + 1, {})).toBe(false);
    expect(shouldOfferCallback(now, now - DEFAULT_VOICE_CALLBACK_GAP_MS, {})).toBe(true);
    expect(
      shouldOfferCallback(now, now - 999, { CODEBUDDY_VOICE_CALLBACK_GAP_MS: '1000' }),
    ).toBe(false);
    expect(
      shouldOfferCallback(now, now - 1_000, { CODEBUDDY_VOICE_CALLBACK_GAP_MS: '1000' }),
    ).toBe(true);
  });
});
