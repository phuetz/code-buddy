import fs from 'node:fs';
import path from 'node:path';
import { getCodeBuddyPath } from '../utils/codebuddy-home.js';
import type { IntentGraph } from './intent-graph.js';

export type MissionPrivacy = 'local-only' | 'private-peers' | 'cloud-allowed';
export type BidPrivacy = 'local' | 'private' | 'cloud';
export type MissionApprovalPolicy = 'never' | 'on-risk' | 'always';
export type MissionRiskLevel = 'low' | 'medium' | 'high';

export interface MissionConstitution {
  schemaVersion: 1;
  goalId: string;
  intentRevision: string;
  privacy: MissionPrivacy;
  maxCostUsd: number;
  maxLatencyMs: number;
  requireReversible: boolean;
  approval: MissionApprovalPolicy;
  maxRisk: MissionRiskLevel;
  createdAt: string;
  updatedAt: string;
}

export interface MissionConstitutionInput {
  privacy?: MissionPrivacy;
  maxCostUsd?: number;
  maxLatencyMs?: number;
  requireReversible?: boolean;
  approval?: MissionApprovalPolicy;
  maxRisk?: MissionRiskLevel;
}

export interface ConstitutionSubject {
  privacy: BidPrivacy;
  costUsd: number;
  latencyMs: number;
  reversible: boolean;
  risk: MissionRiskLevel;
}

export interface ConstitutionGate {
  allowed: boolean;
  requiresApproval: boolean;
  violations: string[];
}

export interface MissionConstitutionStoreOptions {
  storeDir?: string;
  now?: () => Date;
}

function safeGoalId(goalId: string): string {
  const clean = goalId.trim();
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(clean)) {
    throw new Error('invalid goal id for mission constitution');
  }
  return clean;
}

function boundedNumber(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative number`);
  return value;
}

const RISK_RANK: Record<MissionRiskLevel, number> = { low: 0, medium: 1, high: 2 };
const PRIVACY_RANK: Record<BidPrivacy, number> = { local: 0, private: 1, cloud: 2 };
const CONSTITUTION_PRIVACY_RANK: Record<MissionPrivacy, number> = {
  'local-only': 0,
  'private-peers': 1,
  'cloud-allowed': 2,
};

/**
 * A user-authored, mission-scoped policy envelope. It can only restrict
 * execution; it never grants a tool permission or bypasses confirmation.
 */
export class MissionConstitutionStore {
  private readonly goalId: string;
  private readonly storeDir: string;
  private readonly now: () => Date;

  constructor(goalId: string, options: MissionConstitutionStoreOptions = {}) {
    this.goalId = safeGoalId(goalId);
    this.storeDir = options.storeDir ?? getCodeBuddyPath('constitutions');
    this.now = options.now ?? (() => new Date());
  }

  getFilePath(): string {
    return path.join(this.storeDir, `${this.goalId}.jsonl`);
  }

  get(graph: IntentGraph): MissionConstitution {
    if (graph.goalId !== this.goalId) throw new Error('intent graph does not match mission constitution');
    const matching = this.readAll()
      .filter((entry) => entry.intentRevision === graph.contractRevision)
      .at(-1);
    return matching ?? this.defaults(graph);
  }

  set(graph: IntentGraph, input: MissionConstitutionInput): MissionConstitution {
    const current = this.get(graph);
    const at = this.now().toISOString();
    const constitution: MissionConstitution = {
      ...current,
      privacy: input.privacy ?? current.privacy,
      maxCostUsd: boundedNumber(input.maxCostUsd, current.maxCostUsd, 'maxCostUsd'),
      maxLatencyMs: boundedNumber(input.maxLatencyMs, current.maxLatencyMs, 'maxLatencyMs'),
      requireReversible: input.requireReversible ?? current.requireReversible,
      approval: input.approval ?? current.approval,
      maxRisk: input.maxRisk ?? current.maxRisk,
      updatedAt: at,
    };
    this.append(constitution);
    return constitution;
  }

  evaluate(constitution: MissionConstitution, subject: ConstitutionSubject): ConstitutionGate {
    if (constitution.goalId !== this.goalId) throw new Error('constitution does not match goal');
    const violations: string[] = [];
    if (PRIVACY_RANK[subject.privacy] > CONSTITUTION_PRIVACY_RANK[constitution.privacy]) {
      violations.push(`privacy ${subject.privacy} exceeds ${constitution.privacy}`);
    }
    if (subject.costUsd > constitution.maxCostUsd) {
      violations.push(`cost ${subject.costUsd} exceeds ${constitution.maxCostUsd}`);
    }
    if (subject.latencyMs > constitution.maxLatencyMs) {
      violations.push(`latency ${subject.latencyMs}ms exceeds ${constitution.maxLatencyMs}ms`);
    }
    if (constitution.requireReversible && !subject.reversible) {
      violations.push('reversibility is required');
    }
    if (RISK_RANK[subject.risk] > RISK_RANK[constitution.maxRisk]) {
      violations.push(`risk ${subject.risk} exceeds ${constitution.maxRisk}`);
    }
    return {
      allowed: violations.length === 0,
      requiresApproval:
        constitution.approval === 'always' ||
        (constitution.approval === 'on-risk' && subject.risk === 'high'),
      violations,
    };
  }

  private defaults(graph: IntentGraph): MissionConstitution {
    const at = graph.createdAt;
    return {
      schemaVersion: 1,
      goalId: this.goalId,
      intentRevision: graph.contractRevision,
      privacy: 'cloud-allowed',
      maxCostUsd: 10,
      maxLatencyMs: 5_000,
      requireReversible: true,
      approval: 'on-risk',
      maxRisk: 'medium',
      createdAt: at,
      updatedAt: at,
    };
  }

  private readAll(): MissionConstitution[] {
    try {
      return fs.readFileSync(this.getFilePath(), 'utf8').split('\n').flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as MissionConstitution;
          return parsed?.schemaVersion === 1 && parsed.goalId === this.goalId ? [parsed] : [];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  private append(constitution: MissionConstitution): void {
    fs.mkdirSync(this.storeDir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(this.getFilePath(), `${JSON.stringify(constitution)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.chmodSync(this.getFilePath(), 0o600);
  }
}
