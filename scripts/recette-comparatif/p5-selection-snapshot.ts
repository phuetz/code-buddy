/**
 * P5 acceptance 2 — an unmarked model keeps its tool selection.
 *
 *   node scripts/recette-comparatif/run-isolated.mjs p5-snapshot -- \
 *     node node_modules/tsx/dist/cli.mjs scripts/recette-comparatif/p5-selection-snapshot.ts \
 *     <shared-report-dir>/selection-ptc-fixed.json [base-revision]
 *
 * Replays the 2026-09-14 selection call (4 queries × 2 models, real registry and
 * RAG selection) and compares with that snapshot. With a base revision (e.g.
 * d17a21cba), that revision's `tool-selection-strategy.ts` is read with
 * `git show` into a temporary sibling file (deleted afterwards) and the same
 * queries run through it: HEAD must equal the base for unmarked models, which
 * separates a P5 regression from registry drift since the 14/09 snapshot.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [snapshotPath, baseRevision] = process.argv.slice(2);
if (!snapshotPath) throw new Error('usage: p5-selection-snapshot.ts <selection-ptc-fixed.json> [base-revision]');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const strategyRel = 'src/agent/execution/tool-selection-strategy.ts';
let baseStrategyPath: string | null = null;
if (baseRevision) {
  if (!/^[0-9a-f]{7,40}$/.test(baseRevision)) throw new Error('base revision must be a commit hash');
  baseStrategyPath = path.join(repoRoot, 'src/agent/execution', `.tool-selection-strategy.base-${baseRevision}.ts`);
  fs.writeFileSync(baseStrategyPath, execFileSync('git', ['show', `${baseRevision}:${strategyRel}`], { cwd: repoRoot }));
  process.on('exit', () => fs.rmSync(baseStrategyPath!, { force: true }));
}
const qaBase = process.env.RECETTE_QA_BASE;
if (!qaBase) throw new Error('run through run-isolated.mjs');
Object.assign(process.env, { CODEBUDDY_HEADLESS: 'true', CODEBUDDY_DISABLE_MCP: 'true', CODEBUDDY_SENSORY: 'false' });
delete process.env.CODEBUDDY_CODE_EXEC_POLICY;
process.chdir(process.env.HOME!);

type SnapshotRecord = { modelName: string; query: string; names: string[] };
type Strategy = new (config: { enableCaching: boolean }) => {
  selectToolsForQuery(query: string, options: Record<string, unknown>): Promise<{ tools: Array<{ function: { name: string } }> }>;
};
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as SnapshotRecord[];
const head = (await import('../../src/agent/execution/tool-selection-strategy.js')).ToolSelectionStrategy as unknown as Strategy;
const baseStrategy = baseStrategyPath
  ? ((await import(pathToFileURL(baseStrategyPath).href)).ToolSelectionStrategy as Strategy)
  : null;
const { resolveCodeExecPolicy } = await import('../../src/config/code-exec-policy.js');

async function select(Impl: Strategy, modelName: string, query: string): Promise<string[]> {
  const result = await new Impl({ enableCaching: false }).selectToolsForQuery(query, { modelName, maxTools: 5, alwaysInclude: ['view_file', 'bash', 'search'] });
  return result.tools.map((t) => t.function.name);
}

const rows = [];
for (const record of snapshot) {
  const actual = await select(head, record.modelName, record.query);
  const base = baseStrategy ? await select(baseStrategy, record.modelName, record.query) : null;
  rows.push({
    modelName: record.modelName,
    policy: resolveCodeExecPolicy(record.modelName),
    query: record.query,
    snapshot: record.names,
    head: actual,
    base,
    headEqualsSnapshot: JSON.stringify(actual) === JSON.stringify(record.names),
    headEqualsBase: base ? JSON.stringify(actual) === JSON.stringify(base) : null,
  });
}

process.env.CODEBUDDY_CODE_EXEC_POLICY = 'off';
const offRemovesCodeExec = (await Promise.all(snapshot.map((r) => select(head, r.modelName, r.query)))).every((names) => !names.includes('code_exec'));

const summary = {
  item: 'P5',
  part: 'acceptance 2: unmarked models keep their selection',
  snapshot: path.basename(snapshotPath),
  records: rows.length,
  headEqualsSnapshot: rows.filter((r) => r.headEqualsSnapshot).length,
  headEqualsBase: baseStrategy ? rows.filter((r) => r.headEqualsBase).length : null,
  unmarkedPolicies: [...new Set(rows.map((r) => `${r.modelName}:${r.policy.policy}/${r.policy.source}`))],
  offRemovesCodeExec,
  snapshotDifferences: rows.filter((r) => !r.headEqualsSnapshot).map((r) => ({
    modelName: r.modelName, query: r.query, snapshot: r.snapshot, head: r.head, base: r.base,
  })),
};
const pass = rows.length === 8 && offRemovesCodeExec && rows.every((r) => r.policy.policy === 'offer')
  && (baseStrategy ? rows.every((r) => r.headEqualsBase) : rows.every((r) => r.headEqualsSnapshot));
fs.writeFileSync(path.join(qaBase, 'summary.json'), `${JSON.stringify({ ...summary, pass }, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, pass }, null, 2));
process.exit(pass ? 0 : 1);
