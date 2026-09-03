import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wireSpeechReaction } from '../../src/sensory/speech-reaction.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import { _resetVoiceActivityForTests } from '../../src/sensory/voice-activity.js';
import { isLikelyIncompleteVoiceTurn } from '../../src/sensory/voice-turn-taking.js';

describe('Mission SENSE6 — Trou 5 : Tour détecté fini par v1-mini alors que l\'humain hésite', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    _resetVoiceActivityForTests();
    process.env.CODEBUDDY_SENSORY_TURN_DETECTOR = 'livekit';
    process.env.BUDDY_SENSE_END_SILENCE_MS = '350';
    process.env.CODEBUDDY_SENSORY_TURN_HEURISTIC = 'true';
    delete process.env.CODEBUDDY_SENSORY_AEC_TRUST;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    _resetVoiceActivityForTests();
    vi.restoreAllMocks();
  });

  it('ne doit pas couper la parole de l\'humain sur une hésitation française ("si...", "parce que...") même si v1-mini déclare endOfTurn', async () => {
    const bus = getGlobalEventBus();
    const heardTurns: string[] = [];
    let currentTime = 100_000;

    // Phrase manifestement incomplète en français
    const incompleteHumanPhrase = 'Lisa, je voulais te demander si';
    expect(isLikelyIncompleteVoiceTurn(incompleteHumanPhrase)).toBe(true);

    const unwire = wireSpeechReaction({
      now: () => currentTime,
      onHeard: async (text) => {
        heardTurns.push(text);
      },
    });

    try {
      // Événement transcript_final provenant de LiveKit turn-detector-v1-mini :
      // Le modèle v1-mini (conçu pour l'anglais) émet une probabilité de 0.35,
      // ce qui dépasse son seuil agressif par défaut de 0.285.
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'audio',
          kind: 'transcript_final',
          payload: {
            text: incompleteHumanPhrase,
            turnDetector: 'turn-detector-v1-mini',
            turnProbability: 0.35,
            turnThreshold: 0.285,
            endpointWaitMs: 350,
            startedAtMs: currentTime - 1000,
            endedAtMs: currentTime,
            aecActive: false,
          },
        },
      });

      // Attendre un temps très court (50ms) pour vérifier si le tour a été retenu (held)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // GARANTIE DE NUIT ATTENDUE :
      // Le système doit accorder le délai de grâce (hold de 550 à 900 ms) pour laisser l'humain
      // terminer sa phrase, et NE PAS lancer la réponse de Lisa immédiatement.
      //
      // TROU PROUVÉ :
      // Dans speech-reaction.ts (lignes 2365-2370) :
      // turnDecision?.endOfTurn vaut true (0.35 >= 0.285).
      // Le bloc de temporisation vérifie :
      // (turnDecision?.endOfTurn === false || (turnDecision?.endOfTurn !== true && !livePayload?.turnDetector && isLikelyIncompleteVoiceTurn(text)))
      // Les deux conditions sont fausses dès que turnDecision.endOfTurn === true !
      // L'heuristique syntaxique française est donc totalement écrasée par v1-mini,
      // et Lisa commence à répondre immédiatement à une phrase inachevée !
      expect(heardTurns).toEqual([]);
    } finally {
      unwire();
    }
  });
});
