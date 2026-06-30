/**
 * Protected subset (Phase C): the files an evolving variant must NOT be able to change, because
 * they are what VALIDATE the variant. The real self-improvement invariant is "an improvement can
 * never weaken the gates that validate it" (self-knowledge.ts:19) — so the gates, the benchmarks,
 * the held-out eval data, the scoring harness, AND this evolution module itself are off-limits.
 *
 * A candidate branch that touches any protected path is REJECTED before it is ever scored
 * (so it can't, e.g., edit its own tests to pass trivially). Defense-in-depth: callers may also
 * reset these paths to the baseline inside the worktree before scoring.
 *
 * @module agent/self-improvement/evolution/protected-paths
 */

import { execFileSync } from 'child_process';

/**
 * Glob patterns (POSIX, `/`-separated, repo-relative). Keep this list EXHAUSTIVE — a gap here is
 * how reward-hacking gets in. A test asserts every known gate/benchmark file is matched.
 */
export const PROTECTED_GLOBS: readonly string[] = [
  // Whole-agent held-out eval harness + tasks
  'eval/**',
  // The evolution machinery itself (fitness, scorer, store, this file, the CLI)
  'src/agent/self-improvement/evolution/**',
  // Every gate (empirical/tool/skill/paired/execution/authored-artifact all end in -gate.ts)
  'src/agent/self-improvement/**/*-gate.ts',
  // Every benchmark / held-out ground truth (capability/tool/skill)
  'src/agent/self-improvement/**/*-benchmark.ts',
  // Scoring harness + counterfactual runner + proposer-redaction + the stated limits
  'src/agent/self-improvement/sandbox-scorer.ts',
  'src/agent/self-improvement/paired-runner.ts',
  'src/agent/self-improvement/tool-proposer.ts',
  'src/agent/self-improvement/self-knowledge.ts',
  // Security scanners the skill firewall relies on
  'src/security/skill-scanner.ts',
  'src/security/dangerous-patterns.ts',
  // Tests that verify the gates / self-improvement (used by the fitness unit-tests component)
  'tests/agent/self-improvement/**',
];

const DSTAR_SLASH = '@@DSTARSLASH@@';
const DSTAR = '@@DSTAR@@';

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped
    .replace(/\*\*\//g, DSTAR_SLASH) // **/  → optional dir prefix
    .replace(/\*\*/g, DSTAR) // **   → anything incl. /
    .replace(/\*/g, '[^/]*') // *    → within a segment
    .replace(new RegExp(DSTAR_SLASH, 'g'), '(?:.*/)?')
    .replace(new RegExp(DSTAR, 'g'), '.*');
  return new RegExp(`^${body}$`);
}

const COMPILED = PROTECTED_GLOBS.map(globToRegExp);

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** True if a repo-relative path is in the protected subset. */
export function isProtectedPath(path: string): boolean {
  const p = normalizeRel(path);
  return COMPILED.some((re) => re.test(p));
}

/** Subset of the given paths that are protected. */
export function findProtectedChanges(paths: string[]): string[] {
  return paths.filter(isProtectedPath);
}

/** Files a branch changes relative to a base ref (three-dot = changes introduced on the branch). */
export function changedPathsVsBase(branch: string, baseRef: string, cwd: string): string[] {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${baseRef}...${branch}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export interface ProtectedCheck {
  ok: boolean;
  violations: string[];
}

/** Reject a variant that touches any protected path. The core anti-self-weakening guard. */
export function assertNoProtectedChanges(branch: string, baseRef: string, cwd: string): ProtectedCheck {
  const violations = findProtectedChanges(changedPathsVsBase(branch, baseRef, cwd));
  return { ok: violations.length === 0, violations };
}

/** Defense-in-depth: restore protected paths to the baseline inside a worktree before scoring. */
export function resetProtectedToBaseline(worktreeDir: string, baseRef: string): void {
  const pathspecs = PROTECTED_GLOBS.map((g) => `:(glob)${g}`);
  try {
    execFileSync('git', ['checkout', baseRef, '--', ...pathspecs], {
      cwd: worktreeDir,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    /* best effort — the reject-on-touch check is the primary guard */
  }
}
