/**
 * Review-gated long-term memory candidates.
 *
 * Declarative memories are more dangerous than procedural lessons because they
 * are injected into future prompts as "facts". The safe loop is therefore:
 * infer -> enqueue with evidence -> human accepts/rejects -> write bounded
 * persistent memory. Proposing a candidate never mutates CODEBUDDY_MEMORY.md.
 */

import fs from 'fs';
import path from 'path';
import { scanForSecrets, redactSecrets } from '../fleet/privacy-lint.js';
import { logger } from '../utils/logger.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';
import {
  getMemoryManager,
  PersistentMemoryManager,
  type MemoryCategory,
  type MemoryScope,
  type MemoryWriteResult,
} from './persistent-memory.js';

export const MEMORY_CANDIDATE_SCHEMA_VERSION = 1;

const VALID_CATEGORIES: MemoryCategory[] = [
  'project',
  'preferences',
  'decisions',
  'patterns',
  'context',
  'custom',
];

export type MemoryCandidateStatus = 'pending' | 'accepted' | 'rejected';
export type MemoryCandidateSource = 'self_observed' | 'manual' | 'session_end' | 'precompaction';

export interface MemoryCandidateCitation {
  sessionId?: string;
  messageId?: number;
  messageIndex?: number;
  role?: string;
  snippet: string;
}

export interface MemoryCandidateWriteSummary {
  status: MemoryWriteResult['status'];
  usage: MemoryWriteResult['usage'];
}

export interface MemoryCandidate {
  id: string;
  key: string;
  value: string;
  scope: MemoryScope;
  category: MemoryCategory;
  status: MemoryCandidateStatus;
  createdAt: number;
  source: MemoryCandidateSource;
  confidence?: number;
  rationale?: string;
  citations?: MemoryCandidateCitation[];
  reviewedAt?: number;
  reviewedBy?: string;
  reviewNote?: string;
  write?: MemoryCandidateWriteSummary;
}

export interface ProposeMemoryCandidateInput {
  key: string;
  value: string;
  scope?: MemoryScope;
  category?: MemoryCategory;
  source?: MemoryCandidateSource;
  confidence?: number;
  rationale?: string;
  citations?: MemoryCandidateCitation[];
}

export interface ProposeMemoryCandidateResult {
  candidate: MemoryCandidate;
  deduped: boolean;
}

export interface AcceptMemoryCandidateInput {
  reviewedBy: string;
  key?: string;
  value?: string;
  scope?: MemoryScope;
  category?: MemoryCategory;
  reviewNote?: string;
}

export interface AcceptMemoryCandidateResult {
  candidate: MemoryCandidate;
  write: MemoryWriteResult;
}

export interface RejectMemoryCandidateInput {
  reviewedBy?: string;
  reason?: string;
}

export interface MemoryCandidateStats {
  total: number;
  byStatus: Record<MemoryCandidateStatus, number>;
}

interface MemoryCandidateFile {
  schemaVersion: typeof MEMORY_CANDIDATE_SCHEMA_VERSION;
  candidates: MemoryCandidate[];
}

const registry = new Map<string, MemoryCandidateQueue>();

export function getMemoryCandidateQueue(workDir: string = process.cwd()): MemoryCandidateQueue {
  const key = path.resolve(workDir);
  if (!registry.has(key)) {
    registry.set(key, new MemoryCandidateQueue(key));
    if (registry.size > 20) {
      const firstKey = registry.keys().next().value;
      if (firstKey) registry.delete(firstKey);
    }
  }
  return registry.get(key)!;
}

export function resetMemoryCandidateQueues(): void {
  registry.clear();
}

export class MemoryCandidateQueue {
  private filePath: string;
  private candidates: MemoryCandidate[] = [];
  private loaded = false;

  constructor(
    private workDir: string = process.cwd(),
    private memoryManager?: PersistentMemoryManager,
  ) {
    this.filePath = path.join(workDir, '.codebuddy', 'memory-candidates.json');
  }

