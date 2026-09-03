import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  _resetVoiceActivityForTests,
  beginSpeaking,
  endSpeaking,
  noteSpokenText,
  classifyRecentVoiceEcho,
} from '../../src/sensory/voice-activity.js';
import { wireSpeechReaction } from '../../src/sensory/speech-reaction.js';
import { createResponseDecider } from '../../src/sensory/respond-decider.js';
import { evaluateHomeInteractionPolicy } from '../../src/companion/home-interaction-policy.js';
import { wireSemanticVisionReaction } from '../../src/sensory/semantic-vision-reaction.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

describe('Mission GT1 — Preuves de trous de couverture sur les 5 gardes de la nuit', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cb-gt1-mutation-'));
    _resetVoiceActivityForTests();
  });

  afterEach(async () => {
    _resetVoiceActivityForTests();
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('test(mutation): demi-duplex — une réponse humaine rapide pendant la queue d’écho (tail) est supprimée', async () => {
    // Garde Demi-duplex :
    // Lorsque le robot finit de parler (endSpeaking), une queue de garde TAIL_MS (500ms) est armée.
    // Si l'humain répond rapidement (ex. 100ms après la fin de la parole du robot),
    // son énoncé arrive dans startSpeechJob alors que isSpeaking(t) est encore true (dans les 500ms).
    // Comme bargedIn est false (l'audio est terminé normalement, pas interrompu),
    // le demi-duplex jette aveuglément la réponse humaine sans vérifier s'il s'agit d'une parole distincte.
    const heard: string[] = [];
    let clock = 1_000;
    beginSpeaking(1_000);

    const unwire = wireSpeechReaction({
      debounceMs: 0,
      cwd: tmpDir,
      now: () => clock,
      onHeard: async (text) => {
        heard.push(text);
      },
    });

    try {
      // Le robot termine de parler à t=1500. La queue d'écho le protège jusqu'à t=2000.
      endSpeaking(1_500);

      // L'utilisateur répond à t=1600 ("Oui tout à fait"). La transcription finale arrive à t=1700.
      clock = 1_700;
      const bus = getGlobalEventBus();
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'hearing',
          kind: 'speech_final',
          payload: {
            text: 'Oui tout à fait',
            startedAtMs: 1_600,
            audioMs: 100,
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Trou prouvé : la réponse humaine dans la queue d'écho DOIT être entendue,
      // mais le demi-duplex actuel l'a jetée dans cleanupSpeechJob car isSpeaking(1700) === true.
      expect(heard).toContain('Oui tout à fait');
    } finally {
      unwire();
    }
  });

  it('test(mutation): filtre d’écho — un écho partiel dont 100% des tokens proviennent du robot est classé distinct', () => {
    // Garde Filtre d'écho :
    // classifyRecentVoiceEcho calcule la couverture sur reference.tokens.length (longueur de la phrase robot) :
    //   overlap / reference.tokens.length >= OWN_ECHO_MIN_COVERAGE (0.6)
    // Si le robot prononce une phrase longue et que le micro capte un écho acoustique partiel/tronqué,
    // tous les mots captés viennent du robot (100%), mais le ratio sur la phrase longue est < 0.6.
    // L'écho est donc classé 'distinct' au lieu de 'echo', provoquant une boucle où le robot se répond à lui-même.
    const now = 10_000;
    noteSpokenText("Je vais verifier l'etat du serveur et relancer tous les tests unitaires", now);

    // Écho partiel capté : "relancer tous les tests unitaires" (5 tokens, 100% de provenance robot)
    const classification = classifyRecentVoiceEcho('relancer tous les tests unitaires', now + 1_000);

    // Trou prouvé : un écho pur à 100% de tokens robot DOIT être détecté comme 'echo'.
    // Le code actuel retourne 'distinct' car 5 tokens / 11 tokens robot = 45% < 60%.
    expect(classification).toBe('echo');
  });

  it('test(mutation): fenêtre d’engagement — une réponse naturelle « oui » ou « d’accord » est étouffée en ambient-in-window', async () => {
    // Garde Fenêtre d'engagement :
    // Dans une conversation active, si le robot pose une question et que l'utilisateur répond
    // simplement "oui" ou "d'accord", isDirectedFollowUp retourne false car CONTINUATION regex
    // (/^(et|alors|ok|oui|non|d accord...)/) court-circuite et rejette l'énoncé sans impératif.
    // Le décideur retourne alors staySilent('ambient-in-window') et le robot ignore la réponse humaine !
    let clock = 1_000;
    const decider = createResponseDecider({
      robotName: 'Lisa',
      engageWindowMs: 60_000,
      now: () => clock,
    });

    // 1. L'humain interpelle Lisa : la fenêtre s'ouvre.
    const r1 = await decider.decide('Lisa, tu peux m’aider ?');
    expect(r1.respond).toBe(true);

    // 2. Lisa ayant répondu (posant une question), l'utilisateur répond "oui" 5s plus tard.
    clock = 6_000;
    const r2 = await decider.decide('oui');

    // Trou prouvé : dans la fenêtre d'engagement ouverte, un "oui" direct DOIT déclencher une réponse.
    // Le code actuel retourne { respond: false, reason: 'ambient-in-window' }.
    expect(r2.respond).toBe(true);
  });

  it('test(mutation): politique Maison — le retour au domicile en mode away bloque l’accueil d’arrivée', () => {
    // Garde Politique Maison :
    // En mode 'away' (domicile inoccupé), la politique stipule :
    //   if (input.mode === 'away' && input.surface !== 'proactive-remote') return { allowed: false };
    // Lors d'un retour au domicile, la surface est 'arrival' et le mode est encore 'away'.
    // evaluateHomeInteractionPolicy bloque l'accueil vocal (allowed: false),
    // de sorte que l'utilisateur n'est JAMAIS accueilli lorsqu'il rentre chez lui !
    const decision = evaluateHomeInteractionPolicy({
      mode: 'away',
      dayKind: 'workday',
      surface: 'arrival',
    });

    // Trou prouvé : le retour physique à la maison (arrival) DOIT être autorisé
    // pour permettre à la caméra d'accueillir la personne arrivante.
    // Le code actuel retourne { allowed: false, reason: 'Away mode permits a bounded remote note...' }.
    expect(decision.allowed).toBe(true);
  });

  it('test(mutation): hystérésis de présence — l’arrivée d’une personne identifiée est bloquée par le départ d’un tiers', async () => {
    // Garde Hystérésis de présence :
    // semantic-vision-reaction maintient un timestamp lastLossAt global et aveugle à l'identité.
    // Si Patrice quitte la pièce (person_lost), puis qu'Alice arrive 30 secondes plus tard
    // (person_entered puis person_identified), le test enteredAt - lastLossAt < regreetMinMs (5 min)
    // active suppressCurrentArrivalGreeting = true et étouffe l'accueil d'Alice !
    process.env.CODEBUDDY_SENSORY_GREET = 'true';
    const greeted: string[] = [];
    let clock = 10_000;
    const bus = getGlobalEventBus();

    const unwire = wireSemanticVisionReaction({
      greet: async (text) => {
        greeted.push(text);
      },
      now: () => clock,
      greetCooldownMs: 1_000,
    });

    try {
      // 1. Patrice quitte la pièce à t=10_000
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'vision',
          kind: 'person_lost',
        },
      });

      // 2. Alice entre à t=40_000 (30s plus tard, sous le cooldown de 5 minutes)
      clock = 40_000;
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'vision',
          kind: 'person_entered',
          payload: { identityPending: true },
        },
      });

      // 3. Alice est formellement identifiée par le modèle visage
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'vision',
          kind: 'person_identified',
          payload: { name: 'Alice', similarity: 0.95 },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Trou prouvé : une personne nouvelle et distincte DOIT être accueillie.
      // Le code actuel l'étouffe car lastLossAt global la traite comme un clignotement de Patrice.
      expect(greeted.length).toBeGreaterThan(0);
    } finally {
      unwire();
      delete process.env.CODEBUDDY_SENSORY_GREET;
    }
  });
});
