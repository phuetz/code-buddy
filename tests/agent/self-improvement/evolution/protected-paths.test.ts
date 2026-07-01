import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  isProtectedPath,
  findProtectedChanges,
} from '../../../../src/agent/self-improvement/evolution/protected-paths.js';

describe('protected-paths', () => {
  it('protects gates, benchmarks, eval, harness, evolution module, security scanners, tests', () => {
    for (const p of [
      'eval/run-task.mjs',
      'eval/tasks/simple-edit/contract.json',
      'src/agent/self-improvement/empirical-gate.ts',
      'src/agent/self-improvement/authored-artifact-gate.ts',
      'src/agent/self-improvement/capability-benchmark.ts',
      'src/agent/self-improvement/evolution/variant-fitness.ts',
      'src/agent/self-improvement/sandbox-scorer.ts',
      'src/agent/self-improvement/tool-proposer.ts',
      'src/agent/self-improvement/self-knowledge.ts',
      'src/security/skill-scanner.ts',
      'tests/agent/self-improvement/evolution/protected-paths.test.ts',
    ]) {
      expect(isProtectedPath(p), p).toBe(true);
    }
  });

  it('does NOT protect ordinary source (so the agent CAN evolve real code)', () => {
    for (const p of [
      'src/agent/codebuddy-agent.ts',
      'src/tools/git-tool.ts',
      'src/agent/self-improvement/engine.ts', // engine is improvable; only gates/benchmarks are frozen
      'README.md',
    ]) {
      expect(isProtectedPath(p), p).toBe(false);
    }
  });

  it('findProtectedChanges flags only the protected subset', () => {
    const changed = ['src/agent/codebuddy-agent.ts', 'src/agent/self-improvement/tool-gate.ts', 'docs/x.md'];
    expect(findProtectedChanges(changed)).toEqual(['src/agent/self-improvement/tool-gate.ts']);
  });

  // The load-bearing completeness guard: a gap here is how reward-hacking gets in.
  it('EVERY *-gate.ts and *-benchmark.ts under self-improvement is protected', () => {
    const root = 'src/agent/self-improvement';
    if (!existsSync(root)) return; // defensive
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name);
        return e.isDirectory() ? walk(full) : [full];
      });
    const critical = walk(root).filter((f) => /-gate\.ts$|-benchmark\.ts$/.test(f));
    expect(critical.length).toBeGreaterThan(0);
    for (const f of critical) {
      expect(isProtectedPath(f), `${f} must be protected`).toBe(true);
    }
  });
});
