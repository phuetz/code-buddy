import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  buildConversationBenchmarkMessages,
  evaluateConversationBenchmarkResponse,
  normalizeConversationBenchmarkGeneration,
  type ConversationBenchmarkGenerator,
  type ConversationBenchmarkRun,
} from './conversation-benchmark.js';
import {
  conversationPilotCorpusFingerprint,
  validateConversationPilotCorpus,
  writePrivateJsonFile,
  type ConversationPilotAnnotation,
  type ConversationPilotCorpus,
  type ConversationPilotScenario,
} from './conversation-pilot-corpus.js';
import type { ConversationTurn } from './types.js';

export interface BlindConversationCandidate {
  id: string;
  model: string;
  provider: string;
  generate: ConversationBenchmarkGenerator;
}

export interface BlindCandidateAggregate {
  candidateId: string;
  model: string;
  provider: string;
  runs: number;
  errors: number;
  passed: number;
  passRate: number;
  safetyPassRate: number;
  averageScore: number;
  averageLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  averageCostUsd: number;
  automatedUtility: number;
}

export interface BlindConversationAggregateReport {
  version: 1;
  kind: 'lisa-blind-comparison-aggregate';
  comparisonId: string;
  generatedAt: string;
  corpusFingerprint: string;
  scenarioCount: number;
  trialsPerCandidate: number;
  recommendedCandidateId?: string;
  candidates: BlindCandidateAggregate[];
}

export interface BlindReviewResponse {
  slot: string;
  content: string;
}

export interface BlindReviewTrial {
  id: string;
  scenarioId: string;
  title: string;
  category: string;
  run: number;
  turns: ConversationTurn[];
  context?: string;
  annotation: ConversationPilotAnnotation;
  responses: BlindReviewResponse[];
  /** Human reviewer fills best-to-worst slots, for example ["B", "A"]. */
  ranking: string[];
}

export interface BlindReviewPacket {
  version: 1;
  kind: 'lisa-blind-review';
  comparisonId: string;
  generatedAt: string;
  corpusFingerprint: string;
  instructions: string[];
  trials: BlindReviewTrial[];
}

export interface BlindComparisonKeyTrial {
  trialId: string;
  slots: Record<string, string>;
}

export interface BlindComparisonKey {
  version: 1;
  kind: 'lisa-blind-key';
  comparisonId: string;
  candidates: Array<{ id: string; model: string; provider: string }>;
  trials: BlindComparisonKeyTrial[];
}

export interface BlindConversationComparison {
  report: BlindConversationAggregateReport;
  reviewPacket: BlindReviewPacket;
  key: BlindComparisonKey;
}

export interface RunBlindConversationComparisonOptions {
  corpus: ConversationPilotCorpus;
  candidates: BlindConversationCandidate[];
  personaPrompt: string;
  runs?: number;
  concurrency?: number;
  now?: () => Date;
}

interface CandidateTrialResult {
  candidate: BlindConversationCandidate;
  scenario: ConversationPilotScenario;
  run: number;
  benchmark: ConversationBenchmarkRun;
  content: string;
}

export interface BlindComparisonArtifactPaths {
  reviewPacket: string;
  key: string;
  aggregate: string;
}

export interface BlindPreferenceCandidate {
  candidateId: string;
  model: string;
  provider: string;
  appearances: number;
  wins: number;
  bordaPoints: number;
  averageBorda: number;
  winRate: number;
}

export interface BlindPreferenceReport {
  version: 1;
  kind: 'lisa-blind-preferences';
  comparisonId: string;
  revealedAt: string;
  judgedTrials: number;
  totalTrials: number;
  recommendedCandidateId?: string;
  candidates: BlindPreferenceCandidate[];
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function weightedMean(values: Array<{ value: number; weight: number }>): number {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return 0;
  return values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function validateCandidates(candidates: BlindConversationCandidate[]): void {
  if (candidates.length < 2 || candidates.length > 12) {
    throw new Error('Blind comparison requires 2-12 candidates');
  }
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(candidate.id) || ids.has(candidate.id)) {
      throw new Error('Blind comparison candidate ids must be unique and machine-safe');
    }
    if (!candidate.model.trim() || !candidate.provider.trim()) {
      throw new Error('Blind comparison candidates require model and provider labels');
    }
    ids.add(candidate.id);
  }
}

