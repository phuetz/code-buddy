#!/usr/bin/env node
/**
 * Consolidation recette — real `buddy -d <project> doctor --json --offline` is read-only on the
 * inspected projects and reports MCP settings forms honestly (P2).
 *
 *   RECETTE_QA_ROOT=/tmp/cb-consolidation-20260915/qa node scripts/recette-comparatif/run-isolated.mjs doctor-readonly -- \
 *     node scripts/recette-comparatif/consolidation-doctor-readonly.mjs
 *
 * Projects: (1) settings.json `servers` only (ignored at runtime), (2) settings mcpServers + corrupt
 * mcp.json with a .bak, (3) a bare directory without .codebuddy. Oracle: file trees byte-identical,
 * no .bak/.tmp/.codebuddy created, no secret printed, MCP messages as expected, 0 network attempt.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = process.env.RECETTE_QA_BASE;
if (!base) throw new Error('run through run-isolated.mjs');
const secret = 'sk-test-CONSOLIDATIONdoctorSECRETabcdef0123456';
const launchDir = path.join(base, 'elsewhere');
fs.mkdirSync(launchDir, { recursive: true });

function project(name, files) {
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      const rel = path.relative(dir, full);
      if (entry.isDirectory()) { out[`${rel}/`] = 'dir'; walk(full); } else out[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

const server = { command: 'node', args: ['server.js'], env: { API_TOKEN: secret } };
const projects = {
  settingsServersOnly: project('p-settings-servers', { '.codebuddy/settings.json': { servers: { ignored: server } } }),
  corruptWithBackup: project('p-corrupt-bak', {
    '.codebuddy/settings.json': { mcpServers: { real: server } },
    '.codebuddy/mcp.json': '{ "mcpServers": ',
    '.codebuddy/mcp.json.bak': { mcpServers: { recovered: server } },
  }),
  bare: project('p-bare', { 'README.md': 'bare project\n' }),
};
const before = Object.fromEntries(Object.entries(projects).map(([k, d]) => [k, snapshot(d)]));

const tsx = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
function doctor(dir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsx, path.join(repoRoot, 'src', 'index.ts'), '-d', dir, 'doctor', '--json', '--offline'], { cwd: launchDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

const results = {};
for (const [name, dir] of Object.entries(projects)) {
  const run = await doctor(dir);
  fs.writeFileSync(path.join(base, `${name}.stdout.json`), run.stdout.replaceAll(secret, '[SECRET-IN-OUTPUT]'));
  let report = null;
  try { report = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'))); } catch { /* reported */ }
  const after = snapshot(dir);
  results[name] = {
    exitCode: run.code,
    parsed: Boolean(report),
    mcp: report?.checks?.find((c) => c.id === 'mcp') ?? null,
    treeUnchanged: JSON.stringify(after) === JSON.stringify(before[name]),
    createdEntries: Object.keys(after).filter((k) => !(k in before[name])),
    secretPrinted: run.stdout.includes(secret) || run.stderr.includes(secret),
    blockedExternal: (run.stderr.match(/external (network|fetch) blocked/g) ?? []).length,
  };
}

const r = results;
const summary = {
  item: 'consolidation-doctor-readonly',
  head: process.env.RECETTE_HEAD ?? null,
  results: r,
};
summary.pass = Object.values(r).every((x) => x.parsed && x.treeUnchanged && !x.secretPrinted && x.blockedExternal === 0)
  && r.settingsServersOnly.mcp?.status === 'warn' && /not read at runtime; use mcpServers/.test(r.settingsServersOnly.mcp?.message ?? '')
  && /no MCP server configured/.test(r.settingsServersOnly.mcp?.message ?? '')
  && r.corruptWithBackup.mcp?.status === 'warn' && /^1 configured/.test(r.corruptWithBackup.mcp?.message ?? '') && /corrupt/.test(r.corruptWithBackup.mcp?.message ?? '')
  && r.bare.mcp?.status === 'ok';
fs.writeFileSync(path.join(base, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.pass ? 0 : 1);
