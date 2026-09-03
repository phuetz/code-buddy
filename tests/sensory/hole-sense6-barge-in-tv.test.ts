import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wireSpeechReaction } from '../../src/sensory/speech-reaction.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import {
  beginSpeaking,
  endSpeaking,
  _resetVoiceActivityForTests,
} from '../../src/sensory/voice-activity.js';
import { createResponseDecider } from '../../src/sensory/respond-decider.js';

describe('Mission SENSE6 — Trou 3 : Barge-in acoustique intempestif déclenché par la télévision', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    _resetVoiceActivityForTests();
    process.env.CODEBUDDY_SENSORY_BARGE_IN = 'true';
    delete process.env.CODEBUDDY_SENSORY_AEC_TRUST; // AEC non approuvé (règle de sécurité SENSE1)
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    _resetVoiceActivityForTests();
    vi.restoreAllMocks();
  });

  it('ne doit pas interrompre la parole de Lisa (barge-in) sur un son de télévision sans adressage direct', async () => {
    const bus = getGlobalEventBus();
    const bargeInEvents: Array<{ payload: unknown; interruptedTurnId?: string }> = [];
    const nowMs = 100_000;

    const decider = createResponseDecider({
      robotName: 'Lisa',
      now: () => nowMs,
    });

    const unwire = wireSpeechReaction({
      now: () => nowMs,
      shouldRespond: (text) => decider.decide(text),
      onBargeInStart: (payload, interruptedTurnId) => {
        bargeInEvents.push({ payload, interruptedTurnId });
      },
      onHeard: async () => {
        // Simule une longue réplique de Lisa de 5 secondes
        await new Promise((resolve) => setTimeout(resolve, 5000));
      },
    });

    try {
      // 1. Un premier tour humain légitime démarre et fait parler Lisa (inFlight = true, isSpeaking = true)
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'audio',
          kind: 'transcript_final',
          payload: {
            text: 'Lisa, donne-moi le bulletin météo s il te plait.',
            startedAtMs: nowMs - 1000,
            endedAtMs: nowMs,
            aecActive: false,
          },
        },
      });

      // Laisser le tour 1 s'installer en vol
      await new Promise((resolve) => setTimeout(resolve, 50));
      beginSpeaking(nowMs);

      // 2. Pendant que Lisa parle, la télévision dans la pièce émet du son pendant 350 ms (non adressé)
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'audio',
          kind: 'speech_start',
          payload: {
            startedAtMs: nowMs + 500,
            audioMs: 350,
            rms: 0.04,
            noiseFloorRms: 0.01, // 12 dB > seuil 6 dB
            aecActive: false,
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // GARANTIE DE NUIT SENSE1/SENSE3 ATTENDUE :
      // La télévision ne doit PAS couper la parole de Lisa lorsque l'AEC n'est pas approuvé.
      // Sans mot-clé d'adressage ni AEC certifié, le barge-in acoustique pur coupe le robot à tort.
      //
      // TROU PROUVÉ :
      // 1. inFlight est true et timing est 'during_playback'.
      // 2. shouldTriggerVoiceBargeInOnSpeechStart vérifie capturedSpeechMs >= 250ms -> renvoie true !
      // 3. shouldTriggerAcousticBargeIn vérifie le dépassement de marge en dB -> renvoie true !
      // 4. onBargeInStart() est appelé immédiatement et coupe Lisa pour une réplique de TV !
      expect(bargeInEvents).toEqual([]);
    } finally {
      endSpeaking(nowMs + 6000);
      unwire();
    }
  });
});