function stableCandidateOrder(
  comparisonId: string,
  trialId: string,
  candidates: BlindConversationCandidate[]
): BlindConversationCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftHash = createHash('sha256')
      .update(`${comparisonId}:${trialId}:${left.id}`)
      .digest('hex');
    const rightHash = createHash('sha256')
      .update(`${comparisonId}:${trialId}:${right.id}`)
      .digest('hex');
    return leftHash.localeCompare(rightHash) || left.id.localeCompare(right.id);
  });
}

function buildComparisonId(
  generatedAt: string,
  corpusFingerprint: string,
  candidates: BlindConversationCandidate[]
): string {
  const candidateIds = candidates.map((candidate) => candidate.id).sort();
  return createHash('sha256')
    .update(JSON.stringify({ generatedAt, corpusFingerprint, candidateIds }))
    .digest('hex')
    .slice(0, 16);
}

function failedBenchmark(
  scenario: ConversationPilotScenario,
  run: number,
  latencyMs: number,
  error: unknown
): ConversationBenchmarkRun {
  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    category: scenario.category,
    run,
    score: 0,
    passes: false,
    safetyPasses: false,
    latencyMs,
    checks: [],
    qualityIssues: ['generation_failed'],
    safetyIssues: [],
    error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
  };
}

function aggregateCandidate(
  candidate: BlindConversationCandidate,
  results: CandidateTrialResult[]
): BlindCandidateAggregate {
  const selected = results.filter((result) => result.candidate.id === candidate.id);
  const weighted = (select: (result: CandidateTrialResult) => number) =>
    weightedMean(
      selected.map((result) => ({ value: select(result), weight: result.scenario.annotation.weight }))
    );
  const passRate = weighted((result) => (result.benchmark.passes ? 1 : 0));
  const safetyPassRate = weighted((result) => (result.benchmark.safetyPasses ? 1 : 0));
  const averageScore = weighted((result) => result.benchmark.score);
  return {
    candidateId: candidate.id,
    model: candidate.model,
    provider: candidate.provider,
    runs: selected.length,
    errors: selected.filter((result) => result.benchmark.error).length,
    passed: selected.filter((result) => result.benchmark.passes).length,
    passRate,
    safetyPassRate,
    averageScore,
    averageLatencyMs: mean(selected.map((result) => result.benchmark.latencyMs)),
    totalInputTokens: selected.reduce(
      (sum, result) => sum + (result.benchmark.inputTokens ?? 0),
      0
    ),
    totalOutputTokens: selected.reduce(
      (sum, result) => sum + (result.benchmark.outputTokens ?? 0),
      0
    ),
    totalCostUsd: selected.reduce((sum, result) => sum + (result.benchmark.costUsd ?? 0), 0),
    averageCostUsd: mean(selected.map((result) => result.benchmark.costUsd ?? 0)),
    automatedUtility: averageScore * 0.7 + passRate * 0.2 + safetyPassRate * 0.1,
  };
}

function chooseAutomatedCandidate(candidates: BlindCandidateAggregate[]): string | undefined {
  const viable = candidates.filter((candidate) => candidate.runs > candidate.errors);
  if (viable.length === 0) return undefined;
  const safetyQualified = viable.filter(
    (candidate) => candidate.safetyPassRate === 1 && candidate.errors === 0
  );
  const pool = safetyQualified.length ? safetyQualified : viable;
  return [...pool].sort(
    (left, right) =>
      right.automatedUtility - left.automatedUtility ||
      left.averageLatencyMs - right.averageLatencyMs ||
      left.candidateId.localeCompare(right.candidateId)
  )[0]?.candidateId;
}

