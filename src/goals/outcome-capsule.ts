import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getCodeBuddyPath } from '../utils/codebuddy-home.js';
import type { MissionConstitution } from './mission-constitution.js';
import type { MissionBidEvaluation } from './mission-exchange.js';
import type { ProvenOutcomeRecord } from './proven-outcome-memory.js';

export type OutcomeCapsuleStatus = 'draft' | 'portable' | 'active' | 'revoked';
export type OutcomeCapsuleParameterType = 'string' | 'number' | 'boolean';

export interface OutcomeCapsuleParameter {
  name: string;
  label: string;
  type: OutcomeCapsuleParameterType;
  required: boolean;
  defaultValue?: string | number | boolean;
}

export interface OutcomeCapsuleAttestation {
  bidId: string;
  provider: string;
  model: string;
  runtimeKey: string;
  rehearsalId: string;
  driftScore: number;
  observedAt: string;
}

export interface OutcomeCapsuleRecord {
  schemaVersion: 1;
  id: string;
  contentHash: string;
  goalId: string;
  outcomeId: string;
  intentRevision: string;
  title: string;
  description: string;
  parameterSchema: OutcomeCapsuleParameter[];
  constitution: MissionConstitution;
  proofHashes: string[];
  artifactHashes: string[];
  attestations: OutcomeCapsuleAttestation[];
  portability: {
    requiredRuntimes: number;
    distinctRuntimes: number;
    portable: boolean;
  };
  trustScore: number;
  status: OutcomeCapsuleStatus;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
  revokedAt?: string;
}

export interface CreateOutcomeCapsuleInput {
  outcome: ProvenOutcomeRecord;
  constitution: MissionConstitution;
  evaluations: MissionBidEvaluation[];
  title?: string;
  description?: string;
  parameters?: OutcomeCapsuleParameter[];
  requiredRuntimes?: number;
}

export interface OutcomeCapsuleStoreOptions {
  filePath?: string;
  now?: () => Date;
  idFactory?: () => string;
}

interface OutcomeCapsuleEvent {
  schemaVersion: 1;
  type: 'capsule.snapshot';
  at: string;
  capsule: OutcomeCapsuleRecord;
}

const SECRET_PATTERN = /(?:sk-[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9]{12,}|api[_-]?key\s*[:=]\s*\S{8,})/i;

function boundedText(value: string, label: string, max: number): string {
  const clean = value.trim();
  if (!clean) throw new Error(`${label} is required`);
  if (SECRET_PATTERN.test(clean)) throw new Error(`${label} appears to contain a secret`);
  return clean.slice(0, max);
}

function normalizeParameter(parameter: OutcomeCapsuleParameter): OutcomeCapsuleParameter {
  const name = parameter.name.trim();
  if (!/^[a-z][a-z0-9_]{0,63}$/i.test(name)) throw new Error(`invalid capsule parameter name: ${name}`);
  if (!['string', 'number', 'boolean'].includes(parameter.type)) throw new Error(`invalid capsule parameter type: ${parameter.type}`);
  return {
    name,
    label: boundedText(parameter.label, 'parameter label', 120),
    type: parameter.type,
    required: parameter.required === true,
    ...(parameter.defaultValue !== undefined ? { defaultValue: parameter.defaultValue } : {}),
  };
}

function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * A proof-backed, model-portable workflow package. Capsules never execute by
 * themselves: activation is human-gated and normal permissions still apply to
 * every replay.
 */
