/**
 * User deny-rule guard for bash commands (Hermes-parity: user-defined deny
 * rules block commands EVEN under YOLO).
 *
 * The allowlist store (`~/.codebuddy/exec-approvals.json`, managed via
 * `/allowlist deny <pattern>`) existed but was consulted nowhere on the real
 * execution path — deny patterns blocked nothing. This guard is the missing
 * consumer: a synchronous check wired into the SHARED command validator
 * (`src/tools/bash/command-validator.ts`), which both the buffered and the
 * streaming bash paths run unconditionally — YOLO skips confirmations, never
 * validation, so a user deny rule is a hard stop in every mode.
 *
 * Sync + fail-open by design: a missing/corrupt store must never break bash
 * (it only disables the extra guard); the file is re-read when its mtime
 * changes so `/allowlist deny` edits apply without a restart.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { matchApprovalPattern } from './pattern-matcher.js';
import type { ApprovalPattern } from './types.js';

export interface DenyRuleVerdict {
  denied: boolean;
  /** The matched pattern text (for the refusal message). */
  pattern?: string;
  /** The pattern's human description, when set. */
  description?: string;
}

let cache: { mtimeMs: number; patterns: ApprovalPattern[] } | null = null;

function storePath(): string {
  return path.join(process.env.CODEBUDDY_HOME ?? path.join(os.homedir(), '.codebuddy'), 'exec-approvals.json');
}

function loadDenyPatterns(): ApprovalPattern[] {
  try {
    const file = storePath();
    const stat = fs.statSync(file);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.patterns;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { patterns?: ApprovalPattern[] };
    const patterns = (parsed.patterns ?? []).filter((p) => p.enabled && p.decision === 'deny');
    cache = { mtimeMs: stat.mtimeMs, patterns };
    return patterns;
  } catch {
    // No store / unreadable / invalid JSON → no user deny rules.
    return [];
  }
}

/** Test hook: drop the mtime cache so the next check re-reads the store. */
export function resetDenyGuardCache(): void {
  cache = null;
}

/**
 * Check a command against the user's deny rules. Called from the shared
 * command validator — must stay synchronous and cheap.
 */
export function checkUserDenyRules(
  command: string,
  cwd: string = process.cwd(),
): DenyRuleVerdict {
  const patterns = loadDenyPatterns();
  const canonicalCwd = path.resolve(cwd);
  for (const pattern of patterns) {
    if (pattern.cwd && path.resolve(pattern.cwd) !== canonicalCwd) continue;
    if (matchApprovalPattern(command, pattern)) {
      return { denied: true, pattern: pattern.pattern, description: pattern.description };
    }
  }
  return { denied: false };
}
