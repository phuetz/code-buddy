/**
 * Human-approved Project evolution.
 *
 * This service deliberately has no LLM dependency. It deterministically finds
 * reusable statements in a session or an explicit summary, stores bounded
 * proposals, and mutates Project context only after an approval IPC call.
 */

import { createHash, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { DatabaseInstance, MessageRow } from '../db/database';
import type { Project, ProjectManager } from './project-manager';
import {
  inspectProjectKnowledgeFile,
  removeProjectKnowledgeFile,
  writeProjectKnowledgeFile,
} from './project-paths';
import type {
  ProjectEvolutionAuditEntry,
  ProjectEvolutionCreateInput,
  ProjectEvolutionEvidence,
  ProjectEvolutionMutationResult,
  ProjectEvolutionProposal,
  ProjectEvolutionRejectInput,
} from '../../shared/project-evolution';

const MISSING_FINGERPRINT = 'missing';
const MAX_SOURCE_CHARS = 100_000;
const MAX_SUMMARY_CHARS = 50_000;
const MAX_PREVIEW_CHARS = 128_000;
const MAX_EVIDENCE = 8;

interface StoredProposalRow {
  payload: string;
}

export interface ProjectEvolutionRepository {
  save(proposal: ProjectEvolutionProposal): void;
  get(id: string): ProjectEvolutionProposal | null;
  list(projectId: string): ProjectEvolutionProposal[];
}

export class SqliteProjectEvolutionRepository implements ProjectEvolutionRepository {
  constructor(private readonly database: Database.Database) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS project_evolution_proposals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('master_instruction', 'knowledge_file')),
        status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'rolled_back')),
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_project_evolution_project_status
        ON project_evolution_proposals(project_id, status, created_at DESC);
    `);
  }

  save(proposal: ProjectEvolutionProposal): void {
    this.database.prepare(`
      INSERT INTO project_evolution_proposals
        (id, project_id, type, status, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        type = excluded.type,
        status = excluded.status,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(
      proposal.id,
      proposal.projectId,
      proposal.type,
      proposal.status,
      JSON.stringify(proposal),
      proposal.createdAt,
      proposal.updatedAt,
    );
  }

  get(id: string): ProjectEvolutionProposal | null {
    const row = this.database.prepare(
      'SELECT payload FROM project_evolution_proposals WHERE id = ?'
    ).get(id) as StoredProposalRow | undefined;
    return row ? parseStoredProposal(row.payload) : null;
  }

  list(projectId: string): ProjectEvolutionProposal[] {
    const rows = this.database.prepare(`
      SELECT payload FROM project_evolution_proposals
      WHERE project_id = ? ORDER BY created_at DESC LIMIT 100
    `).all(projectId) as StoredProposalRow[];
    return rows
      .map((row) => parseStoredProposal(row.payload))
      .filter((proposal): proposal is ProjectEvolutionProposal => proposal !== null);
  }
}

function parseStoredProposal(payload: string): ProjectEvolutionProposal | null {
  try {
    const value = JSON.parse(payload) as Partial<ProjectEvolutionProposal>;
    if (
      typeof value.id !== 'string'
      || typeof value.projectId !== 'string'
      || !['master_instruction', 'knowledge_file'].includes(String(value.type))
      || !['pending', 'approved', 'rejected', 'rolled_back'].includes(String(value.status))
      || typeof value.beforeContent !== 'string'
      || typeof value.afterContent !== 'string'
      || typeof value.baseFingerprint !== 'string'
      || !Array.isArray(value.evidence)
      || !Array.isArray(value.audit)
    ) {
      return null;
    }
    return value as ProjectEvolutionProposal;
  } catch {
    return null;
  }
}

interface SourceLine {
  text: string;
  evidence: ProjectEvolutionEvidence;
}

