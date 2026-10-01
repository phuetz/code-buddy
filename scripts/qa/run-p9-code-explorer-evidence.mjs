import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runOwnedProcess } from './run-owned-process.mjs';
import { codeExplorerDefinitionsMatch } from './replay-oracles.mjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const qa = path.join(checkout, '_qa/preuves-p9');
const runRoot = path.join(qa, 'reprise-2');
const raw = path.join(runRoot, 'raw');
const home = path.join(qa, 'home');
mkdirSync(raw, { recursive: true });
mkdirSync(home, { recursive: true });
const load = file => import(pathToFileURL(path.join(checkout, 'dist', file)).href);

if (process.argv[2] === '--worker') {
  const [root, symbol] = process.argv.slice(3);
  if (!root?.startsWith(runRoot + path.sep)) throw new Error('Worker outside isolated QA');
  process.chdir(root);
  const { initializeMCPServers, getMCPManager } = await load('codebuddy/tools.js');
  try {
    await initializeMCPServers();
    const { createCodeExplorerTools } = await load('tools/registry/code-explorer-tools.js');
    const result = await createCodeExplorerTools()[0].execute({ query: symbol, repo: root });
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { await getMCPManager().dispose(); }
} else {
  if (process.platform !== 'linux') throw new Error('This replay certifies Linux only');
  const root = mkdtempSync(path.join(runRoot, 'code-explorer-'));
  const symbol = 'p9add' + randomBytes(6).toString('hex');
  const sources = {
    'sample.js': `export function ${symbol}(a, b) { return a + b; }\n`,
    'sample.ts': `export function ${symbol}(a: number, b: number): number { return a + b; }\n`,
  };
  for (const [file, content] of Object.entries(sources)) writeFileSync(path.join(root, file), content);
  mkdirSync(path.join(root, '.codebuddy'));
  const binary = process.env.CODE_EXPLORER_BIN || 'code-explorer';
  const mcp = { mcpServers: { 'code-explorer': { transport: { type: 'stdio', command: binary, args: ['mcp'] }, autoReconnect: false } } };
  writeFileSync(path.join(root, '.codebuddy/mcp.json'), JSON.stringify(mcp, null, 2));
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEBUDDY_WORKSPACE_ROOT: root, CODEBUDDY_WORKSPACE: 'true', CODEBUDDY_DISABLE_MCP: 'false' };
  const steps = [];
  const run = async (command, args) => {
    const step = await runOwnedProcess(command, args, { cwd: root, env });
    steps.push(step);
    writeFileSync(path.join(raw, `code-explorer-${path.basename(root)}.json`), JSON.stringify({ root, symbol, sources, mcp, steps }, null, 2));
    if (step.code !== 0 || step.timedOut) throw new Error(`QA prerequisite failed: ${command}: ${step.stderr}`);
    return step;
  };
  await run(binary, ['--version']);
  const unindexed = await run(binary, ['status']);
  if (!unindexed.stdout.includes('NOT INDEXED')) throw new Error('Fresh fixture unexpectedly indexed');
  const workerArgs = [fileURLToPath(import.meta.url), '--worker', root, symbol];
  const negative = await run(process.execPath, workerArgs);
  const negativeResult = JSON.parse(negative.stdout);
  const negativeRejected = !codeExplorerDefinitionsMatch(JSON.parse(negativeResult.output), symbol);
  if (!negativeRejected) throw new Error('Unindexed query passed the oracle');
  await run(binary, ['analyze', root, '--skip-git', '--no-docs', '--max-files', '2']);
  const status = await run(binary, ['status']);
  if (status.stdout.includes('NOT INDEXED')) throw new Error('Index unavailable after analyze');
  const ids = { cli: 'cli-code-explorer', tool: 'tool:code_explorer_ask' };
  const results = [];
  for (const kind of ['cli', 'tool']) {
    const attempts = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const step = await run(process.execPath, kind === 'cli' ? [path.join(checkout, 'dist/cli-boot.js'), 'code-explorer', 'ask', symbol] : workerArgs);
      const result = kind === 'cli' ? { success: true, output: step.stdout } : JSON.parse(step.stdout);
      const context = JSON.parse(result.output);
      const passed = result.success && codeExplorerDefinitionsMatch(context, symbol) &&
        Object.entries(sources).every(([file, content]) => readFileSync(path.join(root, file), 'utf8') === content);
      attempts.push({ result, passed });
    }
    results.push({ id: ids[kind], name: ids[kind], input: { query: symbol, ...(kind === 'tool' ? { repo: root } : {}) },
      command: 'node scripts/qa/run-p9-code-explorer-evidence.mjs',
      expected: 'Deux définitions du symbole unique, sample.js/sample.ts ligne 1, deux processus froids ; contrôle sans index rejeté.',
      result: attempts[0].result, attempts, passed: negativeRejected && attempts.every(a => a.passed),
      observations: { negativeRejected, indexStatus: status.stdout, root, sources, mcp, steps },
      summary: 'Projet neuf et symbole unique ; index réel reconstruit ; CLI et outil MCP interrogés à froid, sans état préexistant requis.' });
  }
  writeFileSync(path.join(raw, `code-explorer-results-${path.basename(root)}.json`), JSON.stringify(results, null, 2));
  for (const result of results) process.stdout.write(`${result.id}: ${result.passed ? 'PASS' : 'FAIL'}\n`);
  if (results.some(result => !result.passed)) process.exitCode = 1;
}
