#!/usr/bin/env node
/**
 * P1 recette — real `buddy -p` headless run against a FIXTURE provider that
 * keeps requesting the same view_file call. Run through run-isolated.mjs:
 *
 *   node scripts/recette-comparatif/run-isolated.mjs p1-recette -- \
 *     node scripts/recette-comparatif/p1-loop-guard.mjs
 *
 * Writes summary.json into $RECETTE_QA_BASE. Exit 0 only when the guard warned
 * once and stopped the turn before the round limit.
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
fs.writeFileSync(path.join(workspace, 'src', 'a.ts'), 'export const answer = 42;\n');

const provider = await startFixtureProvider({
  model: 'fixture-loop-model',
  script: (body) => {
    const sawGuard = (body.messages ?? []).some((m) => typeof m.content === 'string' && m.content.includes('<context type="loop-guard">'));
    // A stubborn model: keeps calling the same tool even after the guard warning.
    return { content: sawGuard ? 'still checking' : '', toolCalls: [{ name: 'view_file', arguments: { path: 'src/a.ts' } }] };
  },
});

const args = [
  path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  path.join(repoRoot, 'src', 'index.ts'),
  '-d', workspace,
  '-u', provider.baseUrl,
  '-k', 'fixture-not-a-secret',
  '-m', 'fixture-loop-model',
  '--max-tool-rounds', '40',
  '--output-format', 'json',
  '-p', 'Read src/a.ts and tell me the exported value.',
];
const started = Date.now();
const child = spawn(process.execPath, args, { cwd: workspace, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => { stdout += d; });
child.stderr.on('data', (d) => { stderr += d; });
const timer = setTimeout(() => child.kill('SIGTERM'), 240_000);
const exitCode = await new Promise((resolve) => child.on('close', (code) => resolve(code)));
clearTimeout(timer);
await provider.close();

fs.writeFileSync(path.join(base, 'cli-stdout.txt'), stdout);
fs.writeFileSync(path.join(base, 'cli-stderr.txt'), stderr);
const guardInRequests = provider.requests.filter((b) =>
  (b.messages ?? []).some((m) => typeof m.content === 'string' && m.content.includes('<context type="loop-guard">')));
const summary = {
  item: 'P1',
  provider: 'fixture (deterministic, not a model)',
  exitCode,
  durationMs: Date.now() - started,
  providerRequests: provider.requests.length,
  requestsCarryingGuardWarning: guardInRequests.length,
  guardWarningCountInLastRequest: (provider.requests.at(-1)?.messages ?? [])
    .filter((m) => typeof m.content === 'string' && m.content.includes('<context type="loop-guard">')).length,
  stoppedByGuard: stdout.includes('Stopped by the loop guard'),
  maxRoundsMessage: stdout.includes('Maximum tool execution rounds reached'),
};
summary.pass = summary.stoppedByGuard && !summary.maxRoundsMessage && summary.providerRequests === 8 && summary.guardWarningCountInLastRequest === 1;
fs.writeFileSync(path.join(base, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.pass ? 0 : 1);
