#!/usr/bin/env node
/**
 * Consolidation recette — smoke of the INSTALLED npm package (not the worktree sources).
 *
 *   RECETTE_QA_ROOT=<private qa root> node scripts/recette-comparatif/run-isolated.mjs package-smoke -- \
 *     node scripts/recette-comparatif/consolidation-package-smoke.mjs <prefix>/bin/buddy [expected-version]
 *
 * Throwaway HOME, provider env stripped, external network blocked by run-isolated. Only the loopback
 * fixture provider (not a model) is used for the headless turn. Checks: the binary resolves inside the
 * install prefix, --version/--help, useful subcommand help, doctor --json --offline read-only on a bare
 * project and on settings.json `servers` (P2 honest warning), and one headless turn with a view_file call.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startFixtureProvider } from './fixture-openai-server.mjs';

const [binArg, expectedVersion = '2.0.0'] = process.argv.slice(2);
const base = process.env.RECETTE_QA_BASE;
if (!base || !binArg) throw new Error('usage (through run-isolated.mjs): consolidation-package-smoke.mjs <prefix>/bin/buddy [version]');
const binReal = fs.realpathSync(binArg);
const prefix = path.resolve(path.dirname(binArg), '..');
const worktree = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const secret = 'sk-test-PACKAGEsmokeSECRETabcdef0123456789';

function run(args, cwd, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [binReal, ...args], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
}

function tree(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      const rel = path.relative(dir, full);
      if (e.isDirectory()) { out[`${rel}/`] = 'dir'; walk(full); } else out[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

const bare = path.join(base, 'p-bare');
const settingsServers = path.join(base, 'p-settings-servers');
const workspace = path.join(base, 'workspace');
fs.mkdirSync(bare, { recursive: true });
fs.writeFileSync(path.join(bare, 'README.md'), 'bare\n');
fs.mkdirSync(path.join(settingsServers, '.codebuddy'), { recursive: true });
fs.writeFileSync(path.join(settingsServers, '.codebuddy', 'settings.json'), JSON.stringify({ servers: { ignored: { command: 'node', args: ['x.js'], env: { API_TOKEN: secret } } } }));
fs.mkdirSync(workspace, { recursive: true });
const marker = `PKG-SMOKE-${crypto.randomUUID()}`;
fs.writeFileSync(path.join(workspace, 'notes.txt'), `${marker}\n`);

const results = {};
const excerpt = (r) => ({ exit: r.code, signal: r.signal, stdoutHead: r.stdout.slice(0, 300), stderrTail: r.stderr.slice(-300) });

const version = await run(['--version'], bare);
results.version = { ...excerpt(version), matches: version.stdout.trim().includes(expectedVersion) };
const help = await run(['--help'], bare);
results.help = { exit: help.code, mentionsDoctor: /doctor/.test(help.stdout), mentionsMcp: /\bmcp\b/.test(help.stdout), bytes: help.stdout.length };
for (const cmd of ['doctor', 'mcp', 'lessons', 'resources', 'triage', 'improve', 'evolve']) {
  const r = await run([cmd, '--help'], bare);
  results[`help-${cmd}`] = { exit: r.code, firstLine: r.stdout.split('\n').find((l) => l.trim()) ?? '' };
}

for (const [name, dir] of [['doctor-bare', bare], ['doctor-settings-servers', settingsServers]]) {
  const before = tree(dir);
  const r = await run(['-d', dir, 'doctor', '--json', '--offline'], base, 180_000);
  let report = null;
  try { report = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { /* recorded */ }
  const after = tree(dir);
  results[name] = {
    exit: r.code, parsed: Boolean(report), mcp: report?.checks?.find((c) => c.id === 'mcp') ?? null,
    treeUnchanged: JSON.stringify(before) === JSON.stringify(after), createdEntries: Object.keys(after).filter((k) => !(k in before)),
    secretPrinted: (r.stdout + r.stderr).includes(secret), blockedExternal: (r.stderr.match(/external (network|fetch) blocked/g) ?? []).length,
  };
}

const provider = await startFixtureProvider({
  model: 'fixture-package-model',
  script: (body) => {
    const last = (body.messages ?? []).at(-1);
    if (last?.role === 'tool') return { content: `PACKAGE-ANSWER ${String(last.content).includes(marker) ? marker : 'marker-missing'}` };
    return { toolCalls: [{ name: 'view_file', arguments: { path: 'notes.txt' } }] };
  },
});
const headless = await run(['-d', workspace, '-u', provider.baseUrl, '-k', 'fixture-not-a-secret', '-m', 'fixture-package-model',
  '--max-tool-rounds', '5', '--output-format', 'json', '-p', 'Read notes.txt and repeat the identifier.'], workspace, 180_000);
await provider.close();
results.headless = {
  exit: headless.code, providerRequests: provider.requests.length,
  toolResultReachedModel: provider.requests.some((b) => (b.messages ?? []).some((m) => m.role === 'tool' && String(m.content).includes(marker))),
  answerHasMarker: headless.stdout.includes(`PACKAGE-ANSWER ${marker}`),
  blockedExternal: (headless.stderr.match(/external (network|fetch) blocked \(([^)]*)\)/g) ?? []).slice(0, 5),
};

const allOutput = JSON.stringify(results);
const checks = {
  binaryInsidePrefix: binReal.startsWith(`${prefix}${path.sep}`) && !binReal.startsWith(worktree),
  version: results.version.exit === 0 && results.version.matches,
  help: results.help.exit === 0 && results.help.mentionsDoctor && results.help.mentionsMcp,
  subcommandHelp: ['doctor', 'mcp', 'lessons', 'resources', 'triage', 'improve', 'evolve'].every((c) => results[`help-${c}`].exit === 0),
  doctorBareOk: results['doctor-bare'].parsed && results['doctor-bare'].mcp?.status === 'ok' && results['doctor-bare'].treeUnchanged,
  doctorP2Honest: results['doctor-settings-servers'].mcp?.status === 'warn' && /not read at runtime; use mcpServers/.test(results['doctor-settings-servers'].mcp?.message ?? '') && results['doctor-settings-servers'].treeUnchanged,
  doctorNoSecretNoNetwork: !results['doctor-bare'].secretPrinted && !results['doctor-settings-servers'].secretPrinted && results['doctor-bare'].blockedExternal === 0 && results['doctor-settings-servers'].blockedExternal === 0,
  headlessTurn: results.headless.exit === 0 && results.headless.toolResultReachedModel && results.headless.answerHasMarker,
  noWorktreePathInOutputs: !allOutput.includes(worktree),
};
const summary = { item: 'consolidation-package-smoke', head: process.env.RECETTE_HEAD ?? null, binary: binReal.replace(prefix, '<prefix>'), results, checks, pass: Object.values(checks).every(Boolean) };
fs.writeFileSync(path.join(base, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.pass ? 0 : 1);
