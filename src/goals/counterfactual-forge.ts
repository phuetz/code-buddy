import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getCodeBuddyPath } from '../utils/codebuddy-home.js';
import { deriveIntentProgress, type IntentProgressSummary } from './criterion-progress.js';
import type { IntentGraph } from './intent-graph.js';
import type { ProofAssurance, ProofRecord } from './proof-ledger.js';

export type ForgeBranchStatus = 'planned' | 'evaluated' | 'selected' | 'rejected';

export interface ForgeBranchMetrics {
  proofCoverage: number;
  assurance: number;
  quality: number;
  efficiency: number;
  latencyMs?: number;
  costUsd?: number;
  regressions: string[];
  score: number;
  eligible: boolean;
}

export interface CounterfactualBranch {
  schemaVersion: 1;
  id: string;
  goalId: string;
  intentRevision: string;
  label: string;
  hypothesis: string;
  strategy: string;
  parentBranchId?: string;
  status: ForgeBranchStatus;
  createdAt: string;
  updatedAt: string;
  proofIds: string[];
  criterionIds: string[];
  artifactHashes: string[];
  metrics?: ForgeBranchMetrics;
}

export interface CreateCounterfactualBranchInput {
  label: string;
  hypothesis: string;
  strategy: string;
  parentBranchId?: string;
}

export interface EvaluateCounterfactualBranchInput {
  graph: IntentGraph;
  proofs: ProofRecord[];
  proofIds?: string[];
  quality?: number;
  latencyMs?: number;
  costUsd?: number;
  regressions?: string[];
}

interface ForgeEvent {
  schemaVersion: 1;
  type: 'branch.snapshot' | 'winner.selected';
  at: string;
  branch?: CounterfactualBranch;
  branchId?: string;
}

export interface CounterfactualForgeOptions {
  storeDir?: string;
  now?: () => Date;
  idFactory?: () => string;
}

function safeGoalId(goalId: string): string {
  const clean = goalId.trim();
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(clean)) throw new Error('invalid goal id for Counterfactual Forge');
  return clean;
}

