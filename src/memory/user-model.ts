/**
 * Local user model (Hermes parity — "a deepening model of who you are").
 *
 * Hermes' headline pairs the learning loop with a model of the user that
 * deepens across sessions. Code Buddy already has the learning-loop half
 * (lessons + the lesson-candidate review queue). This is the paired half: a
 * STRUCTURED, queryable, review-gated model of the user's working preferences
 * built from typed observations — distinct from the free-form key/value
 * `CODEBUDDY_MEMORY.md` store.
 *
 * Two deliberate constraints, mirroring the lesson-candidate queue:
 *
 *   1. NO SILENT WRITE. The agent (or a human) PROPOSES observations; nothing
 *      enters the active model until a human accepts one. Proposing only writes
 *      the side-car `.codebuddy/user-model.json`.
 *
 *   2. NARROW PRIVACY SCOPE. Only working preferences, traits, expertise and
 *      working-style are in scope. Health, finances, relationships, credentials
 *      and other sensitive personal data are screened out and refused — this
 *      file must never become a dossier. (See SENSITIVE_PATTERNS.)
 *
 * This is NOT Honcho's LLM-driven dialectic inference; it is a local
 * file-backed observation store with a structured summary. LLM inference over
 * it remains future work.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

export const USER_MODEL_SCHEMA_VERSION = 1;

export type UserObservationKind = 'preference' | 'trait' | 'expertise' | 'working-style';
export type UserObservationStatus = 'pending' | 'accepted' | 'discarded';

export const USER_OBSERVATION_KINDS: UserObservationKind[] = [
  'preference',
  'trait',
  'expertise',
  'working-style',
];

/**
 * Conservative screen for content that must never be recorded in the user
 * model. Matching is case-insensitive and intentionally broad — when in doubt,
 * the observation is refused rather than stored.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(health|medical|illness|disease|diagnos|disabilit|mdph|therapy|medication|mental health)\b/i,
  /\b(salary|wage|income|net worth|bank|iban|credit card|ssn|social security|tax)\b/i,
  /\b(relationship|married|divorce|girlfriend|boyfriend|partner|spouse|family)\b/i,
  /\b(password|api[_ -]?key|secret|token|credential)\b/i,
  /\b(religio|political|sexual|ethnicit|race)\b/i,
];

export interface UserObservationProvenance {
  runId?: string;
  sessionId?: string;
  note?: string;
}

export interface UserObservation {
  id: string;
  kind: UserObservationKind;
  content: string;
  /** 0..1 confidence the proposer attaches; informational only. */
  confidence?: number;
  status: UserObservationStatus;
  createdAt: number;
  source: 'self_observed' | 'manual';
  provenance?: UserObservationProvenance;
  reviewedAt?: number;
  reviewedBy?: string;
  reviewNote?: string;
}

export interface ObserveUserInput {
  kind: UserObservationKind;
  content: string;
  confidence?: number;
  source?: 'self_observed' | 'manual';
  provenance?: UserObservationProvenance;
}

export interface ObserveUserResult {
  observation: UserObservation;
  /** True when an equivalent pending/accepted observation already existed. */
  deduped: boolean;
}

export interface AcceptUserObservationInput {
  /** Explicit human reviewer — required. Accepting is the only model write. */
  reviewedBy: string;
  content?: string;
  kind?: UserObservationKind;
  reviewNote?: string;
}

export interface DiscardUserObservationInput {
  reviewedBy?: string;
  reason?: string;
}

export interface UserModelStats {
  total: number;
  byStatus: Record<UserObservationStatus, number>;
  byKind: Record<UserObservationKind, number>;
}

interface UserModelFile {
  schemaVersion: typeof USER_MODEL_SCHEMA_VERSION;
  observations: UserObservation[];
}

/** Raised when an observation is refused by the privacy screen. */
export class UserModelPrivacyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserModelPrivacyError';
  }
}

// ============================================================================
// Singleton registry (one model per working directory)
// ============================================================================

const registry = new Map<string, LocalUserModel>();