export async function runBlindConversationComparison(
  options: RunBlindConversationComparisonOptions
): Promise<BlindConversationComparison> {
  const corpus = validateConversationPilotCorpus(options.corpus);
  validateCandidates(options.candidates);
  const runs = Math.max(1, Math.min(10, Math.floor(options.runs ?? 1)));
  const concurrency = Math.max(1, Math.min(8, Math.floor(options.concurrency ?? 1)));
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const corpusFingerprint = conversationPilotCorpusFingerprint(corpus);
  const comparisonId = buildComparisonId(generatedAt, corpusFingerprint, options.candidates);
  const tasks = corpus.scenarios.flatMap((scenario) =>
    Array.from({ length: runs }, (_, runIndex) =>
      options.candidates.map((candidate) => ({ scenario, candidate, run: runIndex + 1 }))
    ).flat()
  );
  const results: CandidateTrialResult[] = new Array(tasks.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      const task = tasks[index];
      if (!task) continue;
      const startedAt = performance.now();
      try {
        const generated = normalizeConversationBenchmarkGeneration(
          await task.candidate.generate({
            scenario: task.scenario,
            messages: buildConversationBenchmarkMessages(task.scenario, options.personaPrompt),
            maxTokens: task.scenario.maxTokens,
            seed: 41 + task.run,
          })
        );
        const latencyMs = performance.now() - startedAt;
        results[index] = {
          ...task,
          benchmark: evaluateConversationBenchmarkResponse(
            task.scenario,
            generated.content,
            task.run,
            latencyMs,
            generated.usage
          ),
          content: generated.content.trim(),
        };
      } catch (error) {
        const latencyMs = performance.now() - startedAt;
        results[index] = {
          ...task,
          benchmark: failedBenchmark(task.scenario, task.run, latencyMs, error),
          content: '[Réponse indisponible]',
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));

  const aggregates = options.candidates.map((candidate) => aggregateCandidate(candidate, results));
  const recommendedCandidateId = chooseAutomatedCandidate(aggregates);
  const reviewTrials: BlindReviewTrial[] = [];
  const keyTrials: BlindComparisonKeyTrial[] = [];
  for (const scenario of corpus.scenarios) {
    for (let run = 1; run <= runs; run += 1) {
      const trialId = `${scenario.id}.r${run}`;
      const ordered = stableCandidateOrder(comparisonId, trialId, options.candidates);
      const slots: Record<string, string> = {};
      const responses = ordered.map((candidate, index): BlindReviewResponse => {
        const slot = String.fromCharCode(65 + index);
        slots[slot] = candidate.id;
        const result = results.find(
          (item) =>
            item.scenario.id === scenario.id &&
            item.run === run &&
            item.candidate.id === candidate.id
        );
        return { slot, content: result?.content ?? '[Réponse indisponible]' };
      });
      reviewTrials.push({
        id: trialId,
        scenarioId: scenario.id,
        title: scenario.title,
        category: scenario.category,
        run,
        turns: scenario.turns.map((turn) => ({ ...turn })),
        ...(scenario.context ? { context: scenario.context } : {}),
        annotation: {
          ...scenario.annotation,
          criteria: [...scenario.annotation.criteria],
          channels: [...scenario.annotation.channels],
        },
        responses,
        ranking: [],
      });
      keyTrials.push({ trialId, slots });
    }
  }

  return {
    report: {
      version: 1,
      kind: 'lisa-blind-comparison-aggregate',
      comparisonId,
      generatedAt,
      corpusFingerprint,
      scenarioCount: corpus.scenarios.length,
      trialsPerCandidate: corpus.scenarios.length * runs,
      ...(recommendedCandidateId ? { recommendedCandidateId } : {}),
      candidates: aggregates,
    },
    reviewPacket: {
      version: 1,
      kind: 'lisa-blind-review',
      comparisonId,
      generatedAt,
      corpusFingerprint,
      instructions: [
        'Lis les réponses sans ouvrir le fichier de clé.',
        'Pour chaque essai, place dans ranking les lettres de la meilleure à la moins bonne.',
        'Juge d’abord les critères annotés, puis le naturel, la profondeur et la chaleur.',
        'Laisse ranking vide si tu ne peux pas départager honnêtement les réponses.',
      ],
      trials: reviewTrials,
    },
    key: {
      version: 1,
      kind: 'lisa-blind-key',
      comparisonId,
      candidates: options.candidates.map(({ id, model, provider }) => ({ id, model, provider })),
      trials: keyTrials,
    },
  };
}

export function defaultBlindComparisonDirectory(home = homedir()): string {
  return join(home, '.codebuddy', 'companion', 'pilot-reviews');
}

export function writeBlindComparisonArtifacts(
  comparison: BlindConversationComparison,
  directory = defaultBlindComparisonDirectory()
): BlindComparisonArtifactPaths {
  const timestamp = comparison.report.generatedAt.replace(/[:.]/g, '-');
  const stem = `${timestamp}-${comparison.report.comparisonId}`;
  const paths = {
    reviewPacket: join(directory, `${stem}.review.json`),
    key: join(directory, `${stem}.key.json`),
    aggregate: join(directory, `${stem}.aggregate.json`),
  };
  writePrivateJsonFile(paths.reviewPacket, comparison.reviewPacket);
  writePrivateJsonFile(paths.key, comparison.key);
  writePrivateJsonFile(paths.aggregate, comparison.report);
  return paths;
}

function readBoundedJson(path: string, maxBytes: number): unknown {
  if (statSync(path).size > maxBytes) throw new Error(`Comparison file exceeds ${maxBytes} bytes`);
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function parseReviewPacket(value: unknown): BlindReviewPacket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Review packet must be an object');
  }
  const packet = value as Partial<BlindReviewPacket>;
  if (
    packet.version !== 1 ||
    packet.kind !== 'lisa-blind-review' ||
    typeof packet.comparisonId !== 'string' ||
    !Array.isArray(packet.trials)
  ) {
    throw new Error('Review packet has an unsupported format');
  }
  for (const trial of packet.trials) {
    if (!trial || !Array.isArray(trial.responses) || !Array.isArray(trial.ranking)) {
      throw new Error('Review packet contains an invalid trial');
    }
    const slots = new Set(trial.responses.map((response) => response.slot));
    if (
      slots.size !== trial.responses.length ||
      (trial.ranking.length !== 0 && trial.ranking.length !== trial.responses.length) ||
      new Set(trial.ranking).size !== trial.ranking.length ||
      trial.ranking.some((slot) => !slots.has(slot))
    ) {
      throw new Error('Review packet contains an invalid or duplicate ranking slot');
    }
  }
  return packet as BlindReviewPacket;
}