function bounded01(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function assuranceValue(assurance: ProofAssurance): number {
  if (assurance === 'deterministic') return 1;
  if (assurance === 'independent') return 0.9;
  if (assurance === 'judge') return 0.5;
  return 0.1;
}

function computeAssurance(progress: IntentProgressSummary): number {
  const passed = progress.criteria.filter((criterion) => criterion.status === 'passed');
  if (passed.length === 0) return 0;
  return passed.reduce((sum, criterion) => sum + assuranceValue(criterion.assurance), 0) / passed.length;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Proof-driven counterfactual comparison. Branches share one immutable intent
 * revision and can only win from evidence attached to that exact contract.
 */
export class CounterfactualForge {
  private readonly goalId: string;
  private readonly storeDir: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(goalId: string, options: CounterfactualForgeOptions = {}) {
    this.goalId = safeGoalId(goalId);
    this.storeDir = options.storeDir ?? getCodeBuddyPath('forge');
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  getFilePath(): string {
    return path.join(this.storeDir, `${this.goalId}.jsonl`);
  }

  create(graph: IntentGraph, input: CreateCounterfactualBranchInput): CounterfactualBranch {
    if (graph.goalId !== this.goalId) throw new Error('intent graph does not match forge goal');
    const label = input.label.trim();
    const hypothesis = input.hypothesis.trim();
    const strategy = input.strategy.trim();
    if (!label || !hypothesis || !strategy) throw new Error('label, hypothesis and strategy are required');
    if (input.parentBranchId && !this.get(input.parentBranchId)) {
      throw new Error(`parent branch not found: ${input.parentBranchId}`);
    }
    const createdAt = this.now().toISOString();
    const branch: CounterfactualBranch = {
      schemaVersion: 1,
      id: `forge-${this.idFactory()}`,
      goalId: this.goalId,
      intentRevision: graph.contractRevision,
      label: label.slice(0, 120),
      hypothesis: hypothesis.slice(0, 1000),
      strategy: strategy.slice(0, 2000),
      ...(input.parentBranchId ? { parentBranchId: input.parentBranchId } : {}),
      status: 'planned',
      createdAt,
      updatedAt: createdAt,
      proofIds: [],
      criterionIds: [],
      artifactHashes: [],
    };
    this.append({ schemaVersion: 1, type: 'branch.snapshot', at: createdAt, branch });
    return branch;
  }

  evaluate(branchId: string, input: EvaluateCounterfactualBranchInput): CounterfactualBranch {
    const branch = this.get(branchId);
    if (!branch) throw new Error(`forge branch not found: ${branchId}`);
    if (input.graph.goalId !== this.goalId || input.graph.contractRevision !== branch.intentRevision) {
      throw new Error('intent revision changed; create a fresh branch against the new contract');
    }
    const selectedIds = input.proofIds ? new Set(input.proofIds) : null;
    const proofs = input.proofs.filter(
      (proof) => proof.goalId === this.goalId && (!selectedIds || selectedIds.has(proof.id)),
    );
    const progress = deriveIntentProgress(input.graph, proofs);
    const assurance = computeAssurance(progress);
    const quality = bounded01(input.quality, progress.coverage);
    const latencyMs = typeof input.latencyMs === 'number' && input.latencyMs >= 0 ? input.latencyMs : undefined;
    const costUsd = typeof input.costUsd === 'number' && input.costUsd >= 0 ? input.costUsd : undefined;
    const efficiency = 1 / (1 + (latencyMs ?? 0) / 5000 + (costUsd ?? 0) * 10);
    const regressions = unique(input.regressions ?? []).slice(0, 50);
    const regressionPenalty = Math.min(0.6, regressions.length * 0.15);
    const score = Math.max(
      0,
      Math.min(1, progress.coverage * 0.5 + assurance * 0.25 + quality * 0.2 + efficiency * 0.05 - regressionPenalty),
    );
    const evaluated: CounterfactualBranch = {
      ...branch,
      status: 'evaluated',
      updatedAt: this.now().toISOString(),
      proofIds: proofs.map((proof) => proof.id),
      criterionIds: progress.criteria
        .filter((criterion) => criterion.status === 'passed')
        .map((criterion) => criterion.criterionId),
      artifactHashes: unique(
        proofs.flatMap((proof) => proof.artifactRefs?.map((artifact) => artifact.sha256) ?? []),
      ),
      metrics: {
        proofCoverage: progress.coverage,
        assurance,
        quality,
        efficiency,
        ...(latencyMs !== undefined ? { latencyMs } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
        regressions,
        score,
        eligible: progress.total > 0 && progress.coverage === 1 && progress.failed === 0 && regressions.length === 0,
      },
    };
    this.append({ schemaVersion: 1, type: 'branch.snapshot', at: evaluated.updatedAt, branch: evaluated });
    return evaluated;
  }

  select(branchId?: string): CounterfactualBranch | null {
    const branches = this.list();
    const candidate = branchId
      ? branches.find((branch) => branch.id === branchId) ?? null
      : branches
          .filter((branch) => branch.metrics?.eligible)
          .sort((left, right) => (right.metrics?.score ?? 0) - (left.metrics?.score ?? 0))[0] ?? null;
    if (!candidate) return null;
    if (!candidate.metrics?.eligible) throw new Error('forge branch is not eligible: full proof coverage is required');
    const at = this.now().toISOString();
    this.append({ schemaVersion: 1, type: 'winner.selected', at, branchId: candidate.id });
    return { ...candidate, status: 'selected', updatedAt: at };
  }

  get(branchId: string): CounterfactualBranch | null {
    return this.list().find((branch) => branch.id === branchId) ?? null;
  }

  list(): CounterfactualBranch[] {
    const branches = new Map<string, CounterfactualBranch>();
    let winnerId = '';
    for (const event of this.readEvents()) {
      if (event.type === 'branch.snapshot' && event.branch?.goalId === this.goalId) {
        branches.set(event.branch.id, event.branch);
      }
      if (event.type === 'winner.selected' && event.branchId) winnerId = event.branchId;
    }
    return [...branches.values()]
      .map((branch) => ({
        ...branch,
        status: branch.id === winnerId ? 'selected' as const : branch.status === 'selected' ? 'evaluated' as const : branch.status,
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private readEvents(): ForgeEvent[] {
    try {
      const raw = fs.readFileSync(this.getFilePath(), 'utf8');
      return raw.split('\n').flatMap((line) => {
        try {
          const event = JSON.parse(line) as ForgeEvent;
          return event?.schemaVersion === 1 ? [event] : [];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  private append(event: ForgeEvent): void {
    fs.mkdirSync(this.storeDir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(this.getFilePath(), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(this.getFilePath(), 0o600);
  }
}
