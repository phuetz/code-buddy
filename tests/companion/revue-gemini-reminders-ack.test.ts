/**
 * Preuve du trou logique : un ack qui se lie au mauvais rappel.
 *
 * Mécanisme (src/companion/reminders.ts:491-495) :
 * `matchAck(text, nowMs, windowMs)` vérifie uniquement `DONE_PHRASE.test(text)`,
 * puis sélectionne aveuglément `candidates[0]?.id` (le rappel le plus récemment tiré).
 * Il ignore totalement le contenu sémantique ou le libellé mentionné par l'utilisateur.
 *
 * Scénario :
 * 1. À t=1000, le rappel 'r-meds' ("médicaments") tire.
 * 2. À t=1500, le rappel 'r-dentiste' ("dentiste") tire.
 * 3. À t=2000, l'utilisateur dit explicitement : "j'ai pris mes médicaments".
 * Résultat actuel : `matchAck` retourne 'r-dentiste' ! Le rendez-vous dentiste
 * est acquitté par erreur, et les médicaments restent en attente jusqu'à
 * expiration puis fausse alerte Telegram ("Pas de confirmation : médicaments").
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  openAck,
  matchAck,
  resetAcks,
  pendingAcks,
} from '../../src/companion/reminders.js';

describe('Revue G3 — Rappels : liaison erronée de l’acquittement (ack collision)', () => {
  beforeEach(() => {
    resetAcks();
  });

  it('lie un acquittement explicite ("j\'ai pris mes médicaments") au mauvais rappel s’il n’est pas le plus récent', () => {
    const tFiredMeds = 100_000;
    const tFiredDentiste = 100_500;
    const tUserAck = 101_000;

    // Deux rappels tirent à quelques secondes d'intervalle
    openAck({ id: 'r-meds', label: 'médicaments' }, tFiredMeds);
    openAck({ id: 'r-dentiste', label: 'dentiste' }, tFiredDentiste);

    expect(pendingAcks(tUserAck)).toHaveLength(2);

    // L'utilisateur dit sans ambiguïté qu'il a pris ses médicaments
    const matchedId = matchAck("j'ai pris mes médicaments", tUserAck);

    // L'acquittement DOIT cibler 'r-meds', jamais 'r-dentiste'
    expect(matchedId).toBe('r-meds');
  });

  it('lie "c\'est fait pour le train" au train même si un autre rappel plus récent est en attente', () => {
    const tFiredTrain = 200_000;
    const tFiredPause = 200_500;
    const tUserAck = 201_000;

    openAck({ id: 'r-train', label: 'billet de train' }, tFiredTrain);
    openAck({ id: 'r-pause', label: 'pause café' }, tFiredPause);

    const matchedId = matchAck("c'est fait pour le billet de train", tUserAck);
    expect(matchedId).toBe('r-train');
  });
});