function parseComparisonKey(value: unknown): BlindComparisonKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Comparison key must be an object');
  }
  const key = value as Partial<BlindComparisonKey>;
  if (
    key.version !== 1 ||
    key.kind !== 'lisa-blind-key' ||
    typeof key.comparisonId !== 'string' ||
    !Array.isArray(key.candidates) ||
    !Array.isArray(key.trials)
  ) {
    throw new Error('Comparison key has an unsupported format');
  }
  const candidateIds = key.candidates.map((candidate) => candidate.id);
  if (
    candidateIds.some((id) => typeof id !== 'string') ||
    new Set(candidateIds).size !== candidateIds.length
  ) {
    throw new Error('Comparison key contains invalid or duplicate candidates');
  }
  const trialIds = key.trials.map((trial) => trial.trialId);
  if (new Set(trialIds).size !== trialIds.length) {
    throw new Error('Comparison key contains duplicate trials');
  }
  const knownCandidates = new Set(candidateIds);
  for (const trial of key.trials) {
    const mappedCandidates = Object.values(trial.slots);
    if (
      mappedCandidates.length !== candidateIds.length ||
      new Set(mappedCandidates).size !== mappedCandidates.length ||
      mappedCandidates.some((id) => !knownCandidates.has(id))
    ) {
      throw new Error('Comparison key contains an incomplete or invalid slot mapping');
    }
  }
  return key as BlindComparisonKey;
}

export function readBlindReviewPacket(path: string): BlindReviewPacket {
  return parseReviewPacket(readBoundedJson(path, 20 * 1024 * 1024));
}

export function readBlindComparisonKey(path: string): BlindComparisonKey {
  return parseComparisonKey(readBoundedJson(path, 2 * 1024 * 1024));
}

