/**
 * Durable skill-apply journal — records the intent to install before any
 * mutator write, then the installed/proof-pending step, so a crash between
 * install and archive.append can be reconciled without re-authoring.
 *
 * @module agent/self-improvement/skill-apply-journal
 */

import fs from 'fs';
import path from 'path';
import { writeJsonAtomicSync } from '../../utils/atomic-write.js';

import type { SkillBehaviorResult } from './skill-behavior-gate.js';
import type { SkillProposal } from './skill-types.js';

export const SKILL_APPLY_JOURNAL_SCHEMA_VERSION = 1;

/** Intent is written before install; installed means proof (archive) is still pending. */
export type SkillApplyPhase = 'intent' | 'installed' | 'conflict';

export interface SkillApplyRecord {
  schemaVersion: typeof SKILL_APPLY_JOURNAL_SCHEMA_VERSION;
  scenarioId: string;
  proposalId: string;
  proposal: SkillProposal;
  intendedSha256: string;
  phase: SkillApplyPhase;
  appliedRef?: string;
  behavior?: SkillBehaviorResult;
  createdAt: string;
  updatedAt: string;
}

interface JournalFile {
  schemaVersion: number;
  records: SkillApplyRecord[];
}

export interface SkillApplyJournalOptions {
  workDir?: string;
  now?: () => Date;
}

const PENDING_PHASES: ReadonlySet<SkillApplyPhase> = new Set(['intent', 'installed']);
const SHA256_HEX = /^[a-f0-9]{64}$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value);
}

function isProposal(value: unknown, proposalId: string, scenarioId: string): value is SkillProposal {
  if (!value || typeof value !== 'object') return false;
  const proposal = value as SkillProposal;
  if (proposal.id !== proposalId) return false;
  if (proposal.targetScenarioId !== scenarioId) return false;
  const spec = proposal.spec;
  if (!spec || typeof spec !== 'object') return false;
  if (!isNonEmptyString(spec.name) || typeof spec.description !== 'string' || typeof spec.content !== 'string') {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is SkillApplyRecord {
  if (!value || typeof value !== 'object') return false;
  const rec = value as SkillApplyRecord;
  if (rec.schemaVersion !== SKILL_APPLY_JOURNAL_SCHEMA_VERSION) return false;
  if (!isNonEmptyString(rec.scenarioId) || !isNonEmptyString(rec.proposalId)) return false;
  if (!isSha256Hex(rec.intendedSha256)) return false;
  if (rec.phase !== 'intent' && rec.phase !== 'installed' && rec.phase !== 'conflict') return false;
  if (!isProposal(rec.proposal, rec.proposalId, rec.scenarioId)) return false;
  if (typeof rec.createdAt !== 'string' || typeof rec.updatedAt !== 'string') return false;
  if (rec.appliedRef !== undefined && typeof rec.appliedRef !== 'string') return false;
  if (rec.behavior !== undefined) {
    const behavior = rec.behavior;
    if (!behavior || typeof behavior !== 'object') return false;
    if (typeof behavior.accepted !== 'boolean') return false;
    if (typeof behavior.wins !== 'number' || typeof behavior.losses !== 'number' || typeof behavior.tested !== 'number') {
      return false;
    }
    if (!Array.isArray(behavior.cases)) return false;
  }
  return true;
}

function isJournalFile(value: unknown): value is JournalFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as JournalFile;
  if (file.schemaVersion !== SKILL_APPLY_JOURNAL_SCHEMA_VERSION) return false;
  if (!Array.isArray(file.records)) return false;
  return file.records.every(isRecord);
}

function assertUpsertIdentities(input: {
  scenarioId: string;
  proposalId: string;
  intendedSha256: string;
  proposal: SkillProposal;
}): void {
  if (!isNonEmptyString(input.scenarioId)) throw new Error('scenarioId required');
  if (!isNonEmptyString(input.proposalId)) throw new Error('proposalId required');
  if (!isSha256Hex(input.intendedSha256)) throw new Error('intendedSha256 must be a sha256 hex digest');
  if (!isProposal(input.proposal, input.proposalId, input.scenarioId)) {
    throw new Error('proposal identity must match proposalId and scenarioId');
  }
}

export class SkillApplyJournal {
  private readonly filePath: string;
  private readonly now: () => Date;

  constructor(options: SkillApplyJournalOptions = {}) {
    const root = options.workDir ?? process.cwd();
    this.filePath = path.join(root, '.codebuddy', 'self-improvement', 'skill-apply.json');
    this.now = options.now ?? (() => new Date());
  }

  get path(): string {
    return this.filePath;
  }

  list(): SkillApplyRecord[] {
    return this.read().records;
  }

  /** Intent or installed — still needs work. Conflict is terminal and excluded. */
  listPending(): SkillApplyRecord[] {
    return this.list().filter((record) => PENDING_PHASES.has(record.phase));
  }

  get(scenarioId: string): SkillApplyRecord | null {
    return this.list().find((record) => record.scenarioId === scenarioId) ?? null;
  }

  upsert(input: Omit<SkillApplyRecord, 'schemaVersion' | 'createdAt' | 'updatedAt'> & {
    createdAt?: string;
  }): SkillApplyRecord {
    assertUpsertIdentities(input);
    const file = this.read();
    const stamp = this.now().toISOString();
    const previous = file.records.find((record) => record.scenarioId === input.scenarioId);
    const stored: SkillApplyRecord = {
      schemaVersion: SKILL_APPLY_JOURNAL_SCHEMA_VERSION,
      scenarioId: input.scenarioId,
      proposalId: input.proposalId,
      proposal: input.proposal,
      intendedSha256: input.intendedSha256,
      phase: input.phase,
      createdAt: input.createdAt ?? previous?.createdAt ?? stamp,
      updatedAt: stamp,
      ...(input.appliedRef ? { appliedRef: input.appliedRef } : {}),
      ...(input.behavior ? { behavior: input.behavior } : {}),
    };
    file.records = file.records.filter((record) => record.scenarioId !== input.scenarioId);
    file.records.push(stored);
    this.write(file);
    return stored;
  }

  remove(scenarioId: string): boolean {
    const file = this.read();
    const next = file.records.filter((record) => record.scenarioId !== scenarioId);
    if (next.length === file.records.length) return false;
    this.write({ ...file, records: next });
    return true;
  }

  private read(): JournalFile {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { schemaVersion: SKILL_APPLY_JOURNAL_SCHEMA_VERSION, records: [] };
      }
      throw new Error(
        `skill apply journal unreadable at ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!stat.isFile()) {
      throw new Error(`skill apply journal unreadable at ${this.filePath}: not a regular file`);
    }
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      throw new Error(
        `skill apply journal unreadable at ${this.filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`skill apply journal corrupt at ${this.filePath}; refusing to overwrite`);
    }
    if (!isJournalFile(parsed)) {
      throw new Error(`skill apply journal invalid at ${this.filePath}; refusing to overwrite`);
    }
    return parsed;
  }

  private write(file: JournalFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeJsonAtomicSync(this.filePath, file, { mode: 0o600 });
  }
}
