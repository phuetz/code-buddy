/**
 * Pending self-improvement proposals — durable propose-only candidates.
 *
 * `improve tools` / `improve skills` without `--apply` used to validate a
 * candidate then throw it away, so "re-run with --apply" re-authored from
 * scratch. Accepted proposals (candidate + gate evidence) now land under
 * `.codebuddy/self-improvement/proposals/` and `--apply` reuses them.
 *
 * @module agent/self-improvement/proposal-store
 */

import fs from 'fs';
import path from 'path';

import type { SkillGateOutcome, SkillProposal } from './skill-types.js';
import type { ToolGateOutcome, ToolProposal } from './tool-types.js';

export const PENDING_PROPOSAL_SCHEMA_VERSION = 1;

export type PendingProposalKind = 'tool' | 'skill';

export interface PendingToolProposalRecord {
  schemaVersion: typeof PENDING_PROPOSAL_SCHEMA_VERSION;
  kind: 'tool';
  scenarioId: string;
  acceptedAt: string;
  proposal: ToolProposal;
  gate: ToolGateOutcome;
}

export interface PendingSkillProposalRecord {
  schemaVersion: typeof PENDING_PROPOSAL_SCHEMA_VERSION;
  kind: 'skill';
  scenarioId: string;
  acceptedAt: string;
  proposal: SkillProposal;
  gate: SkillGateOutcome;
}

export type PendingProposalRecord = PendingToolProposalRecord | PendingSkillProposalRecord;

export interface PendingProposalStoreOptions {
  workDir?: string;
}

function safeSegment(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'proposal';
}

export class PendingProposalStore {
  readonly dir: string;

  constructor(options: PendingProposalStoreOptions = {}) {
    const root = options.workDir ?? process.cwd();
    this.dir = path.join(root, '.codebuddy', 'self-improvement', 'proposals');
  }

  pathFor(kind: PendingProposalKind, scenarioId: string): string {
    return path.join(this.dir, `${kind}-${safeSegment(scenarioId)}.json`);
  }

  saveTool(
    record: Omit<PendingToolProposalRecord, 'schemaVersion' | 'kind'>,
  ): PendingToolProposalRecord {
    const stored: PendingToolProposalRecord = {
      schemaVersion: PENDING_PROPOSAL_SCHEMA_VERSION,
      kind: 'tool',
      ...record,
    };
    this.write(this.pathFor('tool', record.scenarioId), stored);
    return stored;
  }

  saveSkill(
    record: Omit<PendingSkillProposalRecord, 'schemaVersion' | 'kind'>,
  ): PendingSkillProposalRecord {
    const stored: PendingSkillProposalRecord = {
      schemaVersion: PENDING_PROPOSAL_SCHEMA_VERSION,
      kind: 'skill',
      ...record,
    };
    this.write(this.pathFor('skill', record.scenarioId), stored);
    return stored;
  }

  loadTool(scenarioId: string): PendingToolProposalRecord | null {
    const parsed = this.read(this.pathFor('tool', scenarioId));
    if (!parsed || parsed.kind !== 'tool') return null;
    return parsed;
  }

  loadSkill(scenarioId: string): PendingSkillProposalRecord | null {
    const parsed = this.read(this.pathFor('skill', scenarioId));
    if (!parsed || parsed.kind !== 'skill') return null;
    return parsed;
  }

  remove(kind: PendingProposalKind, scenarioId: string): boolean {
    const filePath = this.pathFor(kind, scenarioId);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  private write(filePath: string, record: PendingProposalRecord): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
  }

  private read(filePath: string): PendingProposalRecord | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<PendingProposalRecord>;
      if (parsed.schemaVersion !== PENDING_PROPOSAL_SCHEMA_VERSION) return null;
      if (parsed.kind !== 'tool' && parsed.kind !== 'skill') return null;
      if (typeof parsed.scenarioId !== 'string' || !parsed.proposal || !parsed.gate) return null;
      return parsed as PendingProposalRecord;
    } catch {
      return null;
    }
  }
}
