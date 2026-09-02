import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wireSemanticVisionReaction } from '../../src/sensory/semantic-vision-reaction.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import { HomeModeStore } from '../../src/life-rhythm/home-mode-store.js';

describe('Mission SENSE3 — Trou 3 : L\'accueil vidéo ignore la politique Maison (HomeInteractionPolicy)', () => {
  beforeEach(() => {
    delete process.env.CODEBUDDY_SENSORY_GREET;
  });

  afterEach(() => {
    delete process.env.CODEBUDDY_SENSORY_GREET;
  });

  it('l\'accueil vidéo doit respecter les modes sans contact spontané de la maison', async () => {
    process.env.CODEBUDDY_SENSORY_GREET = 'true';
    const bus = getGlobalEventBus();
    const greet = vi.fn(async () => {});

    const store = new HomeModeStore();

    const unwire = wireSemanticVisionReaction({
      greet,
      homeModeStore: store,
      now: () => Date.now(),
    });

    try {
      for (const mode of ['silent', 'focus', 'rest', 'guests'] as const) {
        await store.setMode(mode, { reason: `mode ${mode}` });
        bus.emit('sensory:perception', {
          source: 'test',
          metadata: {
            modality: 'vision',
            kind: 'person_entered',
            payload: { identityPending: false },
          },
        });
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(greet).not.toHaveBeenCalled();
    } finally {
      unwire();
      await store.setMode('normal');
    }
  });
});