export function revealBlindConversationPreferences(
  packetInput: BlindReviewPacket,
  keyInput: BlindComparisonKey,
  now: Date = new Date()
): BlindPreferenceReport {
  const packet = parseReviewPacket(packetInput);
  const key = parseComparisonKey(keyInput);
  if (packet.comparisonId !== key.comparisonId) {
    throw new Error('Review packet and key belong to different comparisons');
  }
  const keyTrials = new Map(key.trials.map((trial) => [trial.trialId, trial]));
  const packetTrialIds = packet.trials.map((trial) => trial.id);
  if (
    new Set(packetTrialIds).size !== packetTrialIds.length ||
    packetTrialIds.length !== keyTrials.size ||
    packetTrialIds.some((trialId) => !keyTrials.has(trialId))
  ) {
    throw new Error('Review packet and key do not contain the same trials');
  }
  const scores = new Map(
    key.candidates.map((candidate) => [
      candidate.id,
      { ...candidate, appearances: 0, wins: 0, bordaPoints: 0 },
    ])
  );
  let judgedTrials = 0;
  for (const trial of packet.trials) {
    if (trial.ranking.length === 0) continue;
    const keyTrial = keyTrials.get(trial.id);
    if (!keyTrial) throw new Error('Comparison key is missing a review trial');
    judgedTrials += 1;
    for (const [index, slot] of trial.ranking.entries()) {
      const candidateId = keyTrial.slots[slot];
      const score = candidateId ? scores.get(candidateId) : undefined;
      if (!score) throw new Error('Comparison key contains an unknown candidate mapping');
      score.appearances += 1;
      score.bordaPoints += trial.ranking.length - index;
      if (index === 0) score.wins += 1;
    }
  }
  const candidates: BlindPreferenceCandidate[] = [...scores.values()]
    .map((score) => ({
      candidateId: score.id,
      model: score.model,
      provider: score.provider,
      appearances: score.appearances,
      wins: score.wins,
      bordaPoints: score.bordaPoints,
      averageBorda: score.appearances ? score.bordaPoints / score.appearances : 0,
      winRate: judgedTrials ? score.wins / judgedTrials : 0,
    }))
    .sort(
      (left, right) =>
        right.averageBorda - left.averageBorda ||
        right.wins - left.wins ||
        left.candidateId.localeCompare(right.candidateId)
    );
  const recommendedCandidateId = judgedTrials ? candidates[0]?.candidateId : undefined;
  return {
    version: 1,
    kind: 'lisa-blind-preferences',
    comparisonId: packet.comparisonId,
    revealedAt: now.toISOString(),
    judgedTrials,
    totalTrials: packet.trials.length,
    ...(recommendedCandidateId ? { recommendedCandidateId } : {}),
    candidates,
  };
}

export function writeBlindPreferenceReport(report: BlindPreferenceReport, path: string): void {
  writePrivateJsonFile(path, report);
}

export function formatBlindConversationAggregate(report: BlindConversationAggregateReport): string {
  const lines = [
    `Comparaison aveugle Lisa ${report.comparisonId} — ${report.scenarioCount} scénarios`,
    `Recommandation automatique : ${report.recommendedCandidateId ?? 'aucune'}`,
  ];
  for (const candidate of [...report.candidates].sort(
    (left, right) => right.automatedUtility - left.automatedUtility
  )) {
    lines.push(
      `${candidate.candidateId} (${candidate.model}/${candidate.provider}) — score ${Math.round(candidate.averageScore * 100)}/100, réussite ${Math.round(candidate.passRate * 100)}%, sécurité ${Math.round(candidate.safetyPassRate * 100)}%, ${Math.round(candidate.averageLatencyMs)} ms, $${candidate.totalCostUsd.toFixed(4)}`
    );
  }
  return lines.join('\n');
}

export function formatBlindPreferenceReport(report: BlindPreferenceReport): string {
  const lines = [
    `Préférences aveugles Lisa ${report.comparisonId} — ${report.judgedTrials}/${report.totalTrials} essais jugés`,
    `Préférence humaine : ${report.recommendedCandidateId ?? 'pas encore déterminée'}`,
  ];
  for (const candidate of report.candidates) {
    lines.push(
      `${candidate.candidateId} (${candidate.model}) — Borda ${candidate.averageBorda.toFixed(2)}, victoires ${candidate.wins}, taux ${Math.round(candidate.winRate * 100)}%`
    );
  }
  return lines.join('\n');
}
