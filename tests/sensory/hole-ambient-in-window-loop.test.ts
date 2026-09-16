import { describe, it, expect } from 'vitest';
import { createResponseDecider } from '../../src/sensory/respond-decider.js';

describe('Mission SENSE2 — Trou 3 : Emballement de la fenêtre "ambient-in-window" dans respond-decider', () => {
  it('une question tierce dans la pièce (non adressée au robot) ne doit pas être interceptée comme "engaged"', async () => {
    let currentTime = 100_000;
    const decider = createResponseDecider({
      robotName: 'Lisa',
      engageWindowMs: 120_000,
      now: () => currentTime,
    });

    // Étape 1 : Un accueil vidéo ou une salutation ouvre la fenêtre d'engagement
    decider.markEngaged('greeting');
    const snapshotBefore = decider.snapshot();
    expect(snapshotBefore.engaged).toBe(true);

    // Étape 2 : 30 secondes plus tard, deux humains parlent entre eux dans la pièce, ou la TV parle :
    // "Tu veux un café ?" (phrase non adressée à Lisa)
    currentTime = 130_000;

    const decision = await decider.decide('Tu veux un café ?');

    // TROU PROUVÉ : Dans le code actuel, isDirectedFollowUp renvoie true dès qu'il y a '?' ou 'tu',
    // causant decider.decide() à répondre 'engaged' (respond: true) et à prolonger la fenêtre !
    // Le comportement attendu pour éviter que Lisa ne s'incruste dans la conversation est de rester silencieux :
    // respond: false, reason: 'ambient-in-window'.
    // Actuellement, decision.respond est true et decision.reason est 'engaged', donc ce test échoue en ROUGE.
    expect(decision.respond).toBe(false);
    expect(decision.reason).toBe('ambient-in-window');
  });

  it('une question tierce ambiante ne doit pas réarmer et prolonger la fenêtre d\'engagement de 2 minutes', async () => {
    let currentTime = 100_000;
    const decider = createResponseDecider({
      robotName: 'Lisa',
      engageWindowMs: 120_000, // 2 minutes
      now: () => currentTime,
    });

    // Fenêtre ouverte à t = 100_000 -> devrait expirer à t = 220_000
    decider.markEngaged('arrival');

    // À t = 210_000 (10 secondes avant expiration), une phrase TV pose une question générale
    currentTime = 210_000;
    await decider.decide('Est-ce que tout va bien ?');

    // À t = 225_000 (après les 120s initiales), la fenêtre devrait être expirée
    currentTime = 225_000;
    const snapshotAfter = decider.snapshot();

    // TROU PROUVÉ : La question TV a réexécuté markEngaged('addressed'),
    // prolongeant la fenêtre jusqu'à t = 330_000 !
    // Donc snapshotAfter.engaged est encore true au lieu de false. Ce test échoue en ROUGE.
    expect(snapshotAfter.engaged).toBe(false);
  });
});
