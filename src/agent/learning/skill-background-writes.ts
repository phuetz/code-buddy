/**
 * Closed-learning-loop background SKILL writes (Hermes parity — opt-in, OFF by default).
 *
 * This is the skill-side companion to `learning-background-writes.ts` (which
 * auto-writes user-model OBSERVATIONS). Hermes' background review writes skills
 * DIRECTLY with no human gate. Code Buddy matches that autonomy while keeping a
 * reversible objective net that Hermes does not have:
 *
 *   1. OFF BY DEFAULT. Without `CODEBUDDY_LEARNING_BACKGROUND_WRITE_SKILLS=true`
 *      (which itself requires `CODEBUDDY_LEARNING_BACKGROUND_WRITES=true`), this
 *      is a no-op and skill candidates stay in the human review queue.
 *   2. SENTINEL APPROVER. Auto-installs route through the SAME
 *      `installResearchScriptSkillCandidate(...)` path used by human review,
 *      stamped with a non-human reviewer sentinel (`auto:gate-passed`) so the
 *      provenance is auditable and distinguishable from human approval.
 *   3. CONTENT SCREEN. A secret/omission screen (shared with the empirical gate)
 *      runs before any write, fail-closed.
 *   4. OBJECTIVE GATE (optional, see S3). When a behavioural gate is supplied it
 *      must accept before install; an inert/regressing skill is left pending.
 *   5. REVERSIBILITY + AUDIT. Installs are recorded in an auditable side-car
 *      (`.codebuddy/learning/skill-writes.json`) and remain reversible through
 *      SkillsHub (new skill → uninstall; existing-skill patch → snapshot rollback).
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { getBackgroundWritePolicy } from '../learning-background-writes.js';
import { OMISSION_RE, SECRET_RE } from '../self-improvement/empirical-gate.js';
import {
  installResearchScriptSkillCandidate,
  type InstalledResearchScriptSkillCandidate,
  type ResearchScriptSkillCandidate,
} from '../research-script-skill-candidate.js';

/** Reviewer sentinel stamped on every gate-passed background skill install. */
export const SKILL_BACKGROUND_WRITE_REVIEWER = 'auto:gate-passed';

export const SKILL_WRITE_AUDIT_SCHEMA_VERSION = 1;

const AUDIT_DIR = path.join('.codebuddy', 'learning');
const AUDIT_FILE = 'skill-writes.json';

/** Verdict returned by an optional behavioural gate (wired in S3). */
export interface SkillGateVerdict {
  accepted: boolean;
  reason: string;
}

/** A behavioural gate over a materialized skill candidate. */
export type SkillGate = (
  candidate: ResearchScriptSkillCandidate,
) => Promise<SkillGateVerdict> | SkillGateVerdict;

export interface PromoteSkillCandidateOptions {
  /** Workspace root that owns `.codebuddy/`. Defaults to cwd. */
  workDir?: string;
  /** Overwrite an already-installed skill of the same name. Default false. */
  overwrite?: boolean;
  /**
   * Optional behavioural gate. When provided it must accept before install.
   * When omitted, the structural/secret screen + flag are the only net (S1).
   */
  gate?: SkillGate;
}

export interface PromoteSkillCandidateResult {
  installed: boolean;
  reason: string;
  skillName: string;
  installedPath?: string;
}

export interface SkillWriteAuditEntry {
  candidateId: string;
  installedPath: string;
  reviewer: typeof SKILL_BACKGROUND_WRITE_REVIEWER;
  skillName: string;
  sourceCandidatePath: string;
  writtenAt: string;
}

interface SkillWriteAuditFile {
  schemaVersion: typeof SKILL_WRITE_AUDIT_SCHEMA_VERSION;
  entries: SkillWriteAuditEntry[];
}

