#!/usr/bin/env node
/**
 * Lot 3 recette — real `buddy -d <project> doctor --json --offline`, launched from another directory.
 *
 *   node scripts/recette-comparatif/run-isolated.mjs lot3-doctor-mcp -- node scripts/recette-comparatif/lot3-doctor-mcp-cwd.mjs
 *
 * The project declares MCP servers in .codebuddy/mcp.json (one with a secret env value, one disabled)
 * and in .codebuddy/settings.json. The doctor must report the project's three servers, never print the
 * secret, and make no network attempt.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = process.env.RECETTE_QA_BASE;
if (!base) throw new Error('run through run-isolated.mjs');
const project = path.join(base, 'project');
const launchDir = path.join(base, 'elsewhere');
fs.mkdirSync(path.join(project, '.codebuddy'), { recursive: true });
fs.mkdirSync(launchDir, { recursive: true });
const secret = 'sk-test-LOT3doctorMCPsecretABCDEFGHIJ0123456789';
fs.writeFileSync(path.join(project, '.codebuddy', 'mcp.json'), JSON.stringify({ mcpServers: {
  'proj-stdio': { command: 'node', args: ['server.js'], env: { API_TOKEN: secret } },
  'proj-off': { command: 'node', enabled: false },
} }));
fs.writeFileSync(path.join(project, '.codebuddy', 'settings.json'), JSON.stringify({ mcpServers: {
  'proj-settings': { transport: { type: 'http', url: 'http://127.0.0.1:1/mcp' } },
} }));

const tsx = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const child = spawn(process.execPath, [tsx, path.join(repoRoot, 'src', 'index.ts'), '-d', project, 'doctor', '--json', '--offline'],
  { cwd: launchDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => { stdout += d; });
child.stderr.on('data', (d) => { stderr += d; });
const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
const code = await new Promise((resolve) => child.on('close', resolve));
clearTimeout(timer);
fs.writeFileSync(path.join(base, 'doctor.stdout.json'), stdout.replaceAll(secret, '[SECRET-IN-OUTPUT]'));
let report = null;
try { report = JSON.parse(stdout.slice(stdout.indexOf('{'))); } catch { /* reported below */ }
const mcp = report?.checks?.find((c) => c.id === 'mcp');
const summary = {
  item: 'lot3-1',
  exitCode: code,
  parsed: Boolean(report),
  offline: report?.offline,
  mcpStatus: mcp?.status,
  mcpMessage: mcp?.message,
  secretPrinted: stdout.includes(secret) || stderr.includes(secret),
  blockedExternal: (stderr.match(/external (network|fetch) blocked/g) ?? []).length,
};
summary.pass = summary.parsed && summary.offline === true && /^3 configured \(1 disabled\)/.test(summary.mcpMessage ?? '')
  && !summary.secretPrinted && summary.blockedExternal === 0;
fs.writeFileSync(path.join(base, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.pass ? 0 : 1);
