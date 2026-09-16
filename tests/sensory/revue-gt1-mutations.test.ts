import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
import { HomeModeStore } from '../../src/life-rhythm/home-mode-store.js';
import { CompanionConductor } from '../../src/companion/orchestrator.js';

describe('Mission GT2 — contrats anti-régression des 5 gardes de la nuit', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(process.cwd(), '.gt2-mutation-'));
    _resetVoiceActivityForTests();
  });

  afterEach(async () => {
    _resetVoiceActivityForTests();
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('test(mutation): demi-duplex — conserve une réponse humaine distincte dans la queue d’écho', async () => {
    // Après la fin normale de la parole robot, la queue d'écho reste active. La
    // transcription doit néanmoins être classifiée : seul l'écho est supprimé.
    let clock = 1_000;
    beginSpeaking(1_000);
    noteSpokenText('Je viens de terminer ma réponse.', 1_400);

    const unwire = wireSpeechReaction({
      debounceMs: 0,
      cwd: tmpDir,
      now: () => clock,
    });

    try {
      // Le robot termine de parler à t=1500. La queue d'écho est encore active à t=1700.
      endSpeaking(1_500);

      // L'utilisateur répond à t=1600 ("Oui tout à fait"). La transcription finale arrive à t=1700.
      clock = 1_700;
      const bus = getGlobalEventBus();
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'audio',
          kind: 'transcript_final',
          payload: {
            text: 'Oui tout à fait',
            startedAtMs: 1_600,
            audioMs: 100,
          },
        },
      });

      const perceptPath = path.join(tmpDir, '.codebuddy', 'companion', 'percepts.jsonl');
      await vi.waitFor(async () => {
        const percepts = await readFile(perceptPath, 'utf8');
        expect(percepts).toContain('Oui tout à fait');
        expect(percepts).not.toContain('playbackCaptureSuppressed');
      });
    } finally {
      unwire();
    }
  });

  it('test(mutation): filtre d’écho — classe un fragment composé uniquement de tokens robot comme écho', () => {
    // Une capture acoustique tronquée peut couvrir moins de 60 % de la longue
    // phrase robot tout en étant intégralement constituée de ses mots.
    const now = 10_000;
    noteSpokenText("Je vais verifier l'etat du serveur et relancer tous les tests unitaires", now);

    // Écho partiel capté : "relancer tous les tests unitaires" (5 tokens, 100% de provenance robot)
    const classification = classifyRecentVoiceEcho('relancer tous les tests unitaires', now + 1_000);

    expect(classification).toBe('echo');
  });

  it('test(mutation): fenêtre d’engagement — accepte une réponse naturelle brève', async () => {
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

    expect(r2).toEqual({ respond: true, reason: 'engaged' });
  });

  it('test(mutation): politique Maison — autorise l’arrivée physique quand le mode est encore away', () => {
    const decision = evaluateHomeInteractionPolicy({
      mode: 'away',
      dayKind: 'workday',
      surface: 'arrival',
    });

    expect(decision.allowed).toBe(true);
  });

  it('test(mutation): hystérésis de présence — accueille une identité distincte après le départ d’un tiers', async () => {
    process.env.CODEBUDDY_SENSORY_GREET = 'true';
    process.env.CODEBUDDY_USER_NAME = 'Patrice';
    let clock = 10_000;
    const bus = getGlobalEventBus();
    const arrivalStatePath = path.join(tmpDir, 'arrival-state.json');
    const homeModeStore = new HomeModeStore({ filePath: path.join(tmpDir, 'home-mode.json') });
    const conductor = new CompanionConductor(1_000, () => clock);

    const unwire = wireSemanticVisionReaction({
      greet: async () => {},
      now: () => clock,
      greetCooldownMs: 1_000,
      arrivalStatePath,
      homeModeStore,
      conductor,
      cwd: tmpDir,
    });

    try {
      // 1. Patrice is identified before leaving, so the loss has a concrete identity.
      bus.emit('sensory:perception', {
        source: 'test',
        metadata: {
          modality: 'vision',
          kind: 'person_identified',
          payload: { name: 'Patrice', similarity: 0.99 },
        },
      });
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

      await vi.waitFor(async () => {
        const arrivalState = JSON.parse(await readFile(arrivalStatePath, 'utf8')) as {
          lastSeenAt?: number;
          recentSpoken?: string[];
        };
        expect(arrivalState.lastSeenAt).toBe(40_000);
        expect(arrivalState.recentSpoken?.length).toBe(1);
      }, { timeout: 5_000 });
    } finally {
      unwire();
      delete process.env.CODEBUDDY_SENSORY_GREET;
      delete process.env.CODEBUDDY_USER_NAME;
    }
  });
});
