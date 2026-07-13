import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDataRedactionEngine } from '../security/data-redaction.js';
import { getCodeBuddyPath } from '../utils/codebuddy-home.js';
import { logger } from '../utils/logger.js';
import {
  captureEvidenceArtifacts,
  type EvidenceArtifactReference,
} from './evidence-artifact.js';

export type ProofKind = 'verification' | 'decision';
export type ProofStatus = 'pass' | 'fail' | 'unknown';
export type ProofAssurance = 'deterministic' | 'independent' | 'judge' | 'none';

export interface CriterionProofResult {
  criterionId: string;
  status: 'passed' | 'failed' | 'unknown';
  evidence?: string;
}

export interface ProofRecord {
  schemaVersion: 1;
  id: string;
  goalId: string;
  createdAt: string;
  turn: number;
  kind: ProofKind;
  status: ProofStatus;
  assurance: ProofAssurance;
  summary: string;
  evidence: string;
  criterionIds: string[];
  /** Optional granular verdicts; criterionIds remains the compatibility view. */
  criterionResults?: CriterionProofResult[];
  artifacts: string[];
  /** Exact byte identity for workspace-owned reports, traces and screenshots. */
  artifactRefs?: EvidenceArtifactReference[];
  redactionCount: number;
  /** Tamper-evident chain fields. Legacy records intentionally omit them. */
  chainVersion?: 1;
  previousHash?: string;
  recordHash?: string;
  sessionKey?: string;
  source?: string;
}

export interface AppendProofInput {
  turn: number;
  kind: ProofKind;
  status: ProofStatus;
  assurance: ProofAssurance;
  summary: string;
  evidence?: string;
  criterionIds?: string[];
  criterionResults?: CriterionProofResult[];
  artifacts?: string[];
  sessionKey?: string;
  source?: string;
}

export interface ProofRecorder {
  append(input: AppendProofInput): ProofRecord | null;
}

export interface ProofLedgerOptions {
  storeDir?: string;
  /** Workspace root used to hash artifact paths without persisting absolutes. */
  artifactRoot?: string;
  now?: () => Date;
  idFactory?: () => string;
}

const MAX_SUMMARY_CHARS = 500;
const MAX_EVIDENCE_CHARS = 8_000;
const MAX_ITEMS = 100;

