import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wireSemanticVisionReaction } from '../../src/sensory/semantic-vision-reaction.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import { beginSpeaking, endSpeaking, _resetVoiceActivityForTests } from '../../src/sensory/voice-activity.js';

describe('Mission SENSE2 — Trou 4 : Course et collision entre accueil vidéo et parole vocale active', () => {
  beforeEach(() => {
    _resetVoiceActivityForTests();
    delete process.env.CODEBUDDY_SENSORY_GREET;
  });

  afterEach(() => {
    _resetVoiceActivityForTests();
    delete process.env.CODEBUDDY_SENSORY_GREET;
  });

  it('l\'accueil vidéo ne doit pas se déclencher pendant que le robot est déjà en train de parler', async () => {
    process.env.CODEBUDDY_SENSORY_GREET = 'true';
    const bus = getGlobalEventBus();
    const greet = vi.fn(async () => {});
    const nowMs = 100_000;

    // Lisa est en train de prononcer une réponse vocale (haut-parleur actif)
    beginSpeaking(nowMs);

    const unwire = wireSemanticVisionReaction({
      greet,
      now: () => nowMs,
    });

    try {
      // Un événement person_entered survient pendant la réplique vocale de Lisa
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'vision',
          kind: 'person_entered',
          payload: { identityPending: false },
        },
      });

      await new Promise((r) => setTimeout(r, 100));

      // TROU PROUVÉ : semantic-vision-reaction ne vérifie pas isSpeaking().
      // Elle appelle greet() alors que la bouche du robot est déjà occupée,
      // ce qui empile l'accueil dans mouthChain et provoque deux prises de parole consécutives.
      // Le test attend que greet ne soit pas appelé pendant isSpeaking(), mais il est appelé.
      expect(greet).not.toHaveBeenCalled();
    } finally {
      endSpeaking(nowMs + 1000);
      unwire();
    }
  });
});
