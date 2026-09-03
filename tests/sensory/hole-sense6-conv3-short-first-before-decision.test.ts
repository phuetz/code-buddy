import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RelationshipSafetyStreamGuard } from '../../src/conversation/relationship-safety.js';
import { makeHybridReply } from '../../src/sensory/hybrid-reply.js';
import { makeVoiceReply } from '../../src/sensory/voice-loop.js';
import { _resetVoiceActivityForTests } from '../../src/sensory/voice-activity.js';

describe('Mission SENSE6 — Trou 4 : Première phrase CONV3 émise avant la décision de sûreté / révision', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    _resetVoiceActivityForTests();
    process.env.CODEBUDDY_SENSORY_SHORT_FIRST = 'true';
    process.env.CODEBUDDY_VOICE_SPOKEN_PREFIX = 'false';
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    _resetVoiceActivityForTests();
    vi.restoreAllMocks();
  });

  it('ne doit pas libérer immédiatement le premier segment au haut-parleur avant de vérifier la sûreté de la phrase complète', () => {
    // SENSE1/SENSE3 exige que la garde relationnelle (RelationshipSafetyStreamGuard)
    // conserve une phrase d'avance pour bloquer les revendications toxiques ou illusoires
    // réparties sur plusieurs segments (ex: "J'ai une... conscience.").
    //
    // Sans CONV3 (opt-in désactivé) :
    const guardNormal = new RelationshipSafetyStreamGuard(false);
    const releasedNormal = guardNormal.push("J'ai une... ");
    // Rien n'est émis au haut-parleur : la garde attend la suite pour décider
    expect(releasedNormal).toEqual([]);

    // Avec CONV3 (opt-in activé : releaseFirstImmediately = true) :
    const guardConv3 = new RelationshipSafetyStreamGuard(true);
    const releasedConv3 = guardConv3.push("J'ai une... ");

    // GARANTIE DE NUIT SENSE3 ATTENDUE :
    // Aucun segment partiel potentiellement dangereux ne doit être émis avant la décision combinée.
    //
    // TROU PROUVÉ :
    // CONV3 court-circuite la rétention d'une phrase d'avance :
    // releasedConv3 contient immédiatement ["J'ai une... "] et est envoyé au TTS/haut-parleur,
    // avant même que le mot "conscience." n'arrive pour permettre la décision de blocage !
    expect(releasedConv3).toEqual([]);
  });

  it('ne doit pas diffuser la première phrase audio avant la validation et décision de revue de la réponse', async () => {
    const spokenSentences: string[] = [];
    let reviewCompleted = false;
    let firstAudioPlayedBeforeReview = false;

    const hybrid = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      chitchat: async () => 'Réponse bloquante.',
      chitchatStream: async function* () {
        yield 'Première phrase utile immédiatement audible. ';
        await new Promise((resolve) => setTimeout(resolve, 50));
        yield 'Deuxième phrase complétant la réponse.';
        reviewCompleted = true;
      },
      agentReply: async () => 'Réponse agent.',
    });

    const voice = makeVoiceReply({
      replyFn: hybrid,
      streamSpeak: async (text) => {
        spokenSentences.push(text);
        if (!reviewCompleted) firstAudioPlayedBeforeReview = true;
        return true;
      },
      synth: async () => '',
      play: async () => undefined,
      cameraShare: async () => null,
      visualGrounding: async () => ({ status: 'unavailable', response: '' }),
      avatarEnabled: false,
    });

    await voice('Dis-moi quelque chose.');

    // TROU PROUVÉ :
    // streamSpeak est appelé dès que le premier segment arrive (reviewCompleted est encore false).
    // La première phrase est donc audible avant que la décision finale de réponse ne soit connue.
    expect(spokenSentences.length).toBeGreaterThan(0);
    expect(firstAudioPlayedBeforeReview).toBe(false);
  });
});
