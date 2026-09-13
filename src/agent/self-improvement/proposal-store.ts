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
import { createHash } from 'crypto';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../../utils/atomic-write.js';

import type { SkillGateOutcome, SkillProposal, SkillSpec } from './skill-types.js';
import type { ToolGateOutcome, ToolProposal } from './tool-types.js';
import type { AuthoredToolSpec } from './authored-tool-runtime.js';

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
  return cleaned.slice(0, 80) || 'proposal';
}

function scenarioHash(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

export class PendingProposalStore {
  readonly dir: string;

  constructor(options: PendingProposalStoreOptions = {}) {
    const root = options.workDir ?? process.cwd();
    this.dir = path.join(root, '.codebuddy', 'self-improvement', 'proposals');
  }

  pathFor(kind: PendingProposalKind, scenarioId: string): string {
    return path.join(this.dir, `${kind}-${safeSegment(scenarioId)}-${scenarioHash(scenarioId)}.json`);
  }

  legacyPathFor(kind: PendingProposalKind, scenarioId: string): string {
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
    const parsed = this.read(this.pathFor('tool', scenarioId), 'tool', scenarioId);
    if (parsed && parsed.kind === 'tool') return parsed as PendingToolProposalRecord;

    const legacyParsed = this.read(this.legacyPathFor('tool', scenarioId), 'tool', scenarioId);
    if (legacyParsed && legacyParsed.kind === 'tool') return legacyParsed as PendingToolProposalRecord;

    return null;
  }

  loadSkill(scenarioId: string): PendingSkillProposalRecord | null {
    const parsed = this.read(this.pathFor('skill', scenarioId), 'skill', scenarioId);
    if (parsed && parsed.kind === 'skill') return parsed as PendingSkillProposalRecord;

    const legacyParsed = this.read(this.legacyPathFor('skill', scenarioId), 'skill', scenarioId);
    if (legacyParsed && legacyParsed.kind === 'skill') return legacyParsed as PendingSkillProposalRecord;

    return null;
  }

  remove(kind: PendingProposalKind, scenarioId: string): boolean {
    let removed = false;
    const canonicalPath = this.pathFor(kind, scenarioId);
    if (fs.existsSync(canonicalPath)) {
      const parsed = this.read(canonicalPath, kind, scenarioId);
      if (parsed) {
        fs.unlinkSync(canonicalPath);
        removed = true;
      }
    }

    const legacyPath = this.legacyPathFor(kind, scenarioId);
    if (fs.existsSync(legacyPath)) {
      const parsed = this.read(legacyPath, kind, scenarioId);
      if (parsed && parsed.scenarioId === scenarioId) {
        fs.unlinkSync(legacyPath);
        removed = true;
      }
    }

    return removed;
  }

  private write(filePath: string, record: PendingProposalRecord): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeJsonAtomicSync(filePath, record, { mode: 0o600 });
  }

  private read(filePath: string, expectedKind?: PendingProposalKind, expectedScenarioId?: string): PendingProposalRecord | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      const parsed = readJsonAtomicSync<Partial<PendingProposalRecord> | null>(filePath, null, { mode: 0o600 });
      if (!parsed || typeof parsed !== 'object') return null;
      if (parsed.schemaVersion !== PENDING_PROPOSAL_SCHEMA_VERSION) return null;
      if (parsed.kind !== 'tool' && parsed.kind !== 'skill') return null;
      if (expectedKind && parsed.kind !== expectedKind) return null;
      if (typeof parsed.scenarioId !== 'string' || !parsed.scenarioId.trim()) return null;
      if (expectedScenarioId !== undefined && parsed.scenarioId !== expectedScenarioId) return null;

      // Validate proposal
      const proposal = parsed.proposal as Partial<ToolProposal | SkillProposal> | undefined;
      if (!proposal || typeof proposal !== 'object') return null;
      if (typeof proposal.id !== 'string' || !proposal.id.trim()) return null;
      if (proposal.targetScenarioId !== parsed.scenarioId) return null;

      // Validate usable spec fields
      const spec = proposal.spec as Partial<AuthoredToolSpec | SkillSpec> | undefined;
      if (!spec || typeof spec !== 'object') return null;
      if (typeof spec.name !== 'string' || !spec.name.trim()) return null;
      if (parsed.kind === 'tool') {
        if (typeof (spec as Partial<AuthoredToolSpec>).code !== 'string') return null;
      } else if (parsed.kind === 'skill') {
        if (typeof (spec as Partial<SkillSpec>).content !== 'string') return null;
      }

      // Validate gate identities
      const gate = parsed.gate as Partial<ToolGateOutcome | SkillGateOutcome> | undefined;
      if (!gate || typeof gate !== 'object') return null;
      if (typeof gate.accepted !== 'boolean') return null;
      if (gate.scenarioId !== parsed.scenarioId || gate.proposalId !== proposal.id) return null;

      return parsed as PendingProposalRecord;
    } catch {
      return null;
    }
  }
}
