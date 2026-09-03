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

describe('Mission SENSE6 — Trou 7 : Réouverture de la boucle d\'auto-dialogue par la combinaison des briques opt-in', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    _resetVoiceActivityForTests();
    // Activation de l'ensemble des variables opt-in de la mission
    process.env.CODEBUDDY_SENSORY_BACKCHANNEL = 'true';
    process.env.CODEBUDDY_SENSORY_REPAIR = 'true';
    process.env.CODEBUDDY_SENSORY_BARGE_IN = 'true';
    process.env.CODEBUDDY_SENSORY_SHORT_FIRST = 'true';
    process.env.CODEBUDDY_SENSORY_TURN_DETECTOR = 'livekit';
    process.env.CODEBUDDY_TTS_TWO_SPEED = 'true';
    process.env.BUDDY_SENSE_END_SILENCE_MS = '350';
    process.env.CODEBUDDY_SENSORY_RESPONSE_POLICY = 'contextual';
    delete process.env.CODEBUDDY_SENSORY_AEC_TRUST; // AEC non approuvé (règle stricte SENSE1)
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    _resetVoiceActivityForTests();
    vi.restoreAllMocks();
  });

  it('ne doit pas laisser une fuite acoustique du haut-parleur s\'auto-interrompre et déclencher une réplique sur sa propre voix', async () => {
    const bus = getGlobalEventBus();
    const actionsTriggeredOnOwnVoice: string[] = [];
    const nowMs = 100_000;

    const decider = createResponseDecider({
      robotName: 'Lisa',
      now: () => nowMs,
    });

    const unwire = wireSpeechReaction({
      now: () => nowMs,
      shouldRespond: (text) => decider.decide(text),
      getAttentionSnapshot: () => decider.snapshot(),
      isAddressed: (text) => decider.isAddressed(text),
      onConversationCue: async (cue) => {
        actionsTriggeredOnOwnVoice.push(`cue:${cue.kind}`);
        return true;
      },
      onBargeInStart: () => {
        actionsTriggeredOnOwnVoice.push('barge-in-start');
      },
      onHeard: async (text) => {
        actionsTriggeredOnOwnVoice.push(`heard:${text}`);
        // Simule la durée de la réponse vocale de Lisa (2 secondes)
        await new Promise((resolve) => setTimeout(resolve, 2000));
      },
    });

    try {
      // 1. Lisa répond à un premier tour légitime (inFlight = true, parole en cours)
      const initialSpokenPhrase = 'Bonjour Patrice, je suis Lisa, je suis prête pour tes questions.';
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'audio',
          kind: 'transcript_final',
          payload: {
            text: 'Lisa, es-tu prête ?',
            startedAtMs: nowMs - 1000,
            endedAtMs: nowMs,
            aecActive: false,
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      noteSpokenText(initialSpokenPhrase, nowMs);
      beginSpeaking(nowMs);
      // Réinitialiser le journal : nous voulons capturer UNIQUEMENT les réactions provoquées par sa propre voix
      actionsTriggeredOnOwnVoice.length = 0;

      // 2. Le micro physique capte le son du haut-parleur de Lisa dans la pièce pendant qu'elle parle
      // Le composant audio émet speech_start avec une durée audio de 300 ms
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'audio',
          kind: 'speech_start',
          payload: {
            startedAtMs: nowMs + 100,
            audioMs: 300,
            rms: 0.04,
            noiseFloorRms: 0.01,
            aecActive: false,
          },
        },
      });

      // 3. Le STT convertit ce résidu acoustique en un fragment de 2 mots issu de sa propre voix : "Lisa prête"
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'audio',
          kind: 'transcript_final',
          payload: {
            text: 'Lisa prête',
            startedAtMs: nowMs + 100,
            endedAtMs: nowMs + 400,
            audioMs: 300,
            aecActive: false,
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      // GARANTIE DE NUIT SENSE1/SENSE3 ATTENDUE :
      // La protection demi-duplex et le filtre d'écho doivent ABSOLUMENT empêcher le robot de :
      // 1. S'auto-interrompre sur sa propre voix (aucun barge-in acoustique de sa propre parole).
      // 2. Réagir à sa propre voix (aucun cue de réparation "Pardon ?" ni aucun onHeard).
      //
      // TROU PROUVÉ :
      // 1. speech_start (audioMs >= 250) déclenche shouldTriggerVoiceBargeInOnSpeechStart -> onBargeInStart est appelé !
      // 2. bargedSpeechTurnId est positionné, ce qui contourne la garde demi-duplex isSpeaking() à la ligne 1629 de speech-reaction.ts.
      // 3. L'écho fragmentaire "je suis" (2 mots) ne couvre que 2/10 = 20% < 60% de la référence -> classifyRecentVoiceEcho le déclare 'distinct'.
      // 4. shouldRepairTranscript("je suis") étant true (<= 2 mots), conversationCues.playRepair() est déclenché !
      // Lisa s'auto-interrompt et se répond à elle-même « Pardon, tu disais ? », relançant la boucle d'auto-dialogue infinie !
      expect(actionsTriggeredOnOwnVoice).toEqual([]);
    } finally {
      endSpeaking(nowMs + 2000);
      unwire();
    }
  });
});
