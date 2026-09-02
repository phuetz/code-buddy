import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wireSemanticVisionReaction } from '../../src/sensory/semantic-vision-reaction.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import { HomeModeStore } from '../../src/life-rhythm/home-mode-store.js';

describe('Mission SENSE2 — Trou 2 : L\'accueil vidéo ignore la politique Maison (HomeInteractionPolicy)', () => {
  beforeEach(() => {
    delete process.env.CODEBUDDY_SENSORY_GREET;
  });

  afterEach(() => {
    delete process.env.CODEBUDDY_SENSORY_GREET;
  });

  it('l\'accueil vidéo doit respecter le mode silencieux/invités de la maison et ne pas parler', async () => {
    process.env.CODEBUDDY_SENSORY_GREET = 'true';
    const bus = getGlobalEventBus();
    const greet = vi.fn(async () => {});

    // On configure le mode de la maison en "silent"
    const store = new HomeModeStore();
    await store.setMode('silent', { reason: 'Sommeil / silence demandé' });

    const unwire = wireSemanticVisionReaction({
      greet,
      now: () => Date.now(),
    });

    try {
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'vision',
          kind: 'person_entered',
          payload: { identityPending: false },
        },
      });

      await new Promise((r) => setTimeout(r, 100));

      // TROU PROUVÉ : semantic-vision-reaction.ts n'intègre pas evaluateHomeInteractionPolicy.
      // En mode "silent", aucune voix spontanée ne devrait retentir.
      // Dans le code actuel, greet est appelé, donc l'assertion échoue en ROUGE.
      expect(greet).not.toHaveBeenCalled();
    } finally {
      unwire();
      await store.setMode('normal');
    }
  });
});