const SECRET_REPLACEMENTS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/gi,
    replacement: '[REDACTED:PRIVATE_KEY]',
  },
  { pattern: /\b(?:sk|xai|ghp)_[A-Za-z0-9_-]{20,}\b/g, replacement: '[REDACTED:TOKEN]' },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: '[REDACTED:TOKEN]' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: '[REDACTED:TOKEN]' },
  { pattern: /\bAIza[A-Za-z0-9_-]{20,}\b/g, replacement: '[REDACTED:API_KEY]' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replacement: '[REDACTED:TOKEN]' },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, replacement: 'Bearer [REDACTED:TOKEN]' },
  {
    pattern: /\b(?:api[_-]?key|secret|password|passwd|token|private[_-]?key|authorization)\s*[:=]\s*["']?[^\s"']{8,}["']?/gi,
    replacement: '[REDACTED:CREDENTIAL]',
  },
  {
    pattern: /([?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|token)=)[^&#\s]+/gi,
    replacement: '$1[REDACTED]',
  },
  { pattern: /(https?:\/\/)[^:/@\s]+:[^/@\s]+@/gi, replacement: '$1[REDACTED]@' },
];

function scrubSensitiveText(value: string): { text: string; redacted: boolean } {
  let text = value;
  for (const { pattern, replacement } of SECRET_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return { text, redacted: text !== value };
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex');
}

function cleanLine(value: string): string {
  return value
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/u, '')
    .replace(/^#{1,6}\s+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const REUSABLE_CUE = /(?:\b(?:always|never|must|should|avoid|prefer|remember|important|constraint|rule|decided|decision|chosen|selected|from now on|typically|usually)\b|\b(?:toujours|jamais|doit|devons|éviter|eviter|préf(?:ère|érer)|preferer|important|contrainte|règle|regle|décid(?:é|ons)|decid(?:e|ons)|retenu|désormais|desormais|à partir de maintenant|a partir de maintenant|habituellement)\b)/iu;

function extractReusableLines(lines: SourceLine[], sourceKind: 'session' | 'summary'): SourceLine[] {
  const result: SourceLine[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const cleaned = cleanLine(line.text);
    if (cleaned.length < 12 || cleaned.length > 600 || cleaned.endsWith('?')) continue;
    if (/\[REDACTED(?::|\])/iu.test(cleaned)) continue;
    const scrubbed = scrubSensitiveText(cleaned);
    // Dropping the whole line is safer than carrying a credential placeholder
    // into a future system instruction or knowledge file.
    if (scrubbed.redacted) continue;
    if (sourceKind === 'session' && !REUSABLE_CUE.test(cleaned)) continue;
    const key = cleaned.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      text: cleaned,
      evidence: {
        ...line.evidence,
        excerpt: scrubSensitiveText(line.evidence.excerpt).text.slice(0, 240),
      },
    });
    if (result.length >= MAX_EVIDENCE) break;
  }
  return result;
}

function contentText(row: MessageRow): string {
  try {
    const parsed = JSON.parse(row.content) as unknown;
    if (typeof parsed === 'string') return parsed;
    if (Array.isArray(parsed)) {
      return parsed
        .flatMap((block) => {
          if (!block || typeof block !== 'object') return [];
          const text = (block as { text?: unknown }).text;
          return typeof text === 'string' ? [text] : [];
        })
        .join('\n');
    }
  } catch {
    return row.content;
  }
  return '';
}

function splitSourceText(text: string): string[] {
  // Redact multi-line credentials before splitting. Splitting first turns a
  // PEM block into individually harmless-looking lines and defeats the
  // complete-block detector.
  const scrubbed = scrubSensitiveText(text).text;
  return scrubbed
    .split(/\r?\n|(?<=[.!?])\s+/u)
    .filter((line) => line && !/\[REDACTED(?::|\])/iu.test(line));
}

function appendReusableContent(before: string, additions: string[], heading: boolean): string {
  const existing = before.trimEnd();
  const lowerExisting = existing.toLocaleLowerCase();
  const fresh = additions.filter((addition) => !lowerExisting.includes(addition.toLocaleLowerCase()));
  if (fresh.length === 0) throw new Error('All proposed learnings already exist in the target');
  const block = fresh.map((addition) => `- ${addition}`).join('\n');
  if (!existing) {
    return heading ? `# Project knowledge\n\n${block}\n` : `${block}\n`;
  }
  return heading
    ? `${existing}\n\n## Approved project learnings\n\n${block}\n`
    : `${existing}\n\n${block}\n`;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Project evolution operation failed';
  return scrubSensitiveText(message).text.slice(0, 500);
}

