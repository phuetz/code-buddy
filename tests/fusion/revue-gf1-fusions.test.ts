import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  noteSpokenText,
  classifyRecentVoiceEcho,
  _resetVoiceActivityForTests,
  beginSpeaking,
  interruptSpeaking,
} from '../../src/sensory/voice-activity.js';
import {
  wireSpeechReaction,
  shouldTriggerVoiceBargeInOnSpeechStart,
} from '../../src/sensory/speech-reaction.js';
import { CodeBuddyAgent } from '../../src/agent/codebuddy-agent.js';
import { inferCostProvider } from '../../src/analytics/cost-report.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Mission GF1 — Tests rouges des régressions de fusion du 03/09/2026', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    _resetVoiceActivityForTests();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    _resetVoiceActivityForTests();
    vi.restoreAllMocks();
  });

  describe('1. Collision SENSE7 × GT2 : faux positif écho sur réponse humaine courte', () => {
    it('ne doit pas classer une réponse humaine normale ("oui", "non", "merci") comme un écho du robot', () => {
      // Le robot prononce une phrase contenant des mots courants
      noteSpokenText('Bonjour, veux-tu continuer ? Dis oui ou non, merci.', 1_000);

      // L’humain répond 500 ms plus tard : "oui"
      // TROU PROUVÉ : GT2 a ajouté transcriptTokens.every(token => referenceTokens.has(token))
      // Comme "oui" fait partie des tokens du robot, transcriptIsRobotFragment = true.
      // SENSE7 et GT2 coexistent via un `||`, donc classifyRecentVoiceEcho retourne 'echo'
      // et la réponse humaine est silencieusement éliminée par speech-reaction !
      // Le titre historique annonçait trois réponses mais ne testait que « oui ».
      // Toutes les réponses fermées usuelles doivent rester distinctes, tandis que
      // les tests SENSE7/GT2 voisins continuent d'exiger le rejet des vrais fragments.
      for (const reply of ['oui', 'non', 'merci']) {
        expect(classifyRecentVoiceEcho(reply, 1_500), reply).toBe('distinct');
      }
    });
  });

  describe('2. Collision SENSE1 × CONV2 : réouverture de la garde demi-duplex sans AEC de confiance', () => {
    it('le barge-in acoustique ne doit pas réouvrir la garde demi-duplex si AEC n’est pas explicitement de confiance', async () => {
      const bus = getGlobalEventBus();
      const heard: string[] = [];
      let clock = 800;
      let firstTurnStarted = false;
      let releaseFirstTurn!: () => void;
      const holdFirstTurn = new Promise<void>((resolve) => {
        releaseFirstTurn = resolve;
      });

      // Barge-in activé, mais AEC NON déclarée de confiance
      const testEnv = {
        ...process.env,
        CODEBUDDY_SENSORY_BARGE_IN: 'true',
        // CODEBUDDY_SENSORY_AEC_TRUST n'est PAS mis à 'true'
      };
      delete testEnv.CODEBUDDY_SENSORY_AEC_TRUST;

      const unwire = wireSpeechReaction({
        env: testEnv,
        debounceMs: 0,
        incompleteTurnHoldMs: 0,
        now: () => clock,
        onHeard: async (text) => {
          if (!firstTurnStarted) {
            firstTurnStarted = true;
            await holdFirstTurn;
          } else {
            heard.push(text);
          }
        },
      });

      try {
        // Un premier tour réellement en vol est indispensable : le branchement
        // speech_start litigieux est protégé par `inFlight`.
        bus.emit('sensory:perception', {
          source: 'test',
          metadata: {
            modality: 'audio',
            kind: 'transcript_final',
            receivedAt: clock,
            payload: { text: 'Lisa, commence une réponse.', startedAtMs: clock },
          },
        });
        await vi.waitFor(() => expect(firstTurnStarted).toBe(true));

        clock = 1_000;
        beginSpeaking(clock);

        // Un son fort arrive pendant la parole avec aecActive: true (non de confiance)
        // TROU PROUVÉ : shouldTriggerAcousticBargeIn se déclenche sur aecActive seul,
        // assigne bargedSpeechTurnId, et startSpeechJob court-circuite la garde demi-duplex !
        clock = 1_200;
        bus.emit('sensory:perception', {
          source: 'test',
          metadata: {
            modality: 'audio',
            kind: 'speech_start',
            receivedAt: clock,
            payload: {
              startedAtMs: clock,
              audioMs: 300,
              aecActive: true,
              rms: 0.05,
              noiseFloorRms: 0.01,
            },
          },
        });

        // La transcription arrive pendant que le robot parle toujours
        clock = 1_300;
        bus.emit('sensory:perception', {
          source: 'test',
          metadata: {
            modality: 'audio',
            kind: 'transcript_final',
            receivedAt: clock,
            payload: {
              text: 'Bruit de retour haut-parleur',
              startedAtMs: 1_200,
              aecActive: true,
            },
          },
        });

        releaseFirstTurn();
        await new Promise((resolve) => setTimeout(resolve, 80));

        // SENSE1 exige que le micro reste fermé (demi-duplex) tant que l'AEC n'est pas de confiance.
        // Aucune phrase ne doit être entendue ni traitée.
        expect(heard).toEqual([]);
      } finally {
        releaseFirstTurn();
        unwire();
        interruptSpeaking(clock);
      }
    });

    it('shouldTriggerVoiceBargeInOnSpeechStart ne doit pas déclencher de barge-in si AEC est non-approuvée (violation invariant SENSE1)', () => {
      const payload = {
        aecActive: true,
        audioMs: 300,
        rms: 0.05,
        noiseFloorRms: 0.01,
      };
      // Selon l'invariant SENSE1, aecActive seul sans CODEBUDDY_SENSORY_AEC_TRUST='true'
      // ne doit JAMAIS autoriser un contournement de barge-in ou demi-duplex.
      // TROU PROUVÉ : shouldTriggerVoiceBargeInOnSpeechStart vérifie uniquement payload.aecActive !== true
      // et ignore totalement isSensoryAecTrusted(..., env). Il retourne true sans trust !
      const res = shouldTriggerVoiceBargeInOnSpeechStart(payload, {
        CODEBUDDY_SENSORY_BARGE_IN: 'true',
        CODEBUDDY_SENSORY_AEC_TRUST: 'false',
      });
      expect(res).toBe(false);
    });

    it('le barge-in sur speech_start ne doit pas couper sur un transitoire < 250ms (court-circuit de 6de905980)', async () => {
      // 6de905980 a créé shouldTriggerVoiceBargeInOnSpeechStart pour exiger >= 250ms de parole soutenue
      const transientPayload = {
        aecActive: true,
        audioMs: 50, // Moins de 250 ms
        rms: 0.05,
        noiseFloorRms: 0.01,
      };

      // shouldTriggerVoiceBargeInOnSpeechStart refuse le transitoire court (< 250ms)
      expect(shouldTriggerVoiceBargeInOnSpeechStart(transientPayload, {
        CODEBUDDY_SENSORY_BARGE_IN: 'true',
        CODEBUDDY_SENSORY_AEC_TRUST: 'true',
      })).toBe(false);

      // TROU PROUVÉ : dans speech-reaction.ts ligne 2285-2286, l'orchestrateur a gardé :
      // shouldTriggerVoiceBargeInOnSpeechStart(payload, env) || shouldTriggerAcousticBargeIn(payload, speechStartedAtMs)
      // Or shouldTriggerAcousticBargeIn retourne true immédiatement (lignes 1566-1568)
      // sans vérifier la durée minimale de 250ms, annulant la protection anti-bruit !
      const bus = getGlobalEventBus();
      const onBargeInStart = vi.fn();
      let clock = 800;
      let firstTurnStarted = false;
      let releaseFirstTurn!: () => void;
      const holdFirstTurn = new Promise<void>((resolve) => {
        releaseFirstTurn = resolve;
      });
      const unwire = wireSpeechReaction({
        debounceMs: 0,
        incompleteTurnHoldMs: 0,
        now: () => clock,
        env: {
          CODEBUDDY_SENSORY_BARGE_IN: 'true',
          CODEBUDDY_SENSORY_AEC_TRUST: 'true',
        },
        onHeard: async () => {
          firstTurnStarted = true;
          await holdFirstTurn;
        },
        onBargeInStart,
      });

      try {
        bus.emit('sensory:perception', {
          source: 'test',
          metadata: {
            modality: 'audio',
            kind: 'transcript_final',
            receivedAt: clock,
            payload: { text: 'Lisa, commence une réponse.', startedAtMs: clock },
          },
        });
        await vi.waitFor(() => expect(firstTurnStarted).toBe(true));
        clock = 1_000;
        beginSpeaking(clock);
        clock = 1_050;
        bus.emit('sensory:perception', {
          source: 'test',
          metadata: {
            modality: 'audio',
            kind: 'speech_start',
            receivedAt: clock,
            payload: { ...transientPayload, startedAtMs: clock },
          },
        });

        expect(onBargeInStart).not.toHaveBeenCalled();
      } finally {
        releaseFirstTurn();
        unwire();
        interruptSpeaking(clock);
      }
    });
  });

  describe('3. Régression GK28 : CodeBuddyAgent.saveCurrentSession() et inferCostProvider', () => {
    it('inferCostProvider ne doit pas lever TypeError si model est undefined ou vide', () => {
      // TROU PROUVÉ : une valeur runtime absente fait model.trim() -> TypeError.
      expect(() => inferCostProvider(undefined as unknown as string)).not.toThrow();
    });

    it('saveCurrentSession ne doit pas lever TypeError si costTracker n a pas getSessionUsage (mocks de test unitaires)', () => {
      // TROU PROUVÉ : commit 986122b5d dans GK28 a ajouté saveCurrentSession() dans CodeBuddyAgent
      // qui appelle directement this.costTracker.getSessionUsage().map(...) sans guard optionnel.
      // Dans tests/unit/codebuddy-agent.test.ts, le mock ne définit pas getSessionUsage.
      const agent = new CodeBuddyAgent('test-api-key');
      Reflect.set(agent, 'costTracker', {
        getReport: () => ({ sessionTokens: { input: 0, output: 0 } }),
        getSessionCost: () => 0,
      });
      expect(() => agent.saveCurrentSession()).not.toThrow();
    });

    it('saveCurrentSession ne doit pas lever TypeError si getCurrentModel() retourne undefined (tests grok-agent)', () => {
      // TROU PROUVÉ : dans tests/grok-agent.test.ts, getCurrentModel() retourne undefined via le client mocké,
      // ce qui fait planter inferCostProvider(undefined) sur model.trim().
      const agent = new CodeBuddyAgent('test-api-key');
      vi.spyOn(agent, 'getCurrentModel').mockReturnValue(undefined as unknown as string);
      expect(() => agent.saveCurrentSession()).not.toThrow();
    });
  });

  describe('4. Régression GK1 : lien cowork/readme.md cassé sur Linux', () => {
    it('vérifie que les tests de documentation publique ne référencent pas l’ancien nom cowork/readme.md', () => {
      // GK1 a renommé cowork/readme.md -> cowork/README.md mais public-screenshots.test.ts a été oublié
      const testFileContent = fs.readFileSync(
        path.join(process.cwd(), 'tests/docs/public-screenshots.test.ts'),
        'utf8',
      );
      expect(testFileContent).not.toContain("path.join(repoRoot, 'cowork', 'readme.md')");
    });
  });
});
