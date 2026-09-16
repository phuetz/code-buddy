/**
 * Closed-learning-loop background writes (Hermes parity — opt-in, OFF by default).
 *
 * Hermes' headline behavioural differentiator is a *direct* background learning
 * loop: after a session the agent writes inferred observations/skills straight
 * into its memory, with no human gate. Code Buddy's safe-by-default posture keeps
 * every inferred candidate behind an explicit review queue (see
 * `lesson-candidate-queue.ts`, `user-model.ts`). This module closes the
 * behavioural-parity gap WITHOUT changing that default posture: it adds an
 * explicit opt-in that auto-accepts (writes in background) the narrow, safe
 * subset of candidates, while everything else keeps flowing through review.
 *
 * Hard safety contract (all enforced here, fail-closed):
 *
 *   1. OFF BY DEFAULT. Without `CODEBUDDY_LEARNING_BACKGROUND_WRITES=true` the
 *      promote step is a no-op and the current review-gated behaviour is
 *      byte-for-byte unchanged.
 *   2. CONFIDENCE THRESHOLD. Only candidates at/above
 *      `CODEBUDDY_LEARNING_BACKGROUND_WRITE_MIN_CONFIDENCE` (default 0.85) are
 *      auto-written; below-threshold candidates stay pending for review.
 *   3. ALLOWED CATEGORIES. Only `user-model observations` are auto-written by
 *      default. Sensitive writes (skills) stay gated unless the dedicated
 *      `CODEBUDDY_LEARNING_BACKGROUND_WRITE_SKILLS=true` opt-in is ALSO set.
 *   4. REAL WRITE PATH. Auto-writes route through `LocalUserModel.accept(...)`,
 *      so the privacy screen re-runs and rejects sensitive content even when the
 *      flag is ON; rollback is the existing `discard(id)`.
 *   5. TRACEABILITY. Each auto-write is stamped with a non-human reviewer
 *      sentinel (`auto:background-write`) so the learning-loop status can
 *      distinguish "auto-written" from "human-approved", and is recorded in an
 *      auditable side-car (`.codebuddy/learning/background-writes.json`).
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';
import type { LocalUserModel, UserObservation } from '../memory/user-model.js';

/** Reviewer sentinel stamped on every background auto-write. */
export const BACKGROUND_WRITE_REVIEWER = 'auto:background-write';

export const BACKGROUND_WRITE_AUDIT_SCHEMA_VERSION = 1;

/** Default confidence threshold. Tuned so 0.85+ local-inference cues auto-write. */
export const DEFAULT_BACKGROUND_WRITE_MIN_CONFIDENCE = 0.85;

/** Categories eligible for background auto-write. Observations only by default. */
export type BackgroundWriteCategory = 'observation' | 'skill';

const AUDIT_DIR = path.join('.codebuddy', 'learning');
const AUDIT_FILE = 'background-writes.json';
const TRUTHY = new Set(['1', 'true', 'on', 'yes', 'enabled']);

export interface BackgroundWritePolicy {
  /** Master opt-in. OFF by default → no auto-writes at all. */
  enabled: boolean;
  /** Min confidence (0..1) for an auto-write; below → stays in review queue. */
  minConfidence: number;
  /** Whether sensitive skill writes are also opted-in (separate flag). */
  allowSkillWrites: boolean;
  /** The safe categories currently auto-writable under this policy. */
  allowedCategories: BackgroundWriteCategory[];
}

export interface BackgroundWriteAuditEntry {
  category: BackgroundWriteCategory;
  confidence?: number;
  content: string;
  observationId: string;
  reviewer: typeof BACKGROUND_WRITE_REVIEWER;
  writtenAt: string;
}

interface BackgroundWriteAuditFile {
  schemaVersion: typeof BACKGROUND_WRITE_AUDIT_SCHEMA_VERSION;
  entries: BackgroundWriteAuditEntry[];
}

export interface PromoteObservationsResult {
  /** Observations that were auto-accepted into the active model in background. */
  autoWritten: UserObservation[];
  /** Observations left pending for human review (below threshold / refused). */
  deferred: UserObservation[];
}

/**
 * Resolve the background-write policy from the environment. Fail-closed: unknown
 * / unset values disable auto-writes. Intentionally does NOT inherit
 * `isLearningAgentEnabled()`'s test auto-disable — the flag must be explicitly
 * turn-on-able under any NODE_ENV.
 */
export function getBackgroundWritePolicy(): BackgroundWritePolicy {
  const enabled = TRUTHY.has(normalizeEnv(process.env.CODEBUDDY_LEARNING_BACKGROUND_WRITES));
  const allowSkillWrites =
    enabled && TRUTHY.has(normalizeEnv(process.env.CODEBUDDY_LEARNING_BACKGROUND_WRITE_SKILLS));
  const allowedCategories: BackgroundWriteCategory[] = enabled
    ? allowSkillWrites
      ? ['observation', 'skill']
      : ['observation']
    : [];
  return {
    enabled,
    minConfidence: resolveMinConfidence(),
    allowSkillWrites,
    allowedCategories,
  };
}