export class ProjectEvolutionService {
  private readonly repository: ProjectEvolutionRepository;

  constructor(
    private readonly database: DatabaseInstance,
    private readonly projectManager: ProjectManager,
    repository?: ProjectEvolutionRepository,
  ) {
    this.repository = repository ?? new SqliteProjectEvolutionRepository(database.raw);
  }

  list(projectId: string): ProjectEvolutionProposal[] {
    this.requireProject(projectId);
    return this.repository.list(projectId).map((proposal) => this.refreshStaleness(proposal));
  }

  create(input: ProjectEvolutionCreateInput): ProjectEvolutionProposal {
    if (!input || typeof input !== 'object') throw new Error('Project evolution input is required');
    const project = this.requireProject(input.projectId);
    const sourceLines = this.readSource(project, input);
    const reusable = extractReusableLines(sourceLines, input.source.kind);
    if (reusable.length === 0) {
      throw new Error(
        input.source.kind === 'session'
          ? 'No reusable rule or decision was found in this session'
          : 'The summary contains no safe reusable statement'
      );
    }

    const additions = reusable.map((line) => line.text);
    const now = Date.now();
    let beforeContent = '';
    let afterContent = '';
    let baseFingerprint = '';
    let targetPath: string | undefined;
    let workspaceFingerprint: string | undefined;
    let knowledgeFileWasSelected: boolean | undefined;

    if (input.target.type === 'master_instruction') {
      beforeContent = project.contextConfig?.masterInstruction ?? '';
      if (scrubSensitiveText(beforeContent).redacted) {
        throw new Error('The current master instruction contains a possible secret; clean it manually first');
      }
      // ProjectManager normalizes master instructions with trim(); keep the
      // reviewed payload byte-for-byte equal to what will be persisted so the
      // applied fingerprint and rollback guard remain stable.
      afterContent = appendReusableContent(beforeContent, additions, false).trim();
      if (afterContent.length > 12_000) throw new Error('The proposed master instruction exceeds 12,000 characters');
      baseFingerprint = fingerprint(beforeContent);
    } else {
      if (!project.workspacePath) throw new Error('A Project workspace is required for knowledge-file proposals');
      const snapshot = inspectProjectKnowledgeFile(project.workspacePath, input.target.path);
      beforeContent = snapshot.content;
      targetPath = snapshot.relativePath;
      workspaceFingerprint = snapshot.workspaceFingerprint;
      if (beforeContent.length > MAX_PREVIEW_CHARS) {
        throw new Error('The selected knowledge file is too large for a safe review preview');
      }
      if (scrubSensitiveText(beforeContent).redacted) {
        throw new Error('The current knowledge file contains a possible secret; clean it manually first');
      }
      afterContent = appendReusableContent(beforeContent, additions, true);
      if (afterContent.length > MAX_PREVIEW_CHARS) {
        throw new Error('The proposed knowledge file exceeds the review size limit');
      }
      baseFingerprint = snapshot.exists ? fingerprint(beforeContent) : MISSING_FINGERPRINT;
      knowledgeFileWasSelected = (project.contextConfig?.knowledgeFiles ?? []).includes(targetPath);
    }

    const sourceKind = input.source.kind;
    const proposal: ProjectEvolutionProposal = {
      id: randomUUID(),
      projectId: project.id,
      type: input.target.type,
      status: 'pending',
      title: input.target.type === 'master_instruction'
        ? 'Update the master instruction'
        : `Update ${targetPath}`,
      reason: `${reusable.length} reusable statement${reusable.length === 1 ? '' : 's'} detected in the ${sourceKind === 'session' ? 'active session' : 'review summary'}.`,
      evidence: reusable.map((line) => line.evidence),
      sourceKind,
      ...(sourceKind === 'session' ? { sourceSessionId: input.source.sessionId } : {}),
      ...(targetPath ? { targetPath } : {}),
      ...(workspaceFingerprint ? { workspaceFingerprint } : {}),
      beforeContent,
      afterContent,
      baseFingerprint,
      ...(knowledgeFileWasSelected !== undefined ? { knowledgeFileWasSelected } : {}),
      audit: [{ action: 'created', at: now }],
      createdAt: now,
      updatedAt: now,
    };
    this.repository.save(proposal);
    return proposal;
  }

