import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getCodeBuddyPath } from '../utils/codebuddy-home.js';
import { deriveIntentProgress } from './criterion-progress.js';
import { buildIntentGraph, type IntentGraph } from './intent-graph.js';
import type { EvidenceArtifactReference } from './evidence-artifact.js';
import type { GoalState } from './goal-state.js';
import type { ProofRecord } from './proof-ledger.js';

export interface ProvenOutcomeCriterion {
  criterionId: string;
  title: string;
  assurance: ProofRecord['assurance'];
  proofIds: string[];
  evidence?: string;
}

export interface ProvenOutcomeRecord {
  schemaVersion: 1;
  id: string;
  goalId: string;
  intentRevision: string;
  goal: string;
  completedAt: string;
  source: string;
  sessionKey?: string;
  trustScore: number;
  criteria: ProvenOutcomeCriterion[];
  proofIds: string[];
  proofHashes: string[];
  artifacts: EvidenceArtifactReference[];
  lessonCandidateId?: string;
}

export interface CaptureProvenOutcomeInput {
  state: GoalState;
  graph?: IntentGraph;
  proofs: ProofRecord[];
  source: string;
  sessionKey?: string;
}

export interface CaptureProvenOutcomeResult {
  outcome: ProvenOutcomeRecord | null;
  reason?: string;
  deduped?: boolean;
}

export interface ProvenOutcomeStoreOptions {
  filePath?: string;
  now?: () => Date;
}

function assuranceScore(assurance: ProofRecord['assurance']): number {
  if (assurance === 'deterministic') return 1;
  if (assurance === 'independent') return 0.9;
  if (assurance === 'judge') return 0.5;
  return 0;
}

function outcomeId(goalId: string, revision: string): string {
  return `outcome-${createHash('sha256').update(`${goalId}\0${revision}`).digest('hex').slice(0, 24)}`;
}

/** Durable memory containing only outcomes supported by strong proof. */
export class ProvenOutcomeStore {
  private readonly filePath: string;
  private readonly now: () => Date;

  constructor(options: ProvenOutcomeStoreOptions = {}) {
    this.filePath = options.filePath ?? getCodeBuddyPath('outcomes', 'proven-outcomes.jsonl');
    this.now = options.now ?? (() => new Date());
  }

  getFilePath(): string {
    return this.filePath;
  }

  capture(input: CaptureProvenOutcomeInput): CaptureProvenOutcomeResult {
    if (input.state.status !== 'done') return { outcome: null, reason: 'goal is not done' };
    const graph = input.graph ?? buildIntentGraph(input.state);
    if (graph.goalId !== input.state.goalId) return { outcome: null, reason: 'intent graph mismatch' };
    const proofs = input.proofs.filter((proof) => proof.goalId === input.state.goalId);
    const finalStrongProof = [...proofs]
      .reverse()
      .find((proof) => proof.status === 'pass' && ['deterministic', 'independent'].includes(proof.assurance));
    if (!finalStrongProof) return { outcome: null, reason: 'no deterministic or independent passing proof' };

    const progress = deriveIntentProgress(graph, proofs);
    if (progress.total > 0 && (progress.coverage < 1 || progress.failed > 0)) {
      return { outcome: null, reason: 'acceptance criteria are not fully proven' };
    }

    const id = outcomeId(input.state.goalId, graph.contractRevision);
    const existing = this.get(id);
    if (existing) return { outcome: existing, deduped: true };
    const criteria = progress.criteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      title: criterion.title,
      assurance: criterion.assurance,
      proofIds: criterion.proofIds,
      ...(criterion.lastEvidence ? { evidence: criterion.lastEvidence } : {}),
    }));
    const criterionAssurance = criteria.length > 0
      ? criteria.reduce((sum, criterion) => sum + assuranceScore(criterion.assurance), 0) / criteria.length
      : assuranceScore(finalStrongProof.assurance);
    const artifacts = new Map<string, EvidenceArtifactReference>();
    for (const proof of proofs) {
      for (const artifact of proof.artifactRefs ?? []) artifacts.set(artifact.sha256, artifact);
    }
    const outcome: ProvenOutcomeRecord = {
      schemaVersion: 1,
      id,
      goalId: input.state.goalId,
      intentRevision: graph.contractRevision,
      goal: input.state.goal,
      completedAt: this.now().toISOString(),
      source: input.source,
      ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
      trustScore: Math.max(0, Math.min(1, (progress.total > 0 ? progress.coverage : 1) * 0.65 + criterionAssurance * 0.35)),
      criteria,
      proofIds: proofs.map((proof) => proof.id),
      proofHashes: proofs.flatMap((proof) => proof.recordHash ? [proof.recordHash] : []),
      artifacts: [...artifacts.values()],
    };
    this.append(outcome);
    return { outcome };
  }

  linkLessonCandidate(outcomeIdValue: string, lessonCandidateId: string): ProvenOutcomeRecord | null {
    const outcome = this.get(outcomeIdValue);
    const candidateId = lessonCandidateId.trim();
    if (!outcome || !candidateId) return null;
    const linked = { ...outcome, lessonCandidateId: candidateId };
    this.append(linked);
    return linked;
  }

  get(id: string): ProvenOutcomeRecord | null {
    return this.list().find((outcome) => outcome.id === id) ?? null;
  }

  list(goalId?: string, limit = 100): ProvenOutcomeRecord[] {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const snapshots = raw.split('\n').flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as ProvenOutcomeRecord;
          return parsed?.schemaVersion === 1 && (!goalId || parsed.goalId === goalId) ? [parsed] : [];
        } catch {
          return [];
        }
      });
      const outcomes = new Map<string, ProvenOutcomeRecord>();
      for (const outcome of snapshots) {
        outcomes.delete(outcome.id);
        outcomes.set(outcome.id, outcome);
      }
      const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 100;
      return [...outcomes.values()].slice(-safeLimit).reverse();
    } catch {
      return [];
    }
  }

  private append(outcome: ProvenOutcomeRecord): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    fs.appendFileSync(this.filePath, `${JSON.stringify(outcome)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(this.filePath, 0o600);
  }
}
