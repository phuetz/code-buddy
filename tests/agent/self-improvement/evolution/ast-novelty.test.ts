import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { checkAstNovelty } from '../../../../src/agent/self-improvement/evolution/ast-novelty.js';
import { runEvolutionCycle } from '../../../../src/agent/self-improvement/evolution/evolution-engine.js';
import { CodeVariantStore } from '../../../../src/agent/self-improvement/evolution/code-variant-store.js';
import { validateToolProposal } from '../../../../src/agent/self-improvement/tool-gate.js';
import { LiveToolMutator } from '../../../../src/agent/self-improvement/tool-skill-mutator.js';
import type { AuthoredToolSpec } from '../../../../src/agent/self-improvement/authored-tool-runtime.js';
import type { ToolBenchmarkScenario } from '../../../../src/agent/self-improvement/tool-types.js';

const QA_ROOT = join(process.cwd(), '_qa', 'dgm4');

function git(dir: string, args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}

function initRepo(): string {
  mkdirSync(QA_ROOT, { recursive: true });
  const dir = mkdtempSync(join(QA_ROOT, 'ast-cycle-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.name', 'DGM4 test']);
  git(dir, ['config', 'user.email', 'dgm4@example.invalid']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'feature.ts'), 'export const answer = 42;\n');
  git(dir, ['add', 'feature.ts']);
  git(dir, ['commit', '-q', '-m', 'baseline']);
  return dir;
}

describe('checkAstNovelty', () => {
  it('treats comments, whitespace and import order as AST-identical', () => {
    const parent = `import { b } from 'b';\nimport { a } from 'a';\nexport const answer = 42;`;
    const mutated = `// a harmless comment\nimport { a } from 'a';\n\nimport { b } from 'b';\nexport const answer=42; // still the same tree`;

    expect(checkAstNovelty(mutated, parent)).toEqual({
      isNovel: false,
      diffNodesCount: 0,
      reason: 'ast-identical',
    });
  });

  it('never rejects a mutation that changes a syntax node', () => {
    const result = checkAstNovelty('export const answer = 43;', 'export const answer = 42;');

    expect(result.isNovel).toBe(true);
    expect(result.diffNodesCount).toBeGreaterThanOrEqual(1);
  });
});

describe('G0 in the evolution engine', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    dir = initRepo();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('rejects a comment-only mutation before a fitness component can run', async () => {
    const store = new CodeVariantStore(join(dir, 'variants.json'));
    let evaluations = 0;
    const result = await runEvolutionCycle({
      baselineRef: 'HEAD',
      basePath: dir,
      variantId: 'comment-only',
      weakness: { id: 'w', goal: 'test G0', kind: 'manual' },
      planner: async () => null,
      store,
      components: [
        {
          name: 'must-not-run',
          weight: 1,
          deterministic: true,
          run: async () => {
            evaluations++;
            return { name: 'must-not-run', weight: 1, score: 1, passed: true, detail: 'unexpected' };
          },
        },
      ],
      mutate: async ({ worktreeDir }) => {
        writeFileSync(join(worktreeDir, 'feature.ts'), `${readFileSync(join(worktreeDir, 'feature.ts'), 'utf8')}\n// comment only\n`);
        return { changed: true };
      },
    });

    expect(evaluations).toBe(0);
    expect(result.rejectionReason).toBe('ast-identical');
    expect(store.getEvaluationStats().evaluationsAvoided).toBe(1);
  });

  it('evaluates a mutation that changes one syntax node', async () => {
    const store = new CodeVariantStore(join(dir, 'variants.json'));
    let evaluations = 0;
    const result = await runEvolutionCycle({
      baselineRef: 'HEAD',
      basePath: dir,
      variantId: 'syntax-change',
      weakness: { id: 'w', goal: 'test changed node', kind: 'manual' },
      planner: async () => null,
      store,
      components: [
        {
          name: 'runs-on-novelty',
          weight: 1,
          deterministic: true,
          run: async () => {
            evaluations++;
            return { name: 'runs-on-novelty', weight: 1, score: 1, passed: true, detail: 'ran' };
          },
        },
      ],
      mutate: async ({ worktreeDir }) => {
        writeFileSync(join(worktreeDir, 'feature.ts'), 'export const answer = 43;\n');
        return { changed: true };
      },
    });

    expect(evaluations).toBe(1);
    expect(result.rejectionReason).toBeUndefined();
    expect(result.report.passedAll).toBe(true);
  });
});

describe('G0 in the tool gate', () => {
  it('rejects an AST-identical proposal before G1 or behavioural scoring', async () => {
    const spec: AuthoredToolSpec = {
      name: 'authored__identity',
      description: 'identity fixture',
      parameters: { type: 'object', properties: {} },
      language: 'javascript',
      code: "console.log('ok');",
    };
    const scenario: ToolBenchmarkScenario = {
      id: 'g0',
      capability: 'fixture',
      description: 'fixture',
      visibleCases: [{ input: {}, expectedOutput: 'ok' }],
      heldOutCases: [{ input: {}, expectedOutput: 'ok' }],
    };

    const result = await validateToolProposal(
      { id: 'g0-proposal', targetScenarioId: scenario.id, spec },
      scenario,
      new LiveToolMutator({ persist: false }),
      { keepOnAccept: false, parentCode: `${spec.code}\n// harmless comment` },
    );

    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe('ast-identical');
    expect(result.visiblePassed).toBe(0);
    expect(result.heldOutPassed).toBe(0);
  });
});