  approve(proposalId: string): ProjectEvolutionMutationResult {
    const proposal = this.repository.get(proposalId);
    if (!proposal) return { ok: false, proposal: null, error: 'Proposal not found' };
    if (proposal.status !== 'pending') {
      return { ok: false, proposal, error: `Only pending proposals can be approved` };
    }

    const refreshed = this.refreshStaleness(proposal);
    if (refreshed.staleReason) {
      return { ok: false, proposal: refreshed, error: refreshed.staleReason };
    }

    try {
      const project = this.requireProject(refreshed.projectId);
      const originalContext = project.contextConfig ?? {};
      if (refreshed.type === 'master_instruction') {
        const updated = this.projectManager.update(project.id, {
          contextConfig: { ...originalContext, masterInstruction: refreshed.afterContent },
        });
        if (!updated) throw new Error('Project disappeared before approval');
        try {
          return { ok: true, proposal: this.markApproved(refreshed) };
        } catch (error) {
          this.projectManager.update(project.id, { contextConfig: originalContext });
          throw error;
        }
      }

      if (!project.workspacePath || !refreshed.targetPath) {
        throw new Error('Knowledge proposal has no safe workspace target');
      }
      const existed = refreshed.baseFingerprint !== MISSING_FINGERPRINT;
      writeProjectKnowledgeFile(
        project.workspacePath,
        refreshed.targetPath,
        refreshed.afterContent,
        existed ? refreshed.beforeContent : null,
        refreshed.workspaceFingerprint,
      );
      const knowledgeFiles = Array.from(new Set([
        ...(originalContext.knowledgeFiles ?? []),
        refreshed.targetPath,
      ]));
      const updated = this.projectManager.update(project.id, {
        contextConfig: { ...originalContext, knowledgeFiles },
      });
      if (!updated) {
        this.restoreKnowledgeFile(project, refreshed, refreshed.afterContent);
        throw new Error('Project disappeared before approval');
      }
      try {
        return { ok: true, proposal: this.markApproved(refreshed) };
      } catch (error) {
        this.projectManager.update(project.id, { contextConfig: originalContext });
        this.restoreKnowledgeFile(project, refreshed, refreshed.afterContent);
        throw error;
      }
    } catch (error) {
      return { ok: false, proposal: this.repository.get(proposalId), error: safeError(error) };
    }
  }

  reject(input: ProjectEvolutionRejectInput): ProjectEvolutionMutationResult {
    const proposal = this.repository.get(input.proposalId);
    if (!proposal) return { ok: false, proposal: null, error: 'Proposal not found' };
    if (proposal.status !== 'pending') {
      return { ok: false, proposal, error: 'Only pending proposals can be rejected' };
    }
    const now = Date.now();
    const rejectionReason = scrubSensitiveText(input.reason?.trim() ?? '').text.slice(0, 500);
    const rejected: ProjectEvolutionProposal = {
      ...proposal,
      status: 'rejected',
      ...(rejectionReason ? { rejectionReason } : {}),
      audit: [...proposal.audit, { action: 'rejected', at: now }],
      decidedAt: now,
      updatedAt: now,
    };
    this.repository.save(rejected);
    return { ok: true, proposal: rejected };
  }

