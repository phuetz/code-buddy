import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wireSemanticVisionReaction } from '../../src/sensory/semantic-vision-reaction.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import { getCompanionConductor, _resetConductorForTests } from '../../src/companion/orchestrator.js';

describe('Mission SENSE2 — Trou 1 : L\'accueil vidéo ignore l\'arbitrage du chef d\'orchestre (orchestrator)', () => {
  beforeEach(() => {
    _resetConductorForTests();
    delete process.env.CODEBUDDY_SENSORY_GREET;
  });

  afterEach(() => {
    _resetConductorForTests();
    delete process.env.CODEBUDDY_SENSORY_GREET;
  });

  it('l\'accueil vidéo doit respecter le chef d\'orchestre et ne pas parler si une autre surface a la parole', async () => {
    process.env.CODEBUDDY_SENSORY_GREET = 'true';
    const bus = getGlobalEventBus();
    const greet = vi.fn(async () => {});
    let currentTime = 100_000;

    // Le chef d'orchestre accorde la parole à la présence à t = 100_000 (gap 45s, jusqu'à 145_000)
    const conductor = getCompanionConductor();
    const claimedPresence = conductor.claim('presence');
    expect(claimedPresence).toBe(true);

    const unwire = wireSemanticVisionReaction({
      greet,
      now: () => currentTime,
    });

    try {
      // 5 secondes plus tard (t = 105_000), un événement person_entered arrive
      currentTime = 105_000;
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'vision',
          kind: 'person_entered',
          payload: { identityPending: false },
        },
      });

      // Laisser le temps à la chaîne asynchrone de s'exécuter
      await new Promise((r) => setTimeout(r, 100));

      // TROU PROUVÉ : L'accueil vidéo ne consulte jamais conductor.claim('arrival').
      // Il devrait s'abstenir de parler car la présence a parlé il y a seulement 5s (< gap 45s).
      // Dans le code actuel non corrigé, greet est appelé (appel = 1), donc cette assertion échoue en ROUGE.
      expect(greet).not.toHaveBeenCalled();
    } finally {
      unwire();
    }
  });
});
