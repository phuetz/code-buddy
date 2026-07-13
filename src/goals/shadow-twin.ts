import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getCodeBuddyPath } from '../utils/codebuddy-home.js';
import type { IntentGraph } from './intent-graph.js';

export interface MissionPrediction {
  quality: number;
  latencyMs: number;
  costUsd: number;
}

export interface ReversibilityChecks {
  checkpointTaken: boolean;
  rollbackValidated: boolean;
  noPersistentSideEffects: boolean;
}

export interface ShadowRehearsal {
  schemaVersion: 1;
  id: string;
  goalId: string;
  intentRevision: string;
  bidId: string;
  prediction: MissionPrediction;
  observation: MissionPrediction;
  drift: {
    quality: number;
    latency: number;
    cost: number;
    score: number;
    threshold: number;
  };
  reversibility: ReversibilityChecks;
  status: 'pass' | 'fail';
  journal: string[];
  createdAt: string;
}

export interface RecordShadowRehearsalInput {
  bidId: string;
  prediction: MissionPrediction;
  observation: MissionPrediction;
  reversibility: ReversibilityChecks;
  maxDrift?: number;
}

export interface ShadowTwinStoreOptions {
  storeDir?: string;
  now?: () => Date;
  idFactory?: () => string;
}

function safeGoalId(goalId: string): string {
  const clean = goalId.trim();
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(clean)) throw new Error('invalid goal id for Shadow Twin');
  return clean;
}

function metric(value: number, label: string, max = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`${label} is outside its valid range`);
  }
  return value;
}

function relativeDrift(predicted: number, observed: number): number {
  if (predicted === 0) return observed === 0 ? 0 : 1;
  return Math.min(1, Math.abs(observed - predicted) / predicted);
}

/** Measured rehearsal ledger for one mission. It never fabricates observations. */
export class ShadowTwinStore {
  private readonly goalId: string;
  private readonly storeDir: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(goalId: string, options: ShadowTwinStoreOptions = {}) {
    this.goalId = safeGoalId(goalId);
    this.storeDir = options.storeDir ?? getCodeBuddyPath('shadows');
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  getFilePath(): string {
    return path.join(this.storeDir, `${this.goalId}.jsonl`);
  }

  record(graph: IntentGraph, input: RecordShadowRehearsalInput): ShadowRehearsal {
    if (graph.goalId !== this.goalId) throw new Error('intent graph does not match Shadow Twin');
    const prediction = this.validatePrediction(input.prediction, 'prediction');
    const observation = this.validatePrediction(input.observation, 'observation');
    const threshold = metric(input.maxDrift ?? 0.1, 'maxDrift', 1);
    const quality = Math.abs(observation.quality - prediction.quality);
    const latency = relativeDrift(prediction.latencyMs, observation.latencyMs);
    const cost = relativeDrift(prediction.costUsd, observation.costUsd);
    const score = quality * 0.45 + latency * 0.4 + cost * 0.15;
    const reversible = Object.values(input.reversibility).every(Boolean);
    const status = score <= threshold && reversible ? 'pass' as const : 'fail' as const;
    const at = this.now().toISOString();
    const rehearsal: ShadowRehearsal = {
      schemaVersion: 1,
      id: `shadow-${this.idFactory()}`,
      goalId: this.goalId,
      intentRevision: graph.contractRevision,
      bidId: input.bidId.trim(),
      prediction,
      observation,
      drift: { quality, latency, cost, score, threshold },
      reversibility: input.reversibility,
      status,
      journal: [
        'Shadow rehearsal started',
        'Measured observation received',
        `Prediction drift calculated (${(score * 100).toFixed(1)}%)`,
        reversible ? 'Rollback path verified' : 'Rollback path incomplete',
      ],
      createdAt: at,
    };
    if (!rehearsal.bidId) throw new Error('bidId is required');
    this.append(rehearsal);
    return rehearsal;
  }

  latestForBid(bidId: string): ShadowRehearsal | null {
    return this.list().find((rehearsal) => rehearsal.bidId === bidId) ?? null;
  }

  list(limit = 100): ShadowRehearsal[] {
    try {
      const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 100;
      return fs.readFileSync(this.getFilePath(), 'utf8').split('\n').flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as ShadowRehearsal;
          return parsed?.schemaVersion === 1 && parsed.goalId === this.goalId ? [parsed] : [];
        } catch {
          return [];
        }
      }).slice(-safeLimit).reverse();
    } catch {
      return [];
    }
  }

  private validatePrediction(value: MissionPrediction, prefix: string): MissionPrediction {
    return {
      quality: metric(value.quality, `${prefix}.quality`, 1),
      latencyMs: metric(value.latencyMs, `${prefix}.latencyMs`),
      costUsd: metric(value.costUsd, `${prefix}.costUsd`),
    };
  }

  private append(rehearsal: ShadowRehearsal): void {
    fs.mkdirSync(this.storeDir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(this.getFilePath(), `${JSON.stringify(rehearsal)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.chmodSync(this.getFilePath(), 0o600);
  }
}