export class OutcomeCapsuleStore {
  private readonly filePath: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: OutcomeCapsuleStoreOptions = {}) {
    this.filePath = options.filePath ?? getCodeBuddyPath('capsules', 'outcome-capsules.jsonl');
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  getFilePath(): string {
    return this.filePath;
  }

  create(input: CreateOutcomeCapsuleInput): OutcomeCapsuleRecord {
    if (input.outcome.trustScore < 0.85) throw new Error('outcome trust score must be at least 0.85');
    if (input.outcome.proofHashes.length === 0) throw new Error('outcome capsule requires content-addressed proof hashes');
    if (input.constitution.goalId !== input.outcome.goalId || input.constitution.intentRevision !== input.outcome.intentRevision) {
      throw new Error('constitution does not match proven outcome revision');
    }
    const requiredRuntimes = Math.max(2, Math.min(5, Math.trunc(input.requiredRuntimes ?? 2)));
    const attestations = new Map<string, OutcomeCapsuleAttestation>();
    for (const evaluation of input.evaluations) {
      const rehearsal = evaluation.rehearsal;
      if (evaluation.bid.intentRevision !== input.outcome.intentRevision || rehearsal?.status !== 'pass') continue;
      const runtimeKey = `${evaluation.bid.provider.trim().toLowerCase()}:${evaluation.bid.model.trim().toLowerCase()}`;
      if (!attestations.has(runtimeKey)) {
        attestations.set(runtimeKey, {
          bidId: evaluation.bid.id,
          provider: evaluation.bid.provider,
          model: evaluation.bid.model,
          runtimeKey,
          rehearsalId: rehearsal.id,
          driftScore: rehearsal.drift.score,
          observedAt: rehearsal.createdAt,
        });
      }
    }
    const parameters = (input.parameters ?? []).map(normalizeParameter);
    const names = new Set<string>();
    for (const parameter of parameters) {
      if (names.has(parameter.name)) throw new Error(`duplicate capsule parameter: ${parameter.name}`);
      names.add(parameter.name);
    }
    const title = boundedText(input.title ?? input.outcome.goal, 'capsule title', 160);
    const description = boundedText(
      input.description ?? `Replay proven outcome ${input.outcome.id} under the captured autonomy constitution.`,
      'capsule description',
      2_000,
    );
    const artifactHashes = [...new Set(input.outcome.artifacts.map((artifact) => artifact.sha256))];
    const proofHashes = [...new Set(input.outcome.proofHashes)];
    const attestationList = [...attestations.values()];
    const portable = attestationList.length >= requiredRuntimes;
    const at = this.now().toISOString();
    const hashedPayload = {
      outcomeId: input.outcome.id,
      intentRevision: input.outcome.intentRevision,
      title,
      description,
      parameters,
      constitution: input.constitution,
      proofHashes,
      artifactHashes,
      attestations: attestationList,
      requiredRuntimes,
    };
    const hash = contentHash(hashedPayload);
    const existing = this.list(input.outcome.goalId).find((capsule) => capsule.contentHash === hash);
    if (existing) return existing;
    const capsule: OutcomeCapsuleRecord = {
      schemaVersion: 1,
      id: `capsule-${hash.slice(0, 16)}-${this.idFactory().slice(0, 8)}`,
      contentHash: hash,
      goalId: input.outcome.goalId,
      outcomeId: input.outcome.id,
      intentRevision: input.outcome.intentRevision,
      title,
      description,
      parameterSchema: parameters,
      constitution: input.constitution,
      proofHashes,
      artifactHashes,
      attestations: attestationList,
      portability: { requiredRuntimes, distinctRuntimes: attestationList.length, portable },
      trustScore: input.outcome.trustScore,
      status: portable ? 'portable' : 'draft',
      createdAt: at,
      updatedAt: at,
    };
    this.append(capsule);
    return capsule;
  }

  activate(id: string, humanApproved = false): OutcomeCapsuleRecord {
    const capsule = this.require(id);
    if (!capsule.portability.portable) throw new Error('capsule is not portable across enough verified runtimes');
    if (!humanApproved) throw new Error('capsule activation requires explicit human approval');
    if (capsule.status === 'revoked') throw new Error('revoked capsule cannot be activated');
    const at = this.now().toISOString();
    const active = { ...capsule, status: 'active' as const, activatedAt: at, updatedAt: at };
    this.append(active);
    return active;
  }

  revoke(id: string): OutcomeCapsuleRecord {
    const capsule = this.require(id);
    const at = this.now().toISOString();
    const revoked = { ...capsule, status: 'revoked' as const, revokedAt: at, updatedAt: at };
    this.append(revoked);
    return revoked;
  }

  get(id: string): OutcomeCapsuleRecord | null {
    return this.list().find((capsule) => capsule.id === id) ?? null;
  }

  list(goalId?: string, limit = 100): OutcomeCapsuleRecord[] {
    try {
      const snapshots = new Map<string, OutcomeCapsuleRecord>();
      for (const line of fs.readFileSync(this.filePath, 'utf8').split('\n')) {
        try {
          const event = JSON.parse(line) as OutcomeCapsuleEvent;
          if (event?.schemaVersion === 1 && event.type === 'capsule.snapshot' && (!goalId || event.capsule.goalId === goalId)) {
            snapshots.delete(event.capsule.id);
            snapshots.set(event.capsule.id, event.capsule);
          }
        } catch {
          // A torn append never hides other capsule snapshots.
        }
      }
      const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 100;
      return [...snapshots.values()].slice(-safeLimit).reverse();
    } catch {
      return [];
    }
  }

  private require(id: string): OutcomeCapsuleRecord {
    const capsule = this.get(id);
    if (!capsule) throw new Error(`outcome capsule not found: ${id}`);
    return capsule;
  }

  private append(capsule: OutcomeCapsuleRecord): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const event: OutcomeCapsuleEvent = { schemaVersion: 1, type: 'capsule.snapshot', at: capsule.updatedAt, capsule };
    fs.appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(this.filePath, 0o600);
  }
}
