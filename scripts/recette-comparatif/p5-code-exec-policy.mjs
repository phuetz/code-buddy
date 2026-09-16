#!/usr/bin/env node
/**
 * P5 recette — real `buddy -p` runs against a FIXTURE provider; inspects the tool
 * schemas and runtime_settings actually SENT to the provider for three policies
 * (default, CODEBUDDY_CODE_EXEC_POLICY=prefer, =off). The fixture answers at once.
 *
 *   node scripts/recette-comparatif/run-isolated.mjs p5-recette -- node scripts/recette-comparatif/p5-code-exec-policy.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureProvider } from './fixture-openai-server.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = process.env.RECETTE_QA_BASE;
if (!base) throw new Error('run through run-isolated.mjs');
const workspace = path.join(base, 'workspace');
fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
for (const name of ['a', 'b', 'c']) fs.writeFileSync(path.join(workspace, 'src', `${name}.ts`), `export const ${name} = 1;\n`);

const tsx = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const entry = path.join(repoRoot, 'src', 'index.ts');

async function runWith(policy) {
  const provider = await startFixtureProvider({ model: 'fixture-ptc-model', script: () => ({ content: 'fixture answer' }) });
  const env = { ...process.env };
  if (policy) env.CODEBUDDY_CODE_EXEC_POLICY = policy; else delete env.CODEBUDDY_CODE_EXEC_POLICY;
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [tsx, entry, '-d', workspace, '-u', provider.baseUrl, '-k', 'fixture-not-a-secret',
      '-m', 'fixture-ptc-model', '--output-format', 'json', '-p', 'lis ces trois fichiers et compare leurs exports'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdout.on('data', () => {});
    const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stderr }); });
  });
  await provider.close();
  const first = provider.requests[0] ?? {};
  fs.writeFileSync(path.join(base, `request-${policy ?? 'default'}.json`), JSON.stringify({ ...first, tools: (first.tools ?? []).map((t) => t.function?.name) }, null, 2));
  const toolNames = (first.tools ?? []).map((t) => t.function?.name).filter(Boolean);
  // System blocks are merged into one system message: search the whole transcript text.
  const text = (first.messages ?? []).map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  let ptc = null;
  const runtimeLine = text.split('\n')[text.split('\n').findIndex((line) => line.startsWith('<runtime_settings')) + 1] ?? '';
  try { ptc = JSON.parse(runtimeLine)?.programmaticToolCalling ?? null; } catch { /* reported as null */ }
  const hintMatch = text.match(/<code_exec_policy policy="(\w+)" source="(\w+)">/);
  if (!ptc && hintMatch) ptc = { policy: hintMatch[1], source: hintMatch[2] };
  fs.writeFileSync(path.join(base, `stderr-${policy ?? 'default'}.txt`), result.stderr);
  return {
    policy: policy ?? 'default',
    exitCode: result.code,
    requests: provider.requests.length,
    toolCount: toolNames.length,
    codeExecOffered: toolNames.includes('code_exec'),
    runtimePolicy: ptc?.policy ?? null,
    runtimeSource: ptc?.source ?? null,
    blockedExternal: (result.stderr.match(/external (network|fetch) blocked/g) ?? []).length,
  };
}

const runs = [await runWith(undefined), await runWith('prefer'), await runWith('off')];
const [def, prefer, off] = runs;
const pass = runs.every((r) => r.exitCode === 0 && r.requests >= 1 && r.blockedExternal === 0)
  && def.runtimePolicy === 'offer' && prefer.codeExecOffered && prefer.runtimePolicy === 'prefer'
  && !off.codeExecOffered && off.runtimePolicy === 'off';
const summary = { item: 'P5', provider: 'fixture (deterministic, not a model)', query: 'lis ces trois fichiers et compare leurs exports', runs, pass };
fs.writeFileSync(path.join(base, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(pass ? 0 : 1);