export function isBackgroundWritesEnabled(): boolean {
  return getBackgroundWritePolicy().enabled;
}

/**
 * Promote freshly-proposed pending observations: auto-accept the eligible ones
 * (flag ON + at/above threshold) and defer the rest to the review queue.
 *
 * Always a no-op when the flag is OFF, so callers can invoke it unconditionally
 * right after proposing. Routes through the real `accept(...)` write path so the
 * privacy screen and rollback semantics are preserved.
 */
export function promoteObservations(
  model: LocalUserModel,
  proposed: UserObservation[],
  workDir: string = process.cwd()
): PromoteObservationsResult {
  const policy = getBackgroundWritePolicy();
  const autoWritten: UserObservation[] = [];
  const deferred: UserObservation[] = [];
  if (!policy.enabled || !policy.allowedCategories.includes('observation')) {
    return { autoWritten, deferred: [...proposed] };
  }

  for (const observation of proposed) {
    if (observation.status !== 'pending') {
      deferred.push(observation);
      continue;
    }
    const confidence = typeof observation.confidence === 'number' ? observation.confidence : 0;
    if (confidence < policy.minConfidence) {
      deferred.push(observation);
      continue;
    }

    try {
      const accepted = model.accept(observation.id, {
        reviewedBy: BACKGROUND_WRITE_REVIEWER,
        reviewNote: `auto-written in background (confidence ${confidence.toFixed(2)} >= ${policy.minConfidence})`,
      });
      autoWritten.push(accepted);
      recordBackgroundWriteAudit(workDir, {
        category: 'observation',
        ...(typeof accepted.confidence === 'number' ? { confidence: accepted.confidence } : {}),
        content: accepted.content,
        observationId: accepted.id,
        reviewer: BACKGROUND_WRITE_REVIEWER,
        writtenAt: new Date().toISOString(),
      });
      logger.info('[learning-background-writes] auto-wrote user observation', {
        id: accepted.id,
        kind: accepted.kind,
        confidence: accepted.confidence,
      });
    } catch (err) {
      // Privacy refusals (and any other accept failure) fall back to review.
      // Detect the privacy screen by error name to avoid a runtime import cycle
      // with `user-model.ts` (type-only import keeps this module edge-free).
      if (err instanceof Error && err.name === 'UserModelPrivacyError') {
        logger.warn(
          '[learning-background-writes] auto-write refused by privacy screen; deferring to review',
          {
            id: observation.id,
          }
        );
      } else {
        logger.warn('[learning-background-writes] auto-write failed; deferring to review', {
          id: observation.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      deferred.push(observation);
    }
  }

  return { autoWritten, deferred };
}

/** Read the background-write audit trail (newest entries appended last). */
export function listBackgroundWriteAudit(
  workDir: string = process.cwd()
): BackgroundWriteAuditEntry[] {
  const filePath = path.join(path.resolve(workDir), AUDIT_DIR, AUDIT_FILE);
  return readAuditFile(filePath).entries;
}

function recordBackgroundWriteAudit(workDir: string, entry: BackgroundWriteAuditEntry): void {
  const filePath = path.join(path.resolve(workDir), AUDIT_DIR, AUDIT_FILE);
  const file = readAuditFile(filePath);
  file.entries.push(entry);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeJsonAtomicSync(filePath, file, { mode: 0o600 });
  } catch (err) {
    logger.warn('[learning-background-writes] failed to persist audit entry', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function readAuditFile(filePath: string): BackgroundWriteAuditFile {
  try {
    const parsed = readJsonAtomicSync<BackgroundWriteAuditFile | null>(filePath, null, {
      mode: 0o600,
      isValid: (value): value is BackgroundWriteAuditFile => Boolean(
        value && typeof value === 'object' &&
        (value as BackgroundWriteAuditFile).schemaVersion === BACKGROUND_WRITE_AUDIT_SCHEMA_VERSION &&
        Array.isArray((value as BackgroundWriteAuditFile).entries),
      ),
    });
    if (parsed) return parsed;
  } catch {
    // Fall through to a fresh file.
  }
  return { schemaVersion: BACKGROUND_WRITE_AUDIT_SCHEMA_VERSION, entries: [] };
}

function resolveMinConfidence(): number {
  const raw = (process.env.CODEBUDDY_LEARNING_BACKGROUND_WRITE_MIN_CONFIDENCE ?? '').trim();
  if (!raw) return DEFAULT_BACKGROUND_WRITE_MIN_CONFIDENCE;
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_BACKGROUND_WRITE_MIN_CONFIDENCE;
  return Math.min(1, Math.max(0, value));
}

function normalizeEnv(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}
