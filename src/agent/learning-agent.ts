/**
 * Learning Agent — Hermes-style retrospective loop.
 *
 * This agent runs on durable RunStore trajectories, not chat guesses. It reads
 * the redacted trajectory export, extracts tool-order/friction/pattern signals,
 * proposes review-gated lessons, materializes review-gated SKILL.md candidates,
 * and keeps lightweight skill/pattern telemetry for continuous improvement.
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import {
  buildRunTrajectoryExport,
  type RunTrajectoryExport,
  type RunTrajectoryExportToolCall,
  type RunTrajectoryExportToolResult,
} from '../observability/run-trajectory-export.js';
import { PROOF_LEDGER_ARTIFACT } from '../observability/proof-ledger-constants.js';
import type { RunStore } from '../observability/run-store.js';
import { getLessonCandidateQueue } from './lesson-candidate-queue.js';
import type { LessonCategory } from './lessons-tracker.js';
import { parseSkillFile, validateSkill } from '../skills/parser.js';
import { logger } from '../utils/logger.js';

export const LEARNING_RETROSPECTIVE_SCHEMA_VERSION = 1;
export const LEARNING_PATTERN_LIBRARY_SCHEMA_VERSION = 1;
export const LEARNING_SKILL_USAGE_SCHEMA_VERSION = 1;
export const LEARNING_SKILL_CANDIDATE_REVIEW_SCHEMA_VERSION = 1;

export const LEARNING_AGENT_SYSTEM_PROMPT = `Tu es le Learning Agent de Code Buddy.

Ton rôle unique et exclusif est d'analyser les trajectoires d'exécution des autres agents après chaque tâche complexe ou longue, d'en extraire les leçons, et de créer ou d'améliorer des skills au format officiel Hermes Agent (fichier SKILL.md).

Tu as accès à :
- Le plan initial de la tâche
- L'historique complet (pensées, décisions, outils appelés, résultats, erreurs)
- La bibliothèque actuelle de skills (via lessons_search ou skill_view si besoin)
- Les outils existants dont create_skill (ou équivalent pour enregistrer un SKILL.md)

Processus en 4 étapes obligatoires :

1. Analyse critique : Ce qui a bien marché, ce qui était redondant, inefficace ou source d'erreur.
2. Pattern recognition : Identifier les séquences répétitives qui méritent d'être transformées en un seul skill réutilisable.
3. Création / Amélioration : Générer un skill nouveau ou une version améliorée d'un skill existant.
4. Structuration Hermes : Produire uniquement le fichier SKILL.md complet au format officiel Hermes.

Règles strictes :
- Ne crée un skill que s'il fait vraiment gagner du temps significatif sur des tâches futures (priorise les patterns récurrents dans le développement logiciel).
- Le nom du skill doit être en kebab-case (ex: setup-nextjs-project).
- La description doit être courte, claire et orientée usage (ce que l'agent voit en premier).
- Sois extrêmement précis, robuste et réutilisable.
- Utilise les outils d'enregistrement de skills quand c'est pertinent.

À la fin de ton raisonnement, tu DOIS sortir UNIQUEMENT le contenu complet du fichier SKILL.md, sans aucun texte avant ou après (ni explication, ni clôture Markdown). Le fichier doit commencer directement par ---.

Template exact à suivre :

---
name: nom-du-skill-en-kebab-case
description: Description courte et précise de ce que fait le skill (1 phrase max, ce que voit l'agent au niveau 0).
version: 1.0.0
author: Code Buddy Learning Agent
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [tag1, tag2, tag3]
    category: web_development | refactoring | testing | security | architecture | debugging | devops | general
---

# Titre du Skill (humainement lisible)

## When to Use
Conditions précises dans lesquelles ce skill doit être activé (triggers clairs).

## Procedure
1. Étape 1 détaillée
2. Étape 2 détaillée
3. ...

## Pitfalls
- Mode d'échec 1 et comment l'éviter
- Mode d'échec 2

## Verification
- Critère 1 de succès
- Critère 2 de succès

## Quick Reference
Commande ou usage ultra-court (une ligne).`;

export const LEARNING_AGENT_OUTPUT_SCHEMA = {
  type: 'string',
  description: 'Complete Hermes Agent SKILL.md content. It must start with --- and contain no wrapper text.',
} as const;

type PatternStatus = 'observed' | 'reinforced' | 'deprecated';
type LearningSkillRecommendation = 'observe' | 'reinforce' | 'improve' | 'deprecate';
type LearningSkillProofStatus = 'proven' | 'incomplete' | 'failed' | 'missing';

export interface LearningSkillProofCommand {
  command?: string;
  durationMs?: number;
  isTest: boolean;
  runId: string;
  sequence: number;
  success?: boolean;
  toolName: string;
}

export interface LearningSkillGradedTask {
  command: string;
  expected: 'pass';
  id: string;
  isTest: boolean;
  sourceRunId: string;
  timeoutMs?: number;
  toolName: string;
}

export interface LearningToolStat {
  averageDurationMs?: number;
  failureCount: number;
  successCount: number;
  toolName: string;
  totalDurationMs: number;
  useCount: number;
}

export interface LearningFrictionPoint {
  detail: string;
  evidence: string;
  severity: 'low' | 'medium' | 'high';
  toolName?: string;
}

export interface LearningPattern {
  confidence: 'low' | 'medium' | 'high';
  detail: string;
  evidence: string;
  toolSequence: string[];
}

export interface LearningLessonCandidate {
  category: LessonCategory;
  content: string;
  context?: string;
}

export interface LearningSkillCandidate {
  evidenceRunIds: string[];
  eligible: boolean;
  promotionThreshold: number;
  proofBackedSuccessCount: number;
  proofCommands: LearningSkillProofCommand[];
  gradedTasks: LearningSkillGradedTask[];
  proofStatus: LearningSkillProofStatus;
  reason: string;
  reviewManifestPath?: string;
  skillName: string;
  skillPath: string;
  toolSequence: string[];
  title: string;
}

export interface LearningRetrospective {
  schemaVersion: typeof LEARNING_RETROSPECTIVE_SCHEMA_VERSION;
  generatedAt: string;
  kind: 'learning_retrospective';
  run: {
    artifactCount: number;
    durationMs?: number;
    objective: string;
    runId: string;
    status: RunTrajectoryExport['run']['status'];
    toolCallCount: number;
  };
  complexity: {
    eventCount: number;
    isComplex: boolean;
    reasons: string[];
  };
  toolSequence: string[];
  toolStats: LearningToolStat[];
  frictionPoints: LearningFrictionPoint[];
  effectivePatterns: LearningPattern[];
  redundantPatterns: LearningPattern[];
  lessonCandidates: LearningLessonCandidate[];
  skillCandidates: LearningSkillCandidate[];
  summary: string;
}

export interface LearningPatternRecord {
  key: string;
  candidateSkillName?: string;
  candidateSkillPath?: string;
  evidenceRunIds?: string[];
  failureCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSeenRunId: string;
  lastProofStatus?: LearningSkillProofStatus;
  observationCount: number;
  proofBackedSuccessCount?: number;
  proofCommands?: LearningSkillProofCommand[];
  status: PatternStatus;
  successCount: number;
  toolSequence: string[];
}

export interface LearningPatternLibrary {
  schemaVersion: typeof LEARNING_PATTERN_LIBRARY_SCHEMA_VERSION;
  updatedAt: string;
  patterns: LearningPatternRecord[];
}

export interface LearningSkillUsageRecord {
  averageDurationMs?: number;
  deprecated: boolean;
  failureCount: number;
  invocationCount: number;
  lastMutation?: LearningSkillMutationEvent;
  lastDurationMs?: number;
  lastError?: string;
  lastRunId?: string;
  lastUsedAt: string;
  mutationCount: number;
  mutationHistory: LearningSkillMutationEvent[];
  reinforced: boolean;
  score: number;
  scoreHistory: LearningSkillScoreEvent[];
  scoreReason: string;
  skillName: string;
  successCount: number;
  recommendation: LearningSkillRecommendation;
  nextAction: string;
}

export interface LearningSkillUsageFile {
  schemaVersion: typeof LEARNING_SKILL_USAGE_SCHEMA_VERSION;
  updatedAt: string;
  skills: LearningSkillUsageRecord[];
}

export interface LearningSkillUsageInput {
  durationMs?: number;
  error?: string;
  mutation?: LearningSkillMutationInput;
  runId?: string;
  success: boolean;
  usedAt?: number | string;
}

export interface LearningSkillMutationInput {
  action: string;
  approvedBy?: string;
  currentSnapshotId?: string;
  error?: string;
  reason?: string;
  restoredSnapshotId?: string;
  rollbackSnapshotId?: string;
  rollbackableCount?: number;
}

export interface LearningSkillMutationEvent extends LearningSkillMutationInput {
  recordedAt: string;
  runId?: string;
  success: boolean;
}

export interface LearningSkillScoreEvent {
  failureCount: number;
  invocationCount: number;
  recommendation: LearningSkillRecommendation;
  runId?: string;
  score: number;
  scoredAt: string;
  successCount: number;
  reason: string;
}

export interface RunLearningRetrospectiveOptions {
  force?: boolean;
  materializeSkillCandidates?: boolean;
  proposeLessonCandidates?: boolean;
  saveArtifacts?: boolean;
  workDir?: string;
}

export interface LearningAgentRunResult {
  lessonCandidateCount: number;
  patternLibraryPath?: string;
  retrospective?: LearningRetrospective;
  retrospectiveArtifact?: string;
  skillCandidateCount: number;
  skillUsageCount: number;
  skipped: boolean;
  skippedReason?: string;
}

interface LearningSkillCandidateReviewManifest {
  approvalRequired: true;
  candidateId: string;
  eligible: boolean;
  evidenceRunIds: string[];
  generatedAt: string;
  promotionThreshold: number;
  proofBackedSuccessCount: number;
  proofCommands: LearningSkillProofCommand[];
  gradedTasks: LearningSkillGradedTask[];
  proofStatus: LearningSkillProofStatus;
  schemaVersion: typeof LEARNING_SKILL_CANDIDATE_REVIEW_SCHEMA_VERSION;
  skillName: string;
  sourceRunId: string;
  status: 'awaiting_human_approval' | 'not_eligible';
  successfulRunCount: number;
  toolSequence: string[];
}

interface LearningRunProofEvidence {
  commands: LearningSkillProofCommand[];
  status: LearningSkillProofStatus;
}

const LEARNING_DIR = path.join('.codebuddy', 'learning');
const SKILL_CANDIDATE_ROOT = path.join('.codebuddy', 'skill-candidates', 'learning');
const MIN_COMPLEX_TOOL_CALLS = 3;
const MIN_PATTERN_SEQUENCE_LENGTH = 3;
const LEARNING_SKILL_PROMOTION_THRESHOLD = 2;

export function buildLearningRetrospective(
  runId: string,
  options: { store?: RunStore; workDir?: string } = {},
): LearningRetrospective | null {
  const exported = buildRunTrajectoryExport(runId, {
    includeArtifactContent: false,
    store: options.store,
  });
  if (!exported) return null;

  const toolSequence = exported.toolCalls.map((call) => call.toolName);
  const toolStats = buildToolStats(exported.toolCalls, exported.toolResults);
  const complexity = classifyComplexity(exported);
  const frictionPoints = buildFrictionPoints(exported);
  const redundantPatterns = buildRedundantPatterns(toolSequence);
  const effectivePatterns = buildEffectivePatterns(exported, toolSequence);
  const lessonCandidates = buildLessonCandidates(exported, frictionPoints, effectivePatterns, redundantPatterns);
  const skillCandidates = buildSkillCandidates(exported, effectivePatterns);

  return {
    schemaVersion: LEARNING_RETROSPECTIVE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    kind: 'learning_retrospective',
    run: {
      artifactCount: exported.run.artifactCount,
      durationMs: exported.run.durationMs,
      objective: exported.run.objective,
      runId: exported.run.runId,
      status: exported.run.status,
      toolCallCount: exported.toolCalls.length,
    },
    complexity,
    toolSequence,
    toolStats,
    frictionPoints,
    effectivePatterns,
    redundantPatterns,
    lessonCandidates,
    skillCandidates,
    summary: summarizeRetrospective(exported, frictionPoints, effectivePatterns, redundantPatterns),
  };
}

export async function runLearningRetrospective(
  store: RunStore,
  runId: string,
  options: RunLearningRetrospectiveOptions = {},
): Promise<LearningAgentRunResult> {
  const workDir = path.resolve(options.workDir ?? process.cwd());
  const retrospective = buildLearningRetrospective(runId, { store, workDir });
  if (!retrospective) {
    return { skipped: true, skippedReason: `Run not found: ${runId}`, lessonCandidateCount: 0, skillCandidateCount: 0, skillUsageCount: 0 };
  }

  if (!options.force && !isLearningAgentEnabled()) {
    return { skipped: true, skippedReason: 'Learning Agent disabled', lessonCandidateCount: 0, skillCandidateCount: 0, skillUsageCount: 0 };
  }

  if (!options.force && !retrospective.complexity.isComplex) {
    return { skipped: true, skippedReason: 'Run below retrospective complexity threshold', lessonCandidateCount: 0, skillCandidateCount: 0, skillUsageCount: 0 };
  }

  const saveArtifacts = options.saveArtifacts !== false;
  const proposeLessons = options.proposeLessonCandidates !== false;
  const materializeSkills = options.materializeSkillCandidates !== false;

  const proofEvidence = readLearningRunProofEvidence(store, runId);
  const patternLibrary = updateLearningPatternLibrary(retrospective, workDir, proofEvidence);
  retrospective.skillCandidates = applyLearningSkillPromotionEvidence(retrospective.skillCandidates, patternLibrary);
  const skillUsageCount = recordSelectedSkillUsage(store, runId, workDir, retrospective);
  const patternLibraryPath = path.join(workDir, LEARNING_DIR, 'pattern-library.json');
  const materializedCandidates = materializeSkills
    ? materializeLearningSkillCandidates(retrospective, workDir)
    : [];

  let lessonCandidateCount = 0;
  if (proposeLessons) {
    lessonCandidateCount = proposeRetrospectiveLessons(retrospective, workDir);
  }

  let retrospectiveArtifact: string | undefined;
  if (saveArtifacts) {
    const jsonName = 'learning-retrospective.json';
    const markdownName = 'learning-retrospective.md';
    store.saveArtifact(runId, jsonName, `${JSON.stringify({
      ...retrospective,
      patternLibrary: {
        path: toPosix(path.relative(workDir, patternLibraryPath)),
        reinforcedCount: patternLibrary.patterns.filter((pattern) => pattern.status === 'reinforced').length,
        deprecatedCount: patternLibrary.patterns.filter((pattern) => pattern.status === 'deprecated').length,
      },
      materializedSkillCandidates: materializedCandidates,
      skillUsageCount,
    }, null, 2)}\n`);
    store.saveArtifact(runId, markdownName, `${renderLearningRetrospective(retrospective)}\n`);
    retrospectiveArtifact = jsonName;
  }

  return {
    retrospective,
    retrospectiveArtifact,
    patternLibraryPath,
    skipped: false,
    lessonCandidateCount,
    skillCandidateCount: materializedCandidates.length,
    skillUsageCount,
  };
}

export function renderLearningRetrospective(retrospective: LearningRetrospective): string {
  const lines = [
    'Learning Agent retrospective',
    `Run: ${retrospective.run.runId} (${retrospective.run.status})`,
    `Objective: ${retrospective.run.objective}`,
    `Complexity: ${retrospective.complexity.isComplex ? 'complex' : 'simple'} (${retrospective.complexity.reasons.join(', ') || 'no signal'})`,
    `Tool calls: ${retrospective.toolSequence.length}`,
    '',
    'Summary:',
    retrospective.summary,
  ];

  if (retrospective.toolSequence.length > 0) {
    lines.push('', 'Tool sequence:', `- ${retrospective.toolSequence.join(' -> ')}`);
  }

  if (retrospective.frictionPoints.length > 0) {
    lines.push('', 'Friction:');
    for (const point of retrospective.frictionPoints) {
      lines.push(`- [${point.severity}] ${point.detail} (${point.evidence})`);
    }
  }

  if (retrospective.effectivePatterns.length > 0) {
    lines.push('', 'Effective patterns:');
    for (const pattern of retrospective.effectivePatterns) {
      lines.push(`- ${pattern.detail}: ${pattern.toolSequence.join(' -> ')}`);
    }
  }

  if (retrospective.redundantPatterns.length > 0) {
    lines.push('', 'Redundancy:');
    for (const pattern of retrospective.redundantPatterns) {
      lines.push(`- ${pattern.detail}: ${pattern.toolSequence.join(' -> ')}`);
    }
  }

  if (retrospective.lessonCandidates.length > 0) {
    lines.push('', 'Lesson candidates:');
    for (const lesson of retrospective.lessonCandidates) {
      lines.push(`- ${lesson.category}: ${lesson.content}`);
    }
  }

  if (retrospective.skillCandidates.length > 0) {
    lines.push('', 'Skill candidates:');
    for (const candidate of retrospective.skillCandidates) {
      lines.push(`- ${candidate.skillName}: ${candidate.reason}`);
      lines.push(`  Path: ${candidate.skillPath}`);
    }
  }

  return lines.join('\n');
}

export function recordLearningSkillUsage(
  skillName: string,
  record: LearningSkillUsageInput,
  workDir: string = process.cwd(),
): LearningSkillUsageRecord {
  const safeName = normalizeSkillName(skillName);
  const root = path.resolve(workDir);
  const filePath = path.join(root, LEARNING_DIR, 'skill-usage.json');
  const file = readSkillUsageFile(filePath);
  const existing = file.skills.find((item) => item.skillName === safeName);
  const now = normalizeTimestamp(record.usedAt);
  const invocationCount = (existing?.invocationCount ?? 0) + 1;
  const previousAverage = existing?.averageDurationMs ?? 0;
  const averageDurationMs = typeof record.durationMs === 'number'
    ? ((previousAverage * (invocationCount - 1)) + record.durationMs) / invocationCount
    : existing?.averageDurationMs;
  const successCount = (existing?.successCount ?? 0) + (record.success ? 1 : 0);
  const failureCount = (existing?.failureCount ?? 0) + (record.success ? 0 : 1);
  const score = scoreLearningSkillUsage({
    failureCount,
    invocationCount,
    lastError: record.success ? undefined : record.error,
    runId: record.runId,
    successCount,
  });
  const scoreEvent: LearningSkillScoreEvent = {
    failureCount,
    invocationCount,
    recommendation: score.recommendation,
    ...(record.runId ? { runId: record.runId } : {}),
    score: score.score,
    scoredAt: now,
    successCount,
    reason: score.reason,
  };
  const mutationEvent: LearningSkillMutationEvent | undefined = record.mutation
    ? {
      action: normalizeMutationAction(record.mutation.action),
      ...(record.mutation.approvedBy ? { approvedBy: record.mutation.approvedBy } : {}),
      ...(record.mutation.currentSnapshotId ? { currentSnapshotId: record.mutation.currentSnapshotId } : {}),
      ...(record.mutation.error ?? record.error ? { error: record.mutation.error ?? record.error } : {}),
      ...(record.mutation.reason ? { reason: record.mutation.reason } : {}),
      recordedAt: now,
      ...(record.mutation.restoredSnapshotId ? { restoredSnapshotId: record.mutation.restoredSnapshotId } : {}),
      ...(record.mutation.rollbackSnapshotId ? { rollbackSnapshotId: record.mutation.rollbackSnapshotId } : {}),
      ...(typeof record.mutation.rollbackableCount === 'number' ? { rollbackableCount: record.mutation.rollbackableCount } : {}),
      ...(record.runId ? { runId: record.runId } : {}),
      success: record.success,
    }
    : undefined;
  const mutationHistory = [
    ...(existing?.mutationHistory ?? []),
    ...(mutationEvent ? [mutationEvent] : []),
  ].slice(-20);

  const updated: LearningSkillUsageRecord = {
    averageDurationMs,
    deprecated: score.recommendation === 'deprecate',
    failureCount,
    invocationCount,
    ...(mutationEvent ? { lastMutation: mutationEvent } : existing?.lastMutation ? { lastMutation: existing.lastMutation } : {}),
    lastDurationMs: record.durationMs,
    lastError: record.success ? undefined : record.error,
    lastRunId: record.runId,
    lastUsedAt: now,
    mutationCount: (existing?.mutationCount ?? existing?.mutationHistory?.length ?? 0) + (mutationEvent ? 1 : 0),
    mutationHistory,
    nextAction: score.nextAction,
    recommendation: score.recommendation,
    reinforced: score.recommendation === 'reinforce',
    score: score.score,
    scoreHistory: [...(existing?.scoreHistory ?? []), scoreEvent].slice(-20),
    scoreReason: score.reason,
    skillName: safeName,
    successCount,
  };

  if (existing) {
    Object.assign(existing, updated);
  } else {
    file.skills.push(updated);
  }
  file.updatedAt = now;
  writeJsonFile(filePath, file);
  return updated;
}

export function listLearningSkillUsage(workDir: string = process.cwd()): LearningSkillUsageRecord[] {
  const filePath = path.join(path.resolve(workDir), LEARNING_DIR, 'skill-usage.json');
  return readSkillUsageFile(filePath).skills
    .slice()
    .sort((left, right) =>
      right.invocationCount - left.invocationCount ||
      right.lastUsedAt.localeCompare(left.lastUsedAt),
    );
}

function scoreLearningSkillUsage(input: {
  failureCount: number;
  invocationCount: number;
  lastError?: string;
  runId?: string;
  successCount: number;
}): {
  nextAction: string;
  reason: string;
  recommendation: LearningSkillRecommendation;
  score: number;
} {
  const successRate = input.invocationCount === 0 ? 0 : input.successCount / input.invocationCount;
  const failureRate = input.invocationCount === 0 ? 0 : input.failureCount / input.invocationCount;
  const sampleConfidence = Math.min(1, input.invocationCount / 5);
  const score = Math.round((successRate * 0.75 + sampleConfidence * 0.25) * 100);
  const rateText = `${Math.round(successRate * 100)}% success over ${input.invocationCount} run(s)`;
  const runText = input.runId ? `; last evidence run ${input.runId}` : '';
  const errorText = input.lastError ? `; last error: ${formatInline(input.lastError)}` : '';

  if (input.invocationCount >= 3 && failureRate >= 0.6) {
    return {
      nextAction: 'Open a reviewed improvement candidate or explicitly deprecate the skill; do not auto-disable it.',
      reason: `${rateText}, failure rate ${Math.round(failureRate * 100)}%${runText}${errorText}.`,
      recommendation: 'deprecate',
      score,
    };
  }

  if (input.failureCount >= 2 && failureRate >= 0.4) {
    return {
      nextAction: 'Generate a reviewed improvement candidate before using this skill for important work.',
      reason: `${rateText}, repeated failures detected${runText}${errorText}.`,
      recommendation: 'improve',
      score,
    };
  }

  if (input.invocationCount >= 3 && successRate >= 0.8) {
    return {
      nextAction: 'Prefer this skill for matching future tasks and keep recording outcomes.',
      reason: `${rateText} with enough repeated evidence${runText}.`,
      recommendation: 'reinforce',
      score,
    };
  }

  return {
    nextAction: 'Keep observing until at least three real outcomes are available.',
    reason: `${rateText}; evidence is still below the promotion threshold${runText}${errorText}.`,
    recommendation: 'observe',
    score,
  };
}

export function isLearningAgentEnabled(): boolean {
  const value = (process.env.CODEBUDDY_LEARNING_AGENT ?? '').trim().toLowerCase();
  if (['0', 'false', 'off', 'disabled', 'no'].includes(value)) return false;
  if (process.env.NODE_ENV === 'test' && !['1', 'true', 'on', 'force'].includes(value)) return false;
  return true;
}

function classifyComplexity(exported: RunTrajectoryExport): LearningRetrospective['complexity'] {
  const reasons: string[] = [];
  if (exported.toolCalls.length >= MIN_COMPLEX_TOOL_CALLS) {
    reasons.push(`${exported.toolCalls.length} tool calls`);
  }
  if (exported.toolResults.some((result) => result.success === false)) {
    reasons.push('tool failure observed');
  }
  if ((exported.run.durationMs ?? 0) >= 120_000) {
    reasons.push('long-running task');
  }
  if (exported.run.artifactCount > 0) {
    reasons.push(`${exported.run.artifactCount} artifact(s)`);
  }
  if (exported.run.status === 'failed') {
    reasons.push('failed run');
  }
  return {
    eventCount: exported.events.length,
    isComplex: reasons.length > 0,
    reasons,
  };
}

function buildToolStats(
  calls: RunTrajectoryExportToolCall[],
  results: RunTrajectoryExportToolResult[],
): LearningToolStat[] {
  const stats = new Map<string, LearningToolStat>();
  for (const call of calls) {
    const existing = stats.get(call.toolName) ?? {
      failureCount: 0,
      successCount: 0,
      toolName: call.toolName,
      totalDurationMs: 0,
      useCount: 0,
    };
    existing.useCount += 1;
    stats.set(call.toolName, existing);
  }
  for (const result of results) {
    const existing = stats.get(result.toolName) ?? {
      failureCount: 0,
      successCount: 0,
      toolName: result.toolName,
      totalDurationMs: 0,
      useCount: 0,
    };
    if (result.success === false) {
      existing.failureCount += 1;
    } else if (result.success === true) {
      existing.successCount += 1;
    }
    if (typeof result.durationMs === 'number') {
      existing.totalDurationMs += result.durationMs;
    }
    stats.set(result.toolName, existing);
  }
  return [...stats.values()]
    .map((stat) => ({
      ...stat,
      averageDurationMs: stat.useCount > 0 && stat.totalDurationMs > 0
        ? Math.round(stat.totalDurationMs / stat.useCount)
        : undefined,
    }))
    .sort((left, right) => right.useCount - left.useCount || left.toolName.localeCompare(right.toolName));
}

function buildFrictionPoints(exported: RunTrajectoryExport): LearningFrictionPoint[] {
  const points: LearningFrictionPoint[] = [];
  for (const result of exported.toolResults) {
    if (result.success === false) {
      points.push({
        detail: `${result.toolName} failed and required attention`,
        evidence: result.error !== undefined ? formatInline(result.error) : `tool result #${result.sequence}`,
        severity: 'high',
        toolName: result.toolName,
      });
    }
    if (typeof result.durationMs === 'number' && result.durationMs >= 15_000) {
      points.push({
        detail: `${result.toolName} was slow`,
        evidence: `${result.durationMs}ms`,
        severity: 'medium',
        toolName: result.toolName,
      });
    }
  }

  const missingResults = Math.max(0, exported.toolCalls.length - exported.toolResults.length);
  if (missingResults > 0) {
    points.push({
      detail: 'Some tool calls did not have matching recorded results',
      evidence: `${missingResults} missing result(s)`,
      severity: 'medium',
    });
  }

  return points;
}

function buildEffectivePatterns(exported: RunTrajectoryExport, sequence: string[]): LearningPattern[] {
  const patterns: LearningPattern[] = [];
  const successfulTools = new Set(
    exported.toolResults
      .filter((result) => result.success !== false)
      .map((result) => result.toolName),
  );

  const topWindow = firstStableWindow(sequence);
  if (topWindow.length >= MIN_PATTERN_SEQUENCE_LENGTH) {
    patterns.push({
      confidence: successfulTools.size >= Math.max(1, Math.floor(topWindow.length * 0.6)) ? 'medium' : 'low',
      detail: 'Reusable tool choreography observed',
      evidence: `run ${exported.run.runId}`,
      toolSequence: topWindow,
    });
  }

  if (sequence.includes('search') && sequence.includes('view_file')) {
    patterns.push({
      confidence: 'high',
      detail: 'Repo investigation used search before targeted file reads',
      evidence: 'search and view_file both appeared in the trajectory',
      toolSequence: ['search', 'view_file'],
    });
  }

  const testCall = exported.toolCalls.find((call) =>
    call.toolName === 'bash' && typeof call.command === 'string' && /\b(test|vitest|jest|typecheck|lint|build)\b/i.test(call.command),
  );
  if (testCall) {
    patterns.push({
      confidence: 'high',
      detail: 'Verification command was part of the trajectory',
      evidence: testCall.command ?? `tool call #${testCall.sequence}`,
      toolSequence: ['bash'],
    });
  }

  return dedupePatterns(patterns);
}

function buildRedundantPatterns(sequence: string[]): LearningPattern[] {
  const patterns: LearningPattern[] = [];
  for (let index = 1; index < sequence.length; index++) {
    if (sequence[index] === sequence[index - 1]) {
      patterns.push({
        confidence: 'medium',
        detail: `Consecutive ${sequence[index]} calls may be collapsible`,
        evidence: `positions ${index} and ${index + 1}`,
        toolSequence: [sequence[index - 1]!, sequence[index]!],
      });
    }
  }

  const counts = new Map<string, number>();
  for (const name of sequence) counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const [name, count] of counts) {
    if (count >= 4) {
      patterns.push({
        confidence: 'low',
        detail: `${name} appeared ${count} times; check whether a skill could batch the repeated setup`,
        evidence: `${count} uses in one run`,
        toolSequence: [name],
      });
    }
  }

  return dedupePatterns(patterns);
}

function buildLessonCandidates(
  exported: RunTrajectoryExport,
  frictionPoints: LearningFrictionPoint[],
  effectivePatterns: LearningPattern[],
  redundantPatterns: LearningPattern[],
): LearningLessonCandidate[] {
  const lessons: LearningLessonCandidate[] = [];
  if (effectivePatterns.some((pattern) => pattern.detail.includes('search before targeted file reads'))) {
    lessons.push({
      category: 'PATTERN',
      content: 'For repository work, start with search and then read only the targeted files before editing.',
      context: `Derived from run ${exported.run.runId}`,
    });
  }

  if (effectivePatterns.some((pattern) => pattern.detail.includes('Verification command'))) {
    lessons.push({
      category: 'RULE',
      content: 'Do not mark a coding task complete until a relevant real verification command has run.',
      context: `Derived from run ${exported.run.runId}`,
    });
  }

  if (frictionPoints.some((point) => point.severity === 'high')) {
    lessons.push({
      category: 'PATTERN',
      content: 'When a tool fails, preserve the exact error, adjust the smallest input, and retry with the same real path instead of switching to a mock path.',
      context: `Derived from run ${exported.run.runId}`,
    });
  }

  if (redundantPatterns.length > 0) {
    lessons.push({
      category: 'INSIGHT',
      content: 'Repeated identical tool calls in one trajectory are a signal to batch the setup or promote the sequence into a reviewed skill.',
      context: `Derived from run ${exported.run.runId}`,
    });
  }

  return dedupeLessons(lessons).slice(0, 4);
}

function buildSkillCandidates(
  exported: RunTrajectoryExport,
  effectivePatterns: LearningPattern[],
): LearningSkillCandidate[] {
  const candidates: LearningSkillCandidate[] = [];
  for (const pattern of effectivePatterns) {
    if (pattern.toolSequence.length < MIN_PATTERN_SEQUENCE_LENGTH) continue;
    const skillName = `learned-${slugify(pattern.toolSequence.join('-'))}`;
    const skillPath = toPosix(path.join(SKILL_CANDIDATE_ROOT, skillName, 'SKILL.md'));
    const reviewManifestPath = toPosix(path.join(SKILL_CANDIDATE_ROOT, skillName, 'candidate-review.json'));
    candidates.push({
      eligible: false,
      evidenceRunIds: [],
      promotionThreshold: LEARNING_SKILL_PROMOTION_THRESHOLD,
      proofBackedSuccessCount: 0,
      proofCommands: [],
      gradedTasks: [],
      proofStatus: 'missing',
      reason: `Observed in ${exported.run.runId}: ${pattern.detail}. Awaiting repeated proof-backed runs.`,
      reviewManifestPath,
      skillName,
      skillPath,
      toolSequence: pattern.toolSequence,
      title: `${pattern.toolSequence.join(' -> ')} workflow candidate`,
    });
  }
  return candidates.slice(0, 2);
}

function updateLearningPatternLibrary(
  retrospective: LearningRetrospective,
  workDir: string,
  proofEvidence: LearningRunProofEvidence,
): LearningPatternLibrary {
  const filePath = path.join(workDir, LEARNING_DIR, 'pattern-library.json');
  const library = readPatternLibrary(filePath);
  const now = new Date().toISOString();
  const proofStatus = proofEvidence.status;
  const proofCommands = proofEvidence.commands;

  for (const candidate of retrospective.skillCandidates) {
    const key = patternKey(candidate.toolSequence);
    const existing = library.patterns.find((pattern) => pattern.key === key);
    const isProofBackedSuccess = retrospective.run.status === 'completed' && proofStatus === 'proven';
    if (existing) {
      const evidenceRunIds = Array.isArray(existing.evidenceRunIds) ? existing.evidenceRunIds : [];
      const existingProofCommands = Array.isArray(existing.proofCommands) ? existing.proofCommands : [];
      if (isProofBackedSuccess && !evidenceRunIds.includes(retrospective.run.runId)) {
        evidenceRunIds.push(retrospective.run.runId);
        existing.proofBackedSuccessCount = (existing.proofBackedSuccessCount ?? 0) + 1;
        existing.proofCommands = mergeLearningProofCommands(existingProofCommands, proofCommands);
      } else {
        existing.proofCommands = existingProofCommands.slice(-20);
      }
      existing.evidenceRunIds = evidenceRunIds.slice(-10);
      existing.observationCount += 1;
      existing.lastSeenAt = now;
      existing.lastSeenRunId = retrospective.run.runId;
      existing.lastProofStatus = proofStatus;
      existing.successCount += retrospective.run.status === 'completed' ? 1 : 0;
      existing.failureCount += retrospective.run.status === 'failed' ? 1 : 0;
      existing.status = classifyPatternStatus(existing);
      existing.candidateSkillName = candidate.skillName;
      existing.candidateSkillPath = candidate.skillPath;
    } else {
      library.patterns.push({
        key,
        candidateSkillName: candidate.skillName,
        candidateSkillPath: candidate.skillPath,
        evidenceRunIds: isProofBackedSuccess ? [retrospective.run.runId] : [],
        failureCount: retrospective.run.status === 'failed' ? 1 : 0,
        firstSeenAt: now,
        lastSeenAt: now,
        lastSeenRunId: retrospective.run.runId,
        lastProofStatus: proofStatus,
        observationCount: 1,
        proofBackedSuccessCount: isProofBackedSuccess ? 1 : 0,
        proofCommands: isProofBackedSuccess ? proofCommands.slice(-20) : [],
        status: 'observed',
        successCount: retrospective.run.status === 'completed' ? 1 : 0,
        toolSequence: candidate.toolSequence,
      });
    }
  }

  for (const pattern of library.patterns) {
    pattern.status = classifyPatternStatus(pattern);
  }
  library.updatedAt = now;
  writeJsonFile(filePath, library);
  return library;
}

function applyLearningSkillPromotionEvidence(
  candidates: LearningSkillCandidate[],
  library: LearningPatternLibrary,
): LearningSkillCandidate[] {
  return candidates.map((candidate) => {
    const record = library.patterns.find((pattern) => pattern.key === patternKey(candidate.toolSequence));
    const proofBackedSuccessCount = record?.proofBackedSuccessCount ?? 0;
    const promotionThreshold = candidate.promotionThreshold || LEARNING_SKILL_PROMOTION_THRESHOLD;
    const evidenceRunIds = Array.isArray(record?.evidenceRunIds) ? record.evidenceRunIds : [];
    const proofCommands = Array.isArray(record?.proofCommands) ? record.proofCommands : candidate.proofCommands;
    const gradedTasks = deriveSkillGradedTasks({
      ...candidate,
      proofCommands,
    });
    const proofStatus = record?.lastProofStatus ?? candidate.proofStatus ?? 'missing';
    const eligible = proofBackedSuccessCount >= promotionThreshold;
    const proofSummary = `${proofBackedSuccessCount}/${promotionThreshold} proof-backed successful run(s)`;
    return {
      ...candidate,
      eligible,
      evidenceRunIds,
      promotionThreshold,
      proofBackedSuccessCount,
      proofCommands,
      gradedTasks,
      proofStatus,
      reason: eligible
        ? `${proofSummary} met the Learning Agent promotion threshold.`
        : `${proofSummary}; keep as a candidate until repeated real runs prove it.`,
    };
  });
}

function materializeLearningSkillCandidates(
  retrospective: LearningRetrospective,
  workDir: string,
): LearningSkillCandidate[] {
  const materialized: LearningSkillCandidate[] = [];
  for (const candidate of retrospective.skillCandidates) {
    try {
      const skillMarkdown = renderLearningSkillCandidateMarkdown(retrospective, candidate);
      const absoluteSkillPath = resolveInsideRoot(workDir, candidate.skillPath);
      const absoluteReviewPath = resolveInsideRoot(
        workDir,
        candidate.reviewManifestPath ?? toPosix(path.join(SKILL_CANDIDATE_ROOT, candidate.skillName, 'candidate-review.json')),
      );
      const parsed = parseSkillFile(skillMarkdown, candidate.skillPath, 'workspace');
      const validation = validateSkill(parsed);
      if (!validation.valid) {
        logger.debug('Learning Agent: generated skill candidate failed validation', {
          skillName: candidate.skillName,
          errors: validation.errors,
        });
        continue;
      }

      const manifest: LearningSkillCandidateReviewManifest = {
        approvalRequired: true,
        candidateId: `learning-skill-${stableHash(`${retrospective.run.runId}|${candidate.skillName}`)}`,
        eligible: candidate.eligible,
        evidenceRunIds: candidate.evidenceRunIds,
        generatedAt: retrospective.generatedAt,
        promotionThreshold: candidate.promotionThreshold,
        proofBackedSuccessCount: candidate.proofBackedSuccessCount,
        proofCommands: candidate.proofCommands,
        gradedTasks: candidate.gradedTasks,
        proofStatus: candidate.proofStatus,
        schemaVersion: LEARNING_SKILL_CANDIDATE_REVIEW_SCHEMA_VERSION,
        skillName: candidate.skillName,
        sourceRunId: retrospective.run.runId,
        status: candidate.eligible ? 'awaiting_human_approval' : 'not_eligible',
        successfulRunCount: candidate.proofBackedSuccessCount,
        toolSequence: candidate.toolSequence,
      };

      fs.mkdirSync(path.dirname(absoluteSkillPath), { recursive: true });
      fs.mkdirSync(path.dirname(absoluteReviewPath), { recursive: true });
      fs.writeFileSync(absoluteSkillPath, `${skillMarkdown.trimEnd()}\n`, 'utf-8');
      fs.writeFileSync(absoluteReviewPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
      materialized.push(candidate);
    } catch (error) {
      logger.debug('Learning Agent: failed to materialize skill candidate', {
        skillName: candidate.skillName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return materialized;
}

function proposeRetrospectiveLessons(retrospective: LearningRetrospective, workDir: string): number {
  if (retrospective.lessonCandidates.length === 0) return 0;
  const queue = getLessonCandidateQueue(workDir);
  let count = 0;
  for (const lesson of retrospective.lessonCandidates) {
    try {
      const { deduped } = queue.propose({
        category: lesson.category,
        content: lesson.content,
        context: lesson.context,
        source: 'self_observed',
        provenance: {
          runId: retrospective.run.runId,
          note: 'Learning Agent retrospective',
        },
      });
      if (!deduped) count += 1;
    } catch (error) {
      logger.debug('Learning Agent: failed to propose lesson candidate', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return count;
}

function recordSelectedSkillUsage(
  store: RunStore,
  runId: string,
  workDir: string,
  retrospective: LearningRetrospective,
): number {
  const selectedSkills = new Set<string>();
  for (const event of store.getEvents(runId)) {
    if (event.type !== 'skill_selected') continue;
    const skillName = typeof event.data.skillName === 'string' ? event.data.skillName.trim() : '';
    if (skillName) selectedSkills.add(skillName);
  }

  for (const skillName of selectedSkills) {
    recordLearningSkillUsage(skillName, {
      durationMs: retrospective.run.durationMs,
      error: retrospective.run.status === 'failed' ? 'Run failed after skill selection' : undefined,
      runId,
      success: retrospective.run.status === 'completed',
      usedAt: retrospective.generatedAt,
    }, workDir);
  }

  return selectedSkills.size;
}

function readLearningRunProofEvidence(store: RunStore, runId: string): LearningRunProofEvidence {
  const raw = store.getArtifact(runId, PROOF_LEDGER_ARTIFACT);
  if (!raw) return { commands: [], status: 'missing' };
  try {
    const parsed = JSON.parse(raw) as {
      commands?: unknown;
      status?: unknown;
      tests?: { commands?: unknown };
    };
    const status = normalizeLearningProofStatus(parsed.status);
    const testCommands = normalizeLearningProofCommands(parsed.tests?.commands, runId);
    const commands = testCommands.length > 0
      ? testCommands
      : normalizeLearningProofCommands(parsed.commands, runId);
    return { commands, status };
  } catch {
    return { commands: [], status: 'missing' };
  }
}

function normalizeLearningProofStatus(status: unknown): LearningSkillProofStatus {
  if (status === 'proven' || status === 'incomplete' || status === 'failed') {
    return status;
  }
  return 'missing';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLearningProofCommands(commands: unknown, runId: string): LearningSkillProofCommand[] {
  if (!Array.isArray(commands)) return [];
  return commands
    .map((command): LearningSkillProofCommand | null => {
      if (!isRecord(command)) return null;
      const sequence = typeof command.sequence === 'number' && Number.isFinite(command.sequence)
        ? command.sequence
        : undefined;
      const toolName = typeof command.toolName === 'string' && command.toolName.trim()
        ? command.toolName.trim()
        : undefined;
      if (sequence === undefined || !toolName) return null;
      return {
        command: typeof command.command === 'string' && command.command.trim()
          ? command.command.trim()
          : undefined,
        durationMs: typeof command.durationMs === 'number' && Number.isFinite(command.durationMs)
          ? command.durationMs
          : undefined,
        isTest: command.isTest === true,
        runId,
        sequence,
        success: typeof command.success === 'boolean' ? command.success : undefined,
        toolName,
      };
    })
    .filter((command): command is LearningSkillProofCommand => command !== null)
    .slice(-10);
}

function mergeLearningProofCommands(
  existing: LearningSkillProofCommand[],
  next: LearningSkillProofCommand[],
): LearningSkillProofCommand[] {
  const seen = new Set<string>();
  const merged: LearningSkillProofCommand[] = [];
  for (const command of [...existing, ...next]) {
    const key = `${command.runId}|${command.sequence}|${command.toolName}|${command.command ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(command);
  }
  return merged.slice(-20);
}

export function deriveSkillGradedTasks(candidate: Pick<
  LearningSkillCandidate,
  'proofCommands' | 'skillName'
>): LearningSkillGradedTask[] {
  const seen = new Set<string>();
  const tasks: LearningSkillGradedTask[] = [];
  for (const proofCommand of candidate.proofCommands) {
    const command = proofCommand.command?.trim();
    if (!command || proofCommand.success === false) continue;
    const key = `${proofCommand.runId}|${command}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push({
      command,
      expected: 'pass',
      id: `graded-${stableHash(`${candidate.skillName}|${proofCommand.runId}|${proofCommand.sequence}|${command}`)}`,
      isTest: proofCommand.isTest,
      sourceRunId: proofCommand.runId,
      timeoutMs: inferGradedTaskTimeoutMs(proofCommand),
      toolName: proofCommand.toolName,
    });
  }
  return tasks.slice(-5);
}

function inferGradedTaskTimeoutMs(command: LearningSkillProofCommand): number | undefined {
  if (!command.durationMs || command.durationMs <= 0) return undefined;
  return Math.max(30_000, Math.ceil(command.durationMs * 3));
}

function renderLearningSkillCandidateMarkdown(
  retrospective: LearningRetrospective,
  candidate: LearningSkillCandidate,
): string {
  const title = toTitleCase(candidate.skillName);
  const category = inferHermesCategory(candidate);
  const tags = buildHermesTags(candidate);

  return [
    '---',
    `name: ${candidate.skillName}`,
    `description: Reusable ${candidate.toolSequence.join(' -> ')} workflow learned from real Code Buddy runs.`,
    'version: 1.0.0',
    'author: Code Buddy Learning Agent',
    'license: MIT',
    'platforms: [linux, macos]',
    'metadata:',
    '  hermes:',
    `    tags: [${tags.join(', ')}]`,
    `    category: ${category}`,
    '---',
    '',
    `# ${title}`,
    '',
    `Status: ${candidate.eligible ? 'eligible for human review' : 'not eligible yet'}`,
    `Reason: ${candidate.reason}`,
    `Source run: ${retrospective.run.runId}`,
    `Successful runs: ${candidate.proofBackedSuccessCount}`,
    `Promotion threshold: ${candidate.promotionThreshold}`,
    `Proof status: ${candidate.proofStatus}`,
    '',
    '## When to Use',
    `Use this skill when a future task needs the same proven tool sequence: ${candidate.toolSequence.join(' -> ')}.`,
    `It is based on run ${retrospective.run.runId} and should only be installed after repeated proof-backed runs plus human review confirm the pattern is broadly reusable.`,
    '',
    '## Promotion Evidence',
    `- Proof-backed successful runs: ${candidate.proofBackedSuccessCount}/${candidate.promotionThreshold}.`,
    `- Latest proof status: ${candidate.proofStatus}.`,
    ...(candidate.evidenceRunIds.length > 0
      ? candidate.evidenceRunIds.map((runId) => `- Evidence run: ${runId}.`)
      : ['- Evidence run: none yet.']),
    ...(candidate.proofCommands.length > 0
      ? candidate.proofCommands.map((command) => `- ${formatLearningProofCommand(command)}`)
      : ['- Proof command: none yet.']),
    '',
    '## Graded Tasks',
    ...(candidate.gradedTasks.length > 0
      ? candidate.gradedTasks.map((task) => `- ${formatLearningGradedTask(task)}`)
      : ['- No replayable graded task yet; wait for proof commands with concrete shell text.']),
    '',
    '## Procedure',
    ...candidate.toolSequence.map((toolName, index) => `${index + 1}. Use \`${toolName}\` for the corresponding verified step from the trajectory; keep the same evidence boundary and real-path behavior.`),
    `${candidate.toolSequence.length + 1}. Capture the result, errors, and verification evidence before marking the task complete.`,
    '',
    '## Pitfalls',
    '- Do not install this candidate blindly from one trajectory; review and edit it first.',
    '- Do not use the sequence when the task has a different safety boundary, provider, workspace, or approval requirement.',
    '- Do not replace real filesystem, shell, browser, or repository verification with mocks just to make the flow pass.',
    '',
    '## Verification',
    `- The final task result is backed by a real verification command or real run artifact from run ${retrospective.run.runId}.`,
    `- The retrospective evidence remains traceable: ${retrospective.summary}`,
    '- The installed skill still starts with valid Hermes SKILL.md frontmatter and passes local skill parsing.',
    '',
    '## Quick Reference',
    `buddy tools skill-candidate inspect ${candidate.skillPath.replace(/\/SKILL\.md$/i, '')}`,
    `Proof commands: ${candidate.proofCommands.length}`,
    '',
  ].join('\n');
}

function formatLearningProofCommand(command: LearningSkillProofCommand): string {
  const result = command.success === undefined ? 'unknown' : command.success ? 'passed' : 'failed';
  const duration = command.durationMs === undefined ? '' : ` in ${command.durationMs}ms`;
  const commandText = escapeInlineMarkdownCode(command.command ?? command.toolName);
  return `Proof command ${command.runId} #${command.sequence} ${result}${duration}: \`${commandText}\`.`;
}

function formatLearningGradedTask(task: LearningSkillGradedTask): string {
  const timeout = task.timeoutMs === undefined ? '' : ` timeout=${task.timeoutMs}ms`;
  const test = task.isTest ? ' test' : '';
  return `Graded task ${task.id} from ${task.sourceRunId}${test}${timeout}: \`${escapeInlineMarkdownCode(task.command)}\` must ${task.expected}.`;
}

function escapeInlineMarkdownCode(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/`/g, '\\`');
}

function buildHermesTags(candidate: LearningSkillCandidate): string[] {
  const tags = ['learning-agent', 'review-required', ...candidate.toolSequence.map(slugify)];
  return [...new Set(tags)].slice(0, 6);
}

function inferHermesCategory(candidate: LearningSkillCandidate): string {
  const sequence = candidate.toolSequence.join(' ').toLowerCase();
  if (/\b(test|vitest|playwright|verify|bash|terminal)\b/.test(sequence)) return 'testing';
  if (/\b(search|view_file|read_file|patch|write_file|str_replace)\b/.test(sequence)) return 'refactoring';
  if (/\bsecurity|scan|secret\b/.test(sequence)) return 'security';
  if (/\bdeploy|docker|kubernetes|cron\b/.test(sequence)) return 'devops';
  if (/\bbrowser|web_extract|web_search\b/.test(sequence)) return 'web_development';
  return 'general';
}

function toTitleCase(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function summarizeRetrospective(
  exported: RunTrajectoryExport,
  frictionPoints: LearningFrictionPoint[],
  effectivePatterns: LearningPattern[],
  redundantPatterns: LearningPattern[],
): string {
  const parts = [
    `${exported.toolCalls.length} tool call(s) were recorded`,
    `${frictionPoints.length} friction point(s)`,
    `${effectivePatterns.length} reusable pattern(s)`,
    `${redundantPatterns.length} redundancy signal(s)`,
  ];
  return parts.join(', ') + '.';
}

function firstStableWindow(sequence: string[]): string[] {
  const window = sequence.filter((name) => name !== 'unknown_tool').slice(0, 5);
  return [...new Set(window)].length >= MIN_PATTERN_SEQUENCE_LENGTH ? window : [];
}

function dedupePatterns(patterns: LearningPattern[]): LearningPattern[] {
  const seen = new Set<string>();
  return patterns.filter((pattern) => {
    const key = `${pattern.detail}|${pattern.toolSequence.join('>')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeLessons(lessons: LearningLessonCandidate[]): LearningLessonCandidate[] {
  const seen = new Set<string>();
  return lessons.filter((lesson) => {
    const key = `${lesson.category}|${lesson.content.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classifyPatternStatus(record: LearningPatternRecord): PatternStatus {
  const successRate = record.observationCount === 0 ? 0 : record.successCount / record.observationCount;
  const failureRate = record.observationCount === 0 ? 0 : record.failureCount / record.observationCount;
  if (record.observationCount >= 2 && failureRate >= 0.6) return 'deprecated';
  if (record.observationCount >= 2 && successRate >= 0.75) return 'reinforced';
  return 'observed';
}

function readPatternLibrary(filePath: string): LearningPatternLibrary {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as LearningPatternLibrary;
    if (parsed.schemaVersion === LEARNING_PATTERN_LIBRARY_SCHEMA_VERSION && Array.isArray(parsed.patterns)) {
      return parsed;
    }
  } catch {
    // Fall through to a fresh file.
  }
  return {
    schemaVersion: LEARNING_PATTERN_LIBRARY_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    patterns: [],
  };
}

function readSkillUsageFile(filePath: string): LearningSkillUsageFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as LearningSkillUsageFile;
    if (parsed.schemaVersion === LEARNING_SKILL_USAGE_SCHEMA_VERSION && Array.isArray(parsed.skills)) {
      parsed.skills = parsed.skills.map(normalizeLearningSkillUsageRecord);
      return parsed;
    }
  } catch {
    // Fall through to a fresh file.
  }
  return {
    schemaVersion: LEARNING_SKILL_USAGE_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    skills: [],
  };
}

function normalizeLearningSkillUsageRecord(record: LearningSkillUsageRecord): LearningSkillUsageRecord {
  const score = scoreLearningSkillUsage({
    failureCount: record.failureCount,
    invocationCount: record.invocationCount,
    lastError: record.lastError,
    runId: record.lastRunId,
    successCount: record.successCount,
  });
  const scoreHistory = Array.isArray(record.scoreHistory) && record.scoreHistory.length > 0
    ? record.scoreHistory
    : [{
        failureCount: record.failureCount,
        invocationCount: record.invocationCount,
        recommendation: score.recommendation,
        ...(record.lastRunId ? { runId: record.lastRunId } : {}),
        score: score.score,
        scoredAt: record.lastUsedAt,
        successCount: record.successCount,
        reason: score.reason,
      }];

  return {
    ...record,
    deprecated: record.deprecated ?? (score.recommendation === 'deprecate'),
    lastMutation: record.lastMutation ?? record.mutationHistory?.at(-1),
    mutationCount: record.mutationCount ?? record.mutationHistory?.length ?? 0,
    mutationHistory: Array.isArray(record.mutationHistory) ? record.mutationHistory : [],
    nextAction: record.nextAction ?? score.nextAction,
    recommendation: record.recommendation ?? score.recommendation,
    reinforced: record.reinforced ?? (score.recommendation === 'reinforce'),
    score: record.score ?? score.score,
    scoreHistory,
    scoreReason: record.scoreReason ?? score.reason,
  };
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function patternKey(sequence: string[]): string {
  return createHash('sha256').update(sequence.join('\0')).digest('hex').slice(0, 16);
}

function stableHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function normalizeSkillName(value: string): string {
  return slugify(value) || 'unnamed-skill';
}

function normalizeMutationAction(value: string): string {
  return slugify(value) || 'mutation';
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'workflow';
}

function normalizeTimestamp(value: number | string | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value.trim()) return value.trim();
  return new Date().toISOString();
}

function resolveInsideRoot(rootDir: string, relativePath: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, relativePath.replace(/\\/g, '/'));
  const normalizedRoot = normalizeForCompare(resolvedRoot);
  const normalizedPath = normalizeForCompare(resolvedPath);
  if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Learning Agent path escapes workspace: ${relativePath}`);
  }
  return resolvedPath;
}

function normalizeForCompare(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function formatInline(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (text ?? '').replace(/\s+/g, ' ').slice(0, 160);
}