/**
 * Promote a single materialized skill candidate to an installed workspace skill
 * in the background, WITHOUT human review — gated by the opt-in flag, a content
 * screen, and (when supplied) a behavioural gate. Always a no-op when the flag
 * is OFF, so callers can invoke it unconditionally.
 */
export async function promoteSkillCandidate(
  candidate: ResearchScriptSkillCandidate,
  options: PromoteSkillCandidateOptions = {},
): Promise<PromoteSkillCandidateResult> {
  const workDir = options.workDir ?? process.cwd();
  const skillName = candidate.skillName;

  const policy = getBackgroundWritePolicy();
  if (!policy.enabled || !policy.allowSkillWrites) {
    return { installed: false, reason: 'background skill writes disabled', skillName };
  }

  if (!candidate.eligible) {
    return { installed: false, reason: candidate.reason || 'candidate not eligible', skillName };
  }

  const screenProblem = screenSkillContent(candidate.markdown);
  if (screenProblem) {
    logger.warn('[skill-background-writes] candidate refused by content screen; left pending', {
      skillName,
      reason: screenProblem,
    });
    return { installed: false, reason: screenProblem, skillName };
  }

  if (options.gate) {
    const verdict = await options.gate(candidate);
    if (!verdict.accepted) {
      logger.info('[skill-background-writes] behavioural gate rejected candidate; left pending', {
        skillName,
        reason: verdict.reason,
      });
      return { installed: false, reason: verdict.reason, skillName };
    }
  }

  let installed: InstalledResearchScriptSkillCandidate;
  try {
    installed = await installResearchScriptSkillCandidate(candidate, {
      approvedBy: SKILL_BACKGROUND_WRITE_REVIEWER,
      overwrite: options.overwrite ?? false,
      rootDir: workDir,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn('[skill-background-writes] auto-install failed; left pending', { skillName, reason });
    return { installed: false, reason, skillName };
  }

  recordSkillWriteAudit(workDir, {
    candidateId: candidate.id,
    installedPath: installed.installedPath,
    reviewer: SKILL_BACKGROUND_WRITE_REVIEWER,
    skillName,
    sourceCandidatePath: installed.sourceCandidatePath,
    writtenAt: new Date().toISOString(),
  });
  logger.info('[skill-background-writes] auto-installed skill from background review', {
    skillName,
    installedPath: installed.installedPath,
  });

  return {
    installed: true,
    reason: 'installed',
    skillName,
    installedPath: installed.installedPath,
  };
}

/** Returns a problem string if the skill markdown must not be auto-written, else null. */
export function screenSkillContent(markdown: string): string | null {
  const content = markdown?.trim() ?? '';
  if (content.length < 12) return 'skill content too short to be useful';
  if (OMISSION_RE.test(content)) return 'skill content contains an omission placeholder';
  if (SECRET_RE.test(content)) return 'skill content looks like it contains a secret';
  return null;
}

/** Read the background skill-write audit trail (newest entries appended last). */
export function listSkillWriteAudit(workDir: string = process.cwd()): SkillWriteAuditEntry[] {
  const filePath = path.join(path.resolve(workDir), AUDIT_DIR, AUDIT_FILE);
  return readAuditFile(filePath).entries;
}

function recordSkillWriteAudit(workDir: string, entry: SkillWriteAuditEntry): void {
  const filePath = path.join(path.resolve(workDir), AUDIT_DIR, AUDIT_FILE);
  const file = readAuditFile(filePath);
  file.entries.push(entry);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf-8');
  } catch (err) {
    logger.warn('[skill-background-writes] failed to persist audit entry', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function readAuditFile(filePath: string): SkillWriteAuditFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SkillWriteAuditFile;
    if (parsed.schemaVersion === SKILL_WRITE_AUDIT_SCHEMA_VERSION && Array.isArray(parsed.entries)) {
      return parsed;
    }
  } catch {
    // Fall through to a fresh file.
  }
  return { schemaVersion: SKILL_WRITE_AUDIT_SCHEMA_VERSION, entries: [] };
}
