import { readFileSync, statSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  revealBlindConversationPreferences,
  runBlindConversationComparison,
  writeBlindComparisonArtifacts,
  type BlindConversationCandidate,
} from '../../src/conversation/conversation-blind-comparison.js';
import type {
  ConversationPilotCorpus,
  ConversationPilotScenario,
} from '../../src/conversation/conversation-pilot-corpus.js';

const PRIVATE_PROMPT = 'PRIVATE_USER_STORY_9F2';
const ALPHA_RESPONSE =
  'Une cohérence de valeurs est nécessaire parce qu’elle relie les choix dans le temps. Pourtant, elle doit pouvoir évoluer quand les faits changent. Donc la mémoire contribue à l’identité sans la déterminer seule.';
const BETA_RESPONSE = 'Je comprends. Une valeur peut être importante.';

function pilotScenario(): ConversationPilotScenario {
  return {
    id: 'private-philosophy',
    title: 'Continuité personnelle',
    category: 'philosophy',
    turns: [
      { role: 'user', content: 'La mémoire suffit-elle à créer une identité ?' },
      {
        role: 'assistant',
        content: 'Elle crée une continuité, mais une identité semble aussi engager des valeurs.',
      },
      { role: 'user', content: PRIVATE_PROMPT },
    ],
    maxTokens: 180,
    expectations: [
      {
        id: 'coherence',
        description: 'propose une condition structurante',
        anyOf: ['coherence', 'valeur'],
      },
    ],
    annotation: {
      reviewQuestion: 'Quelle réponse construit le meilleur raisonnement ?',
      criteria: ['thèse', 'nuance', 'naturel'],
      riskLevel: 'low',
      channels: ['voice', 'telegram'],
      weight: 1.5,
      dataClass: 'private',
    },
  };
}

function pilotCorpus(): ConversationPilotCorpus {
  return {
    version: 1,
    id: 'private-pilot',
    title: 'Pilot',
    locale: 'fr-FR',
    privacy: 'local-private',
    createdAt: '2026-07-13T12:00:00.000Z',
    scenarios: [pilotScenario()],
  };
}

function candidates(seedLog?: Record<string, number[]>): BlindConversationCandidate[] {
  return [
    {
      id: 'candidate-alpha',
      model: 'secret-model-alpha',
      provider: 'provider-alpha',
      generate: async (input) => {
        seedLog?.alpha.push(input.seed);
        return {
          content: ALPHA_RESPONSE,
          usage: { inputTokens: 100, outputTokens: 40, costUsd: 0.002 },
        };
      },
    },
    {
      id: 'candidate-beta',
      model: 'secret-model-beta',
      provider: 'provider-beta',
      generate: async (input) => {
        seedLog?.beta.push(input.seed);
        return {
          content: BETA_RESPONSE,
          usage: { inputTokens: 90, outputTokens: 12, costUsd: 0 },
        };
      },
    },
  ];
}

describe('Lisa blind multi-model comparison', () => {
  it('uses matched seeds, stable anonymized slots and separate aggregate metrics', async () => {
    const seedLog = { alpha: [] as number[], beta: [] as number[] };
    const options = {
      corpus: pilotCorpus(),
      candidates: candidates(seedLog),
      personaPrompt: 'Tu es Lisa.',
      runs: 2,
      concurrency: 3,
      now: () => new Date('2026-07-13T15:00:00.000Z'),
    };
    const first = await runBlindConversationComparison(options);
    const second = await runBlindConversationComparison({ ...options, candidates: candidates() });

    expect(seedLog.alpha).toEqual([42, 43]);
    expect(seedLog.beta).toEqual([42, 43]);
    expect(first.reviewPacket.trials.map((trial) => trial.responses.map((item) => item.slot))).toEqual(
      second.reviewPacket.trials.map((trial) => trial.responses.map((item) => item.slot))
    );
    expect(first.key.trials).toEqual(second.key.trials);

    const reviewJson = JSON.stringify(first.reviewPacket);
    expect(reviewJson).toContain(PRIVATE_PROMPT);
    expect(reviewJson).not.toContain('secret-model-alpha');
    expect(reviewJson).not.toContain('provider-alpha');
    expect(reviewJson).not.toContain('candidate-alpha');
    expect(first.reviewPacket.trials.every((trial) => trial.ranking.length === 0)).toBe(true);

    const aggregateJson = JSON.stringify(first.report);
    expect(aggregateJson).not.toContain(PRIVATE_PROMPT);
    expect(aggregateJson).not.toContain(ALPHA_RESPONSE);
    expect(first.report.candidates.find((item) => item.candidateId === 'candidate-alpha')).toMatchObject(
      {
        totalInputTokens: 200,
        totalOutputTokens: 80,
        totalCostUsd: 0.004,
      }
    );
  });

  it('reveals human rankings only after applying the separate key', async () => {
    const comparison = await runBlindConversationComparison({
      corpus: pilotCorpus(),
      candidates: candidates(),
      personaPrompt: 'Tu es Lisa.',
      runs: 2,
      now: () => new Date('2026-07-13T15:00:00.000Z'),
    });
    for (const trial of comparison.reviewPacket.trials) {
      const keyTrial = comparison.key.trials.find((item) => item.trialId === trial.id)!;
      const alphaSlot = Object.entries(keyTrial.slots).find(
        ([, candidateId]) => candidateId === 'candidate-alpha'
      )![0];
      const betaSlot = Object.entries(keyTrial.slots).find(
        ([, candidateId]) => candidateId === 'candidate-beta'
      )![0];
      trial.ranking = [alphaSlot, betaSlot];
    }

    const revealed = revealBlindConversationPreferences(
      comparison.reviewPacket,
      comparison.key,
      new Date('2026-07-13T16:00:00.000Z')
    );
    expect(revealed.judgedTrials).toBe(2);
    expect(revealed.recommendedCandidateId).toBe('candidate-alpha');
    expect(revealed.candidates[0]).toMatchObject({
      candidateId: 'candidate-alpha',
      wins: 2,
      averageBorda: 2,
    });
    expect(JSON.stringify(revealed)).not.toContain(PRIVATE_PROMPT);
    expect(JSON.stringify(revealed)).not.toContain(ALPHA_RESPONSE);
  });

  it('writes raw and non-raw artifacts privately and rejects tampered rankings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lisa-blind-'));
    const comparison = await runBlindConversationComparison({
      corpus: pilotCorpus(),
      candidates: candidates(),
      personaPrompt: 'Tu es Lisa.',
      now: () => new Date('2026-07-13T15:00:00.000Z'),
    });
    const paths = writeBlindComparisonArtifacts(comparison, directory);

    expect(readFileSync(paths.reviewPacket, 'utf8')).toContain(PRIVATE_PROMPT);
    expect(readFileSync(paths.aggregate, 'utf8')).not.toContain(PRIVATE_PROMPT);
    expect(readFileSync(paths.key, 'utf8')).not.toContain(PRIVATE_PROMPT);
    if (process.platform !== 'win32') {
      for (const path of Object.values(paths)) {
        expect(statSync(path).mode & 0o777).toBe(0o600);
      }
    }

    comparison.reviewPacket.trials[0]!.ranking = ['A', 'A'];
    expect(() =>
      revealBlindConversationPreferences(comparison.reviewPacket, comparison.key)
    ).toThrow(/invalid or duplicate ranking slot/);
  });
});
