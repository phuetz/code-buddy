/**
 * GK34 — /batch must decompose independent units, run them in parallel
 * when files are distinct, and refuse to race two writers on the same file.
 * A unit that reports success without touching a file is a failure.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDefaultBatchSpawnFn,
  decomposeBatchGoal,
  executeBatchPlan,
  handleBatchSlashCommand,
  parseNumberedBatchUnits,
  unitsShareFiles,
} from '../../src/commands/handlers/batch-handlers.js';

describe('GK34 /batch decomposition', () => {
  it('splits a numbered goal into independent units with file patterns (no LLM)', async () => {
    const goal = [
      'Three independent tasks in this repo:',
      '1. Fix src/add.js so tests/add.test.js passes. Only touch src/add.js.',
      '2. Add documented function slugify(str) in src/slugify.js. Only touch src/slugify.js.',
      '3. Write README.md describing the project. Only touch README.md.',
    ].join('\n');

    const numbered = parseNumberedBatchUnits(goal);
    expect(numbered).not.toBeNull();
    expect(numbered).toHaveLength(3);
    expect(numbered!.map((u) => u.filePatterns?.[0])).toEqual([
      'src/add.js',
      'src/slugify.js',
      'README.md',
    ]);

    const plan = await decomposeBatchGoal(goal);
    expect(plan.units).toHaveLength(3);
    expect(plan.units[0]?.label).not.toBe('main');
  });

  it('does not treat add(2, 3) returns as a numbered item', async () => {
    const goal = [
      '1. Fix src/add.js so add(2, 3) returns 5. Only touch src/add.js.',
      '2. Write README.md. Only touch README.md.',
    ].join('\n');
    const numbered = parseNumberedBatchUnits(goal);
    expect(numbered).toHaveLength(2);
    expect(numbered!.map((u) => u.label)).toEqual(['add', 'README']);
    expect(numbered![0]?.instruction).toContain('add(2, 3) returns 5');
  });

  it('keeps the single-unit fallback for an unstructured goal without chatFn', async () => {
    const plan = await decomposeBatchGoal('add logging');
    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]?.label).toBe('main');
  });
});

describe('GK34 /batch file overlap', () => {
  it('detects two units that target the same file', () => {
    expect(
      unitsShareFiles(
        { label: 'a', instruction: 'x', filePatterns: ['src/add.js'] },
        { label: 'b', instruction: 'y', filePatterns: ['src/add.js'] },
      ),
    ).toBe(true);
  });

  it('does not treat distinct files as overlapping', () => {
    expect(
      unitsShareFiles(
        { label: 'a', instruction: 'x', filePatterns: ['src/add.js'] },
        { label: 'b', instruction: 'y', filePatterns: ['README.md'] },
      ),
    ).toBe(false);
  });

  it('does not run overlapping file units concurrently', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const order: string[] = [];

    await executeBatchPlan(
      {
        goal: 'race',
        units: [
          { label: 'first', instruction: 'edit add', filePatterns: ['src/add.js'] },
          { label: 'second', instruction: 'edit add again', filePatterns: ['src/add.js'] },
        ],
      },
      async (label) => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        order.push(`start:${label}`);
        await new Promise((r) => setTimeout(r, 30));
        concurrent -= 1;
        order.push(`end:${label}`);
        return { label, success: true, summary: 'ok', durationMs: 30 };
      },
    );

    expect(maxConcurrent).toBe(1);
    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });

  it('runs distinct-file units in parallel', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    let overlapObserved = false;

    await executeBatchPlan(
      {
        goal: 'parallel',
        units: [
          { label: 'add', instruction: 'fix add', filePatterns: ['src/add.js'] },
          { label: 'docs', instruction: 'write readme', filePatterns: ['README.md'] },
        ],
      },
      async (label) => {
        concurrent += 1;
        if (concurrent > 1) overlapObserved = true;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 40));
        concurrent -= 1;
        return { label, success: true, summary: 'ok', durationMs: 40 };
      },
    );

    expect(overlapObserved).toBe(true);
    expect(maxConcurrent).toBe(2);
  });
});

describe('GK34 /batch success contract', () => {
  it('a spawn that changes no files is not reported as success', async () => {
    const results = await executeBatchPlan(
      {
        goal: 'empty',
        units: [{ label: 'noop', instruction: 'do nothing', filePatterns: ['README.md'] }],
      },
      async (label) => ({
        label,
        success: true,
        summary: '',
        durationMs: 1,
        filesChanged: [],
      }),
    );
    expect(results[0]?.success).toBe(false);
    expect(results[0]?.summary).toMatch(/no files changed/i);
    expect(results[0]?.filesChanged).toEqual([]);
  });

  it('handleBatchSlashCommand still plans-only when no spawnFn is wired', async () => {
    const result = await handleBatchSlashCommand(['create', 'src/title-case.js']);
    expect(result.entry?.content).toContain('plan only');
  });

  it('handleBatchSlashCommand executes when spawnFn is provided and reports diffs', async () => {
    const result = await handleBatchSlashCommand(
      ['1. Fix src/add.js. Only touch src/add.js.\n2. Write README.md. Only touch README.md.'],
      undefined,
      async (label) => ({
        label,
        success: true,
        summary: `Updated ${label}`,
        durationMs: 5,
        filesChanged: [label],
      }),
    );
    expect(result.entry?.content).not.toContain('plan only');
    expect(result.entry?.content).toContain('[OK]');
    expect(result.entry?.content).toMatch(/Completed: 2\/2/);
  });

  it('file-scoped spawn writes the named file from chat output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gk34-spawn-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['-c', 'user.email=gk34@local', '-c', 'user.name=gk34', 'commit', '--allow-empty', '-qm', 'init'], { cwd: dir });
    writeFileSync(join(dir, 'add.js'), 'export function add(a, b) { return -1; }\n');
    execFileSync('git', ['add', 'add.js'], { cwd: dir });
    execFileSync('git', ['-c', 'user.email=gk34@local', '-c', 'user.name=gk34', 'commit', '-qm', 'add'], { cwd: dir });

    const spawn = createDefaultBatchSpawnFn({
      cwd: dir,
      apiKey: 'ollama',
      chatFn: async () => 'export function add(a, b) {\n  return a + b;\n}\n',
    });
    const result = await spawn('add', 'Fix add.js so add(2,3) is 5. Only touch add.js.');
    expect(result.success).toBe(true);
    expect(result.filesChanged).toContain('add.js');
    expect(readFileSync(join(dir, 'add.js'), 'utf8')).toContain('return a + b');
  });
});

describe('GK34 /batch docs', () => {
  it('does not claim plan approval before a spawn that never ran', () => {
    const docs = readFileSync(fileURLToPath(new URL('../../docs/agents.md', import.meta.url)), 'utf8');
    const batch = docs.slice(docs.indexOf('## Batch Decomposition'), docs.indexOf('## A2A Protocol'));
    expect(batch).not.toMatch(/Plan approval before execution/);
    expect(batch).toMatch(/numbered list/i);
  });
});
