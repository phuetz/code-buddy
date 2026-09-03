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

describe('Mission SENSE6 — Trou 2 : Réparation communicative « Pardon ? » déclenchée par sa propre voix', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    _resetVoiceActivityForTests();
    process.env.CODEBUDDY_SENSORY_REPAIR = 'true';
    process.env.CODEBUDDY_SENSORY_RESPONSE_POLICY = 'contextual';
    delete process.env.CODEBUDDY_SENSORY_AEC_TRUST;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    _resetVoiceActivityForTests();
    vi.restoreAllMocks();
  });

  it('ne doit pas déclencher « Pardon ? » sur un STT vide issu du résidu acoustique de la voix du robot', async () => {
    const bus = getGlobalEventBus();
    const cuesPlayed: ConversationCueRequest[] = [];
    let currentTime = 100_000;

    // Lisa a répondu et ouvert la fenêtre d'attention engagée
    const decider = createResponseDecider({
      robotName: 'Lisa',
      now: () => currentTime,
    });
    decider.markEngaged('addressed');

    // Lisa prononce sa réplique
    const lisaSpeech = 'Bonjour Patrice, je suis prête pour tes questions.';
    noteSpokenText(lisaSpeech, currentTime);
    beginSpeaking(currentTime);
    currentTime = 102_000;
    endSpeaking(currentTime); // 102s, queue d'écho jusqu'à 103.2s

    // À t = 103.5s, le micro capte un résidu silencieux ou inaudible du haut-parleur dans la pièce.
    // Le STT renvoie un texte vide ("").
    currentTime = 103_500;

    const unwire = wireSpeechReaction({
      now: () => currentTime,
      shouldRespond: (text) => decider.decide(text),
      getAttentionSnapshot: () => decider.snapshot(),
      isAddressed: (text) => decider.isAddressed(text),
      onConversationCue: async (cue) => {
        cuesPlayed.push(cue);
        return true;
      },
      onHeard: async () => {},
    });

    try {
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'audio',
          kind: 'transcript_final',
          payload: {
            text: '',
            startedAtMs: 103_200,
            endedAtMs: 103_500,
            aecActive: false,
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // GARANTIE DE NUIT SENSE1/SENSE3 ATTENDUE :
      // Le résidu acoustique ne doit pas faire parler Lisa ("Pardon, tu disais ?").
      //
      // TROU PROUVÉ :
      // Dans speech-reaction.ts (lignes 1795-1811) :
      // 1. if (!text) intervient AVANT classifyRecentVoiceEcho (l'écho n'est jamais vérifié sur texte vide).
      // 2. repairAddressed ||= attention?.engaged === true && attention.source === 'addressed' est vrai.
      // 3. conversationCues.playRepair(turnId) est exécuté et joue 'Pardon, tu disais ?' !
      expect(cuesPlayed).toEqual([]);
    } finally {
      unwire();
    }
  });

  it('ne doit pas déclencher « Pardon ? » sur un fragment court de 2 mots issu d\'un écho de Lisa', async () => {
    const bus = getGlobalEventBus();
    const cuesPlayed: ConversationCueRequest[] = [];
    let currentTime = 100_000;

    // Lisa prononce une phrase qui contient réellement le futur fragment d'écho.
    const lisaSpeech = 'Lisa écoute et je suis là, attentive.';
    noteSpokenText(lisaSpeech, currentTime);
    beginSpeaking(currentTime);
    currentTime = 102_000;
    endSpeaking(currentTime);

    // À t = 103.5s, le fragment d'écho de 2 mots "Lisa écoute" est capté.
    currentTime = 103_500;

    const decider = createResponseDecider({
      robotName: 'Lisa',
      now: () => currentTime,
    });

    const unwire = wireSpeechReaction({
      now: () => currentTime,
      shouldRespond: (text) => decider.decide(text),
      getAttentionSnapshot: () => decider.snapshot(),
      isAddressed: (text) => decider.isAddressed(text),
      onConversationCue: async (cue) => {
        cuesPlayed.push(cue);
        return true;
      },
      onHeard: async () => {},
    });

    try {
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'audio',
          kind: 'transcript_final',
          payload: {
            text: 'Lisa écoute',
            startedAtMs: 103_200,
            endedAtMs: 103_500,
            aecActive: false,
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // GARANTIE DE NUIT SENSE1/SENSE3 ATTENDUE :
      // Aucun réflexe de réparation ne doit être armé sur un fragment de sa propre voix.
      //
      // TROU PROUVÉ :
      // 1. "Lisa écoute" (2 mots) est entièrement contenu dans la phrase récente,
      //    mais reste sous le seuil historique de couverture globale.
      // 2. Le texte contient "Lisa" -> decisionReason = 'addressed'.
      // 3. shouldRepairTranscript("Lisa écoute") est vrai car wordCount <= 2.
      // 4. conversationCues.playRepair() est appelé et Lisa dit « Pardon, tu disais ? » à son propre écho !
      expect(cuesPlayed).toEqual([]);
    } finally {
      unwire();
    }
  });
});