function clip(text: string, max: number): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}… [truncated]`;
}

function uniqueStrings(values: string[] | undefined): string[] {
  if (!values) return [];
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, MAX_ITEMS);
}

function safeGoalId(goalId: string): string {
  const clean = goalId.trim();
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(clean)) {
    throw new Error('invalid goal id for proof ledger');
  }
  return clean;
}

/** Append-only, secret-redacted evidence ledger for one durable goal. */
export class ProofLedger implements ProofRecorder {
  private readonly storeDir: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly goalId: string;
  private readonly artifactRoot?: string;

  constructor(goalId: string, options: ProofLedgerOptions = {}) {
    this.goalId = safeGoalId(goalId);
    this.storeDir = options.storeDir ?? getCodeBuddyPath('proofs');
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.artifactRoot = options.artifactRoot;
  }

  getFilePath(): string {
    return path.join(this.storeDir, `${this.goalId}.jsonl`);
  }

  append(input: AppendProofInput): ProofRecord | null {
    try {
      const redactor = getDataRedactionEngine();
      const summaryResult = redactor.redact(clip(input.summary, MAX_SUMMARY_CHARS));
      const evidenceResult = redactor.redact(clip(input.evidence ?? '', MAX_EVIDENCE_CHARS));
      const artifacts = uniqueStrings(input.artifacts);
      const criterionResults = normalizeCriterionResults(input.criterionResults);
      const previousHash = this.lastChainedHash();
      const unsigned: Omit<ProofRecord, 'recordHash'> = {
        schemaVersion: 1,
        id: `proof-${this.idFactory()}`,
        goalId: this.goalId,
        createdAt: this.now().toISOString(),
        turn: Number.isSafeInteger(input.turn) && input.turn >= 0 ? input.turn : 0,
        kind: input.kind,
        status: input.status,
        assurance: input.assurance,
        summary: summaryResult.redacted,
        evidence: evidenceResult.redacted,
        criterionIds: uniqueStrings([
          ...(input.criterionIds ?? []),
          ...criterionResults.map((result) => result.criterionId),
        ]),
        ...(criterionResults.length > 0 ? { criterionResults } : {}),
        artifacts,
        ...(this.artifactRoot
          ? { artifactRefs: captureEvidenceArtifacts(artifacts, this.artifactRoot, this.now) }
          : {}),
        redactionCount: summaryResult.redactions.length + evidenceResult.redactions.length,
        chainVersion: 1,
        ...(previousHash ? { previousHash } : {}),
        ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
        ...(input.source ? { source: input.source } : {}),
      };
      const record: ProofRecord = { ...unsigned, recordHash: hashRecord(unsigned) };
      fs.mkdirSync(this.storeDir, { recursive: true, mode: 0o700 });
      fs.appendFileSync(this.getFilePath(), `${JSON.stringify(record)}\n`, {
        encoding: 'utf-8',
        mode: 0o600,
      });
      fs.chmodSync(this.getFilePath(), 0o600);
      return record;
    } catch (error) {
      logger.debug('ProofLedger: failed to append proof', {
        goalId: this.goalId,
        error: String(error),
      });
      return null;
    }
  }

  list(limit: number = 100): ProofRecord[] {
    const records = this.readAll();
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : 100;
    return records.slice(-safeLimit);
  }

  verifyIntegrity(): ProofIntegrityReport {
    const records = this.readAll();
    if (records.length === 0) return { status: 'empty', checked: 0, legacy: 0, errors: [] };
    let previousHash = '';
    let checked = 0;
    let legacy = 0;
    const errors: string[] = [];
    for (const record of records) {
      if (!record.recordHash || record.chainVersion !== 1) {
        legacy += 1;
        continue;
      }
      checked += 1;
      if ((record.previousHash ?? '') !== previousHash) {
        errors.push(`${record.id}: previous hash mismatch`);
      }
      const { recordHash, ...unsigned } = record;
      if (hashRecord(unsigned) !== recordHash) errors.push(`${record.id}: record hash mismatch`);
      previousHash = recordHash;
    }
    return {
      status: errors.length > 0 ? 'broken' : checked === 0 ? 'legacy' : 'valid',
      checked,
      legacy,
      errors,
    };
  }

  private readAll(): ProofRecord[] {
    try {
      const raw = fs.readFileSync(this.getFilePath(), 'utf-8').trim();
      if (!raw) return [];
      return raw
        .split('\n')
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as ProofRecord;
            return parsed?.schemaVersion === 1 && parsed.goalId === this.goalId ? [parsed] : [];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  private lastChainedHash(): string {
    return [...this.readAll()].reverse().find((record) => record.recordHash)?.recordHash ?? '';
  }
}

export interface ProofIntegrityReport {
  status: 'empty' | 'legacy' | 'valid' | 'broken';
  checked: number;
  legacy: number;
  errors: string[];
}

function normalizeCriterionResults(values: CriterionProofResult[] | undefined): CriterionProofResult[] {
  if (!values) return [];
  const results = new Map<string, CriterionProofResult>();
  for (const value of values.slice(0, MAX_ITEMS)) {
    const criterionId = value.criterionId?.trim();
    if (!criterionId || !['passed', 'failed', 'unknown'].includes(value.status)) continue;
    results.set(criterionId, {
      criterionId,
      status: value.status,
      ...(value.evidence?.trim() ? { evidence: clip(value.evidence, MAX_SUMMARY_CHARS) } : {}),
    });
  }
  return [...results.values()];
}

function hashRecord(record: Omit<ProofRecord, 'recordHash'>): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

export function formatProofLedger(records: ProofRecord[]): string {
  if (records.length === 0) return 'No proof recorded for this intent.';
  return records
    .map((record) =>
      `${record.status === 'pass' ? '✓' : record.status === 'fail' ? '✗' : '?'} ` +
      `turn ${record.turn} · ${record.kind}/${record.assurance} · ${record.summary}`,
    )
    .join('\n');
}