  rollback(proposalId: string): ProjectEvolutionMutationResult {
    const proposal = this.repository.get(proposalId);
    if (!proposal) return { ok: false, proposal: null, error: 'Proposal not found' };
    if (proposal.status !== 'approved') {
      return { ok: false, proposal, error: 'Only approved proposals can be rolled back' };
    }
    try {
      const project = this.requireProject(proposal.projectId);
      const originalContext = project.contextConfig ?? {};
      const current = this.currentFingerprint(project, proposal);
      if (current !== proposal.appliedFingerprint) {
        const stale = this.markStale(
          proposal,
          'The approved target changed afterwards; rollback was blocked to preserve newer work.'
        );
        return { ok: false, proposal: stale, error: stale.staleReason };
      }

      if (proposal.type === 'master_instruction') {
        const restored = this.projectManager.update(project.id, {
          contextConfig: { ...originalContext, masterInstruction: proposal.beforeContent || undefined },
        });
        if (!restored) throw new Error('Project disappeared before rollback');
        try {
          return { ok: true, proposal: this.markRolledBack(proposal) };
        } catch (error) {
          this.projectManager.update(project.id, {
            contextConfig: { ...originalContext, masterInstruction: proposal.afterContent },
          });
          throw error;
        }
      }

      if (!project.workspacePath || !proposal.targetPath) {
        throw new Error('Knowledge proposal has no safe workspace target');
      }
      if (proposal.baseFingerprint === MISSING_FINGERPRINT) {
        removeProjectKnowledgeFile(
          project.workspacePath,
          proposal.targetPath,
          proposal.afterContent,
          proposal.workspaceFingerprint,
        );
      } else {
        writeProjectKnowledgeFile(
          project.workspacePath,
          proposal.targetPath,
          proposal.beforeContent,
          proposal.afterContent,
          proposal.workspaceFingerprint,
        );
      }
      const knowledgeFiles = proposal.knowledgeFileWasSelected
        ? originalContext.knowledgeFiles ?? []
        : (originalContext.knowledgeFiles ?? []).filter((path) => path !== proposal.targetPath);
      const restoredProject = this.projectManager.update(project.id, {
        contextConfig: { ...originalContext, knowledgeFiles },
      });
      if (!restoredProject) {
        writeProjectKnowledgeFile(
          project.workspacePath,
          proposal.targetPath,
          proposal.afterContent,
          proposal.baseFingerprint === MISSING_FINGERPRINT ? null : proposal.beforeContent,
          proposal.workspaceFingerprint,
        );
        throw new Error('Project disappeared before rollback');
      }
      try {
        return { ok: true, proposal: this.markRolledBack(proposal) };
      } catch (error) {
        writeProjectKnowledgeFile(
          project.workspacePath,
          proposal.targetPath,
          proposal.afterContent,
          proposal.baseFingerprint === MISSING_FINGERPRINT ? null : proposal.beforeContent,
          proposal.workspaceFingerprint,
        );
        this.projectManager.update(project.id, { contextConfig: originalContext });
        throw error;
      }
    } catch (error) {
      return { ok: false, proposal: this.repository.get(proposalId), error: safeError(error) };
    }
  }

  private readSource(project: Project, input: ProjectEvolutionCreateInput): SourceLine[] {
    if (input.source.kind === 'summary') {
      if (typeof input.source.text !== 'string' || !input.source.text.trim()) {
        throw new Error('A review summary is required');
      }
      const text = input.source.text.slice(0, MAX_SUMMARY_CHARS);
      return splitSourceText(text).map((line) => ({
        text: line,
        evidence: { role: 'summary', excerpt: scrubSensitiveText(line).text.slice(0, 240) },
      }));
    }

    const sessionId = input.source.sessionId?.trim();
    if (!sessionId) throw new Error('An active session is required');
    const session = this.database.sessions.get(sessionId);
    if (!session || session.project_id !== project.id) {
      throw new Error('The selected session does not belong to this Project');
    }
    const rows = this.database.messages.getBySessionId(sessionId).slice(-100);
    const lines: SourceLine[] = [];
    let used = 0;
    for (const row of rows) {
      if (!['user', 'assistant'].includes(row.role)) continue;
      const text = contentText(row);
      if (!text) continue;
      for (const line of splitSourceText(text)) {
        used += line.length;
        if (used > MAX_SOURCE_CHARS) return lines;
        lines.push({
          text: line,
          evidence: {
            role: row.role as 'user' | 'assistant',
            messageId: row.id,
            timestamp: row.timestamp,
            excerpt: scrubSensitiveText(line).text.slice(0, 240),
          },
        });
      }
    }
    return lines;
  }