  propose(input: ProposeMemoryCandidateInput): ProposeMemoryCandidateResult {
    this.load();

    const key = normalizeText(input.key);
    const value = normalizeText(input.value);
    const scope = normalizeScope(input.scope);
    const category = normalizeCategory(input.category);

    if (!key) throw new Error('Memory candidate key is required.');
    if (!value) throw new Error('Memory candidate value is required.');

    const citations = sanitizeCitations(input.citations);
    const lintTarget = [
      key,
      value,
      input.rationale ?? '',
      ...citations.map((citation) => citation.snippet),
    ].join('\n');
    const lint = scanForSecrets(lintTarget);
    if (lint.hasSecrets) {
      throw new Error(`Memory candidate rejected before queueing: sensitive material detected (${lint.matches.map((m) => m.kind).join(', ')}).`);
    }

    const existing = this.candidates.find((candidate) =>
      candidate.status === 'pending' &&
      candidate.scope === scope &&
      candidate.key.trim().toLowerCase() === key.toLowerCase() &&
      candidate.value.trim().toLowerCase() === value.toLowerCase()
    );
    if (existing) {
      return { candidate: existing, deduped: true };
    }

    const candidate: MemoryCandidate = {
      id: `mc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      key,
      value,
      scope,
      category,
      status: 'pending',
      createdAt: Date.now(),
      source: input.source ?? 'self_observed',
      ...(typeof input.confidence === 'number' ? { confidence: clampConfidence(input.confidence) } : {}),
      ...(input.rationale?.trim() ? { rationale: input.rationale.trim() } : {}),
      ...(citations.length > 0 ? { citations } : {}),
    };

    this.candidates.push(candidate);
    this.save();
    return { candidate, deduped: false };
  }

  list(status?: MemoryCandidateStatus): MemoryCandidate[] {
    this.load();
    const items = status ? this.candidates.filter((candidate) => candidate.status === status) : this.candidates;
    return [...items].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): MemoryCandidate | null {
    this.load();
    return this.candidates.find((candidate) => candidate.id === id) ?? null;
  }

  async accept(id: string, input: AcceptMemoryCandidateInput): Promise<AcceptMemoryCandidateResult> {
    this.load();
    const reviewedBy = input.reviewedBy?.trim();
    if (!reviewedBy) {
      throw new Error('Human approval (reviewedBy) is required before a memory candidate can be written.');
    }

    const candidate = this.candidates.find((item) => item.id === id);
    if (!candidate) throw new Error(`Memory candidate not found: ${id}`);
    if (candidate.status !== 'pending') {
      throw new Error(`Memory candidate ${id} is already ${candidate.status}; only pending candidates can be accepted.`);
    }

    const key = input.key !== undefined ? normalizeText(input.key) : candidate.key;
    const value = input.value !== undefined ? normalizeText(input.value) : candidate.value;
    const scope = input.scope ? normalizeScope(input.scope) : candidate.scope;
    const category = input.category ? normalizeCategory(input.category) : candidate.category;
    if (!key) throw new Error('Accepted memory key cannot be empty.');
    if (!value) throw new Error('Accepted memory value cannot be empty.');

    const manager = this.memoryManager ?? getMemoryManager();
    await manager.initialize();
    const write = await manager.remember(key, value, {
      scope,
      category,
      tags: ['memory-candidate', candidate.id],
    });

    candidate.key = key;
    candidate.value = value;
    candidate.scope = scope;
    candidate.category = category;
    candidate.status = 'accepted';
    candidate.reviewedAt = Date.now();
    candidate.reviewedBy = reviewedBy;
    candidate.write = { status: write.status, usage: write.usage };
    if (input.reviewNote?.trim()) {
      candidate.reviewNote = input.reviewNote.trim();
    }
    this.save();

    return { candidate, write };
  }

  reject(id: string, input: RejectMemoryCandidateInput = {}): MemoryCandidate {
    this.load();
    const candidate = this.candidates.find((item) => item.id === id);
    if (!candidate) throw new Error(`Memory candidate not found: ${id}`);
    if (candidate.status === 'accepted') {
      throw new Error(`Memory candidate ${id} was already accepted and cannot be rejected.`);
    }

    candidate.status = 'rejected';
    candidate.reviewedAt = Date.now();
    if (input.reviewedBy?.trim()) {
      candidate.reviewedBy = input.reviewedBy.trim();
    }
    if (input.reason?.trim()) {
      candidate.reviewNote = input.reason.trim();
    }
    this.save();
    return candidate;
  }

  getStats(): MemoryCandidateStats {
    this.load();
    const byStatus: Record<MemoryCandidateStatus, number> = {
      pending: 0,
      accepted: 0,
      rejected: 0,
    };
    for (const candidate of this.candidates) {
      byStatus[candidate.status] += 1;
    }
    return { total: this.candidates.length, byStatus };
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = readJsonAtomicSync<MemoryCandidateFile>(this.filePath, {
        schemaVersion: MEMORY_CANDIDATE_SCHEMA_VERSION,
        candidates: [],
      }, {
        mode: 0o600,
        isValid: (value): value is MemoryCandidateFile => Boolean(
          value && typeof value === 'object' && Array.isArray((value as { candidates?: unknown }).candidates),
        ),
      });
      if (Array.isArray(parsed.candidates)) {
        this.candidates = parsed.candidates.filter(isValidCandidate);
      }
    } catch (err) {
      logger.warn('[memory-candidates] failed to load queue', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const file: MemoryCandidateFile = {
        schemaVersion: MEMORY_CANDIDATE_SCHEMA_VERSION,
        candidates: this.candidates,
      };
      writeJsonAtomicSync(this.filePath, file, { mode: 0o600 });
    } catch (err) {
      logger.warn('[memory-candidates] failed to save queue', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeScope(scope: MemoryScope | undefined): MemoryScope {
  return scope === 'user' ? 'user' : 'project';
}

function normalizeCategory(category: MemoryCategory | undefined): MemoryCategory {
  const normalized = category ?? 'context';
  if (!VALID_CATEGORIES.includes(normalized)) {
    throw new Error(`Memory category must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }
  return normalized;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sanitizeCitations(citations: MemoryCandidateCitation[] | undefined): MemoryCandidateCitation[] {
  if (!Array.isArray(citations)) return [];
  return citations
    .map((citation) => {
      const snippet = redactSecrets(normalizeText(citation.snippet)).slice(0, 280);
      if (!snippet) return null;
      return {
        ...(citation.sessionId ? { sessionId: citation.sessionId } : {}),
        ...(typeof citation.messageId === 'number' ? { messageId: citation.messageId } : {}),
        ...(typeof citation.messageIndex === 'number' ? { messageIndex: citation.messageIndex } : {}),
        ...(citation.role ? { role: citation.role } : {}),
        snippet,
      } satisfies MemoryCandidateCitation;
    })
    .filter((citation): citation is MemoryCandidateCitation => citation !== null)
    .slice(0, 3);
}

function isValidCandidate(value: unknown): value is MemoryCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MemoryCandidate>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.key === 'string' &&
    typeof candidate.value === 'string' &&
    (candidate.scope === 'project' || candidate.scope === 'user') &&
    typeof candidate.category === 'string' &&
    VALID_CATEGORIES.includes(candidate.category as MemoryCategory) &&
    (candidate.status === 'pending' || candidate.status === 'accepted' || candidate.status === 'rejected') &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.source === 'string'
  );
}
