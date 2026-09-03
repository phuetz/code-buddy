import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wireSpeechReaction } from '../../src/sensory/speech-reaction.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import {
  beginSpeaking,
  endSpeaking,
  noteSpokenText,
  _resetVoiceActivityForTests,
} from '../../src/sensory/voice-activity.js';
import { createResponseDecider } from '../../src/sensory/respond-decider.js';
import type { ConversationCueRequest } from '../../src/sensory/conversation-cues.js';

describe('Mission SENSE6 — Trou 1 : Backchannel joué sur un écho ou pendant que Lisa parle', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    _resetVoiceActivityForTests();
    process.env.CODEBUDDY_SENSORY_BACKCHANNEL = 'true';
    process.env.CODEBUDDY_SENSORY_RESPONSE_POLICY = 'contextual';
    delete process.env.CODEBUDDY_SENSORY_AEC_TRUST;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    _resetVoiceActivityForTests();
    vi.restoreAllMocks();
  });

  it('ne doit pas armer ni jouer un backchannel sur un écho partiel de la voix de Lisa contenant son nom', async () => {
    const bus = getGlobalEventBus();
    const cuesPlayed: ConversationCueRequest[] = [];
    let currentTime = 100_000;

    // Lisa vient de prononcer une longue phrase dans la pièce contenant son nom
    const lisaSpokenPhrase = 'Bonjour Patrice, je suis Lisa et je suis là pour t aider sur ton projet.';
    noteSpokenText(lisaSpokenPhrase, currentTime);
    beginSpeaking(currentTime);
    currentTime = 102_000;
    endSpeaking(currentTime); // Fin de parole à 102s, queue d'écho jusqu'à 103.2s

    // À t = 103.5s (hors queue demi-duplex), le micro capte un écho fragmentaire de 4 mots : "Lisa et je suis"
    // Cet extrait contient le nom "Lisa", mais ne couvre que 4/14 mots (28.5% < seuil 60% SENSE1/SENSE3)
    currentTime = 103_500;

    const decider = createResponseDecider({
      robotName: 'Lisa',
      now: () => currentTime,
    });

    const unwire = wireSpeechReaction({
      now: () => currentTime,
      shouldRespond: (text) => decider.decide(text),
      onConversationCue: async (cue) => {
        cuesPlayed.push(cue);
        return true;
      },
      onHeard: async () => {
        // Simule un délai de réflexion LLM de 500ms
        await new Promise((resolve) => setTimeout(resolve, 300));
      },
    });

    try {
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'audio',
          kind: 'transcript_final',
          payload: {
            text: 'Lisa et je suis',
            startedAtMs: 103_200,
            endedAtMs: 103_500,
            aecActive: false,
          },
        },
      });

      // Attendre 200ms pour laisser s'écouler le délai d'armement du backchannel (120ms)
      await new Promise((resolve) => setTimeout(resolve, 200));

      // GARANTIE DE NUIT SENSE1/SENSE3 ATTENDUE :
      // Aucun backchannel ne doit être émis sur un écho du haut-parleur.
      //
      // TROU PROUVÉ :
      // 1. classifyRecentVoiceEcho calcule 4/14 = 28% < 60% -> classé 'distinct' (non filtré).
      // 2. isVocativeAddress("Lisa et je suis", "Lisa") est true -> decisionReason = 'addressed'.
      // 3. sensoryBackchannelEnabled && decisionReason === 'addressed' arme armBackchannel().
      // 4. À 120ms, un cue "Mhm." ou "Oui." est joué sur l'écho de Lisa !
      expect(cuesPlayed).toEqual([]);
    } finally {
      unwire();
    }
  });

  it('ne doit pas jouer de backchannel pendant que Lisa est déjà en train de parler suite à un barge-in', async () => {
    const bus = getGlobalEventBus();
    const cuesPlayed: ConversationCueRequest[] = [];
    const nowMs = 100_000;

    // Lisa est en train de parler (haut-parleur actif)
    beginSpeaking(nowMs);
    process.env.CODEBUDDY_SENSORY_BARGE_IN = 'true';

    const decider = createResponseDecider({
      robotName: 'Lisa',
      now: () => nowMs,
    });

    const unwire = wireSpeechReaction({
      now: () => nowMs,
      shouldRespond: (text) => decider.decide(text),
      onConversationCue: async (cue) => {
        cuesPlayed.push(cue);
        return true;
      },
      onBargeInStart: () => {},
      onHeard: async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      },
    });

    try {
      // Événement speech_start avec durée >= 250ms -> déclenche le barge-in
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'audio',
          kind: 'speech_start',
          payload: {
            startedAtMs: nowMs,
            audioMs: 300,
            aecActive: false,
          },
        },
      });

      // Le final arrive, avec un adressage "Lisa écoute-moi"
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'audio',
          kind: 'transcript_final',
          payload: {
            text: 'Lisa écoute-moi',
            startedAtMs: nowMs,
            endedAtMs: nowMs + 300,
            audioMs: 300,
            aecActive: false,
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // GARANTIE DE NUIT ATTENDUE :
      // Lisa ne doit pas jouer de backchannel par-dessus sa propre parole (demi-duplex).
      // TROU PROUVÉ :
      // Le barge-in contourne la garde isSpeaking(t), le tour est admis,
      // et conversationCues.armBackchannel() déclenche "Mhm." pendant que la bouche parle encore !
      expect(cuesPlayed).toEqual([]);
    } finally {
      endSpeaking(nowMs + 1000);
      unwire();
    }
  });
});