  private requireProject(projectId: string): Project {
    if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 200) {
      throw new Error('Invalid Project id');
    }
    const project = this.projectManager.get(projectId);
    if (!project) throw new Error('Project not found');
    return project;
  }

  private currentFingerprint(project: Project, proposal: ProjectEvolutionProposal): string {
    if (proposal.type === 'master_instruction') {
      return fingerprint(project.contextConfig?.masterInstruction ?? '');
    }
    if (!project.workspacePath || !proposal.targetPath) {
      throw new Error('Knowledge proposal has no safe workspace target');
    }
    const snapshot = inspectProjectKnowledgeFile(project.workspacePath, proposal.targetPath);
    if (!proposal.workspaceFingerprint) {
      throw new Error('This legacy knowledge proposal is not bound to a reviewed workspace; recreate it');
    }
    if (snapshot.workspaceFingerprint !== proposal.workspaceFingerprint) {
      throw new Error('The Project workspace changed after this proposal was created');
    }
    return snapshot.exists ? fingerprint(snapshot.content) : MISSING_FINGERPRINT;
  }

  private refreshStaleness(proposal: ProjectEvolutionProposal): ProjectEvolutionProposal {
    if (proposal.status !== 'pending') return proposal;
    let reason: string | undefined;
    try {
      const project = this.requireProject(proposal.projectId);
      if (this.currentFingerprint(project, proposal) !== proposal.baseFingerprint) {
        reason = proposal.type === 'master_instruction'
          ? 'The master instruction changed after this proposal was created.'
          : 'The knowledge file changed after this proposal was created.';
      }
    } catch (error) {
      reason = safeError(error);
    }
    if (reason === proposal.staleReason) return proposal;
    const next = reason
      ? this.markStale(proposal, reason)
      : { ...proposal, staleReason: undefined, updatedAt: Date.now() };
    this.repository.save(next);
    return next;
  }

  private markStale(proposal: ProjectEvolutionProposal, staleReason: string): ProjectEvolutionProposal {
    const now = Date.now();
    const lastAudit = proposal.audit[proposal.audit.length - 1];
    const audit: ProjectEvolutionAuditEntry[] =
      lastAudit?.action === 'stale_detected' && lastAudit.detail === staleReason
        ? proposal.audit
        : [...proposal.audit, { action: 'stale_detected', at: now, detail: staleReason }];
    const stale = { ...proposal, staleReason, audit, updatedAt: now };
    this.repository.save(stale);
    return stale;
  }

  private markApproved(proposal: ProjectEvolutionProposal): ProjectEvolutionProposal {
    const now = Date.now();
    const approved: ProjectEvolutionProposal = {
      ...proposal,
      status: 'approved',
      staleReason: undefined,
      appliedFingerprint: fingerprint(proposal.afterContent),
      audit: [...proposal.audit, { action: 'approved', at: now }],
      decidedAt: now,
      appliedAt: now,
      updatedAt: now,
    };
    this.repository.save(approved);
    return approved;
  }

  private markRolledBack(proposal: ProjectEvolutionProposal): ProjectEvolutionProposal {
    const now = Date.now();
    const rolledBack: ProjectEvolutionProposal = {
      ...proposal,
      status: 'rolled_back',
      staleReason: undefined,
      audit: [...proposal.audit, { action: 'rolled_back', at: now }],
      rolledBackAt: now,
      updatedAt: now,
    };
    this.repository.save(rolledBack);
    return rolledBack;
  }

  private restoreKnowledgeFile(
    project: Project,
    proposal: ProjectEvolutionProposal,
    expectedCurrent: string,
  ): void {
    if (!project.workspacePath || !proposal.targetPath) return;
    if (proposal.baseFingerprint === MISSING_FINGERPRINT) {
      removeProjectKnowledgeFile(
        project.workspacePath,
        proposal.targetPath,
        expectedCurrent,
        proposal.workspaceFingerprint,
      );
    } else {
      writeProjectKnowledgeFile(
        project.workspacePath,
        proposal.targetPath,
        proposal.beforeContent,
        expectedCurrent,
        proposal.workspaceFingerprint,
      );
    }
  }
}