export function getUserModel(workDir: string = process.cwd()): LocalUserModel {
  const key = path.resolve(workDir);
  if (!registry.has(key)) {
    registry.set(key, new LocalUserModel(key));
    if (registry.size > 20) {
      const firstKey = registry.keys().next().value;
      if (firstKey) registry.delete(firstKey);
    }
  }
  return registry.get(key)!;
}

/** Test helper: drop cached model instances so a fresh workDir is re-read. */
export function resetUserModels(): void {
  registry.clear();
}

/** Screen content against the privacy boundary. Returns the reason on a hit. */
export function screenUserModelContent(content: string): string | null {
  for (const pattern of SENSITIVE_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      return `refused: "${match[0]}" is outside the user-model privacy scope (working preferences only)`;
    }
  }
  return null;
}

// ============================================================================
// LocalUserModel
// ============================================================================

export class LocalUserModel {
  private filePath: string;
  private observations: UserObservation[] = [];
  private loaded = false;

  constructor(private workDir: string = process.cwd()) {
    // Workspace-scoped for now (mirrors the lesson-candidate queue). A
    // cross-workspace / ~/.codebuddy merge is future work.
    this.filePath = path.join(workDir, '.codebuddy', 'user-model.json');
  }

  /**
   * Propose an observation about the user. This is the "agent proposes" half:
   * it never folds into the active model. Equivalent pending/accepted
   * observations (same kind + content) collapse onto the existing one, and
   * sensitive content is refused by the privacy screen.
   */
  observe(input: ObserveUserInput): ObserveUserResult {
    this.load();
    const kind = normalizeKind(input.kind);
    const content = (input.content ?? '').trim();
    if (!content) {
      throw new Error('User observation content is required.');
    }

    const privacyReason = screenUserModelContent(content);
    if (privacyReason) {
      throw new UserModelPrivacyError(privacyReason);
    }

    const existing = this.observations.find(
      (obs) =>
        obs.status !== 'discarded' &&
        obs.kind === kind &&
        obs.content.trim().toLowerCase() === content.toLowerCase(),
    );
    if (existing) {
      return { observation: existing, deduped: true };
    }

    const observation: UserObservation = {
      id: `um-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      kind,
      content,
      ...(typeof input.confidence === 'number' ? { confidence: clampConfidence(input.confidence) } : {}),
      status: 'pending',
      createdAt: Date.now(),
      source: input.source ?? 'self_observed',
      ...(input.provenance && hasProvenance(input.provenance) ? { provenance: input.provenance } : {}),
    };
    this.observations.push(observation);
    this.save();
    return { observation, deduped: false };
  }

  list(status?: UserObservationStatus): UserObservation[] {
    this.load();
    const items = status ? this.observations.filter((o) => o.status === status) : this.observations;
    return [...items].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): UserObservation | null {
    this.load();
    return this.observations.find((o) => o.id === id) ?? null;
  }

  /** The active model: accepted observations only. */
  getAccepted(kind?: UserObservationKind): UserObservation[] {
    this.load();
    return this.observations.filter((o) => o.status === 'accepted' && (!kind || o.kind === kind));
  }

  /**
   * Accept a pending observation into the active model. The ONLY method that
   * mutates the model. Requires an explicit human reviewer; supports inline
   * edits. Re-screens edited content against the privacy boundary.
   */
  accept(id: string, input: AcceptUserObservationInput): UserObservation {
    this.load();
    const reviewedBy = input.reviewedBy?.trim();
    if (!reviewedBy) {
      throw new Error('Human approval (reviewedBy) is required before an observation enters the user model.');
    }

    const obs = this.observations.find((o) => o.id === id);
    if (!obs) {
      throw new Error(`User observation not found: ${id}`);
    }
    if (obs.status !== 'pending') {
      throw new Error(`User observation ${id} is already ${obs.status}; only pending observations can be accepted.`);
    }

    const kind = input.kind ? normalizeKind(input.kind) : obs.kind;
    const content = (input.content ?? obs.content).trim();
    if (!content) {
      throw new Error('Accepted observation content cannot be empty.');
    }
    const privacyReason = screenUserModelContent(content);
    if (privacyReason) {
      throw new UserModelPrivacyError(privacyReason);
    }

    obs.status = 'accepted';
    obs.kind = kind;
    obs.content = content;
    obs.reviewedAt = Date.now();
    obs.reviewedBy = reviewedBy;
    if (input.reviewNote?.trim()) {
      obs.reviewNote = input.reviewNote.trim();
    }
    this.save();
    return obs;
  }

  /** Reject an observation. Discarding an accepted one removes it from the model. */
  discard(id: string, input: DiscardUserObservationInput = {}): UserObservation {
    this.load();
    const obs = this.observations.find((o) => o.id === id);
    if (!obs) {
      throw new Error(`User observation not found: ${id}`);
    }
    obs.status = 'discarded';
    obs.reviewedAt = Date.now();
    if (input.reviewedBy?.trim()) {
      obs.reviewedBy = input.reviewedBy.trim();
    }
    if (input.reason?.trim()) {
      obs.reviewNote = input.reason.trim();
    }
    this.save();
    return obs;
  }

  /**
   * Build a compact prompt-injection block from accepted observations, grouped
   * by kind. Returns null when the model is empty (avoids noisy injection).
   */
  summarize(): string | null {
    this.load();
    const accepted = this.observations.filter((o) => o.status === 'accepted');
    if (accepted.length === 0) return null;

    const lines = ['<user_model>', '## What we know about the user (accepted, working preferences only)', ''];
    const labels: Record<UserObservationKind, string> = {
      preference: 'Preferences',
      trait: 'Traits',
      expertise: 'Expertise',
      'working-style': 'Working style',
    };
    for (const kind of USER_OBSERVATION_KINDS) {
      const items = accepted.filter((o) => o.kind === kind);
      if (items.length === 0) continue;
      lines.push(`**${labels[kind]}:**`);
      for (const item of items) {
        lines.push(`- ${item.content}`);
      }
    }
    lines.push('</user_model>');
    return lines.join('\n');
  }

  getStats(): UserModelStats {
    this.load();
    const byStatus: Record<UserObservationStatus, number> = { pending: 0, accepted: 0, discarded: 0 };
    const byKind: Record<UserObservationKind, number> = {
      preference: 0,
      trait: 0,
      expertise: 0,
      'working-style': 0,
    };
    for (const obs of this.observations) {
      byStatus[obs.status] += 1;
      byKind[obs.kind] += 1;
    }
    return { total: this.observations.length, byStatus, byKind };
  }

  /** Clear observations (all, or only one status). Returns the count removed. */
  clear(status?: UserObservationStatus): number {
    this.load();
    const before = this.observations.length;
    this.observations = status ? this.observations.filter((o) => o.status !== status) : [];
    this.save();
    return before - this.observations.length;
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as UserModelFile;
      if (Array.isArray(parsed.observations)) {
        this.observations = parsed.observations.filter(isValidObservation);
      }
    } catch (err) {
      logger.warn('[user-model] failed to load model', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const file: UserModelFile = {
        schemaVersion: USER_MODEL_SCHEMA_VERSION,
        observations: this.observations,
      };
      fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[user-model] failed to save model', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeKind(value: UserObservationKind | string): UserObservationKind {
  const lower = String(value ?? '').toLowerCase() as UserObservationKind;
  if (!USER_OBSERVATION_KINDS.includes(lower)) {
    throw new Error(`kind must be one of: ${USER_OBSERVATION_KINDS.join(', ')}`);
  }
  return lower;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function hasProvenance(provenance: UserObservationProvenance): boolean {
  return Boolean(provenance.runId || provenance.sessionId || provenance.note);
}

function isValidObservation(value: unknown): value is UserObservation {
  if (typeof value !== 'object' || value === null) return false;
  const obs = value as Partial<UserObservation>;
  return (
    typeof obs.id === 'string' &&
    typeof obs.content === 'string' &&
    typeof obs.kind === 'string' &&
    USER_OBSERVATION_KINDS.includes(obs.kind as UserObservationKind) &&
    (obs.status === 'pending' || obs.status === 'accepted' || obs.status === 'discarded')
  );
}
