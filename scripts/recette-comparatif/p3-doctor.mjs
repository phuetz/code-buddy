#!/usr/bin/env node
/**
 * P3 recette — real `buddy doctor --json --offline` in a throwaway profile.
 *
 *   node scripts/recette-comparatif/run-isolated.mjs p3-recette -- node scripts/recette-comparatif/p3-doctor.mjs
 *
 * A fake `lm-resizer` without the tool-output protocol is enabled; an OPENAI_API_KEY
 * fixture is set so a non-offline run WOULD try the live key check. Any outbound
 * connection attempt is counted from the no-external-network preload warnings.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = process.env.RECETTE_QA_BASE;
if (!base) throw new Error('run through run-isolated.mjs');
const workspace = path.join(base, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
const fakeBin = path.join(base, 'bin', 'lm-resizer');
fs.mkdirSync(path.dirname(fakeBin), { recursive: true });
fs.writeFileSync(fakeBin, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "lm-resizer 0.1.0-old"; exit 0; fi\nif [ "$1" = "tool-output" ]; then exit 2; fi\necho "usage: lm-resizer exec|compress"\n', { mode: 0o755 });

const env = {
  ...process.env,
  CODEBUDDY_LM_RESIZER: 'true',
  CODEBUDDY_LM_RESIZER_BIN: fakeBin,
  OPENAI_API_KEY: 'sk-test-recette-p3-not-a-secret',
};
const tsx = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const entry = path.join(repoRoot, 'src', 'index.ts');

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsx, entry, '-d', workspace, ...args], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

const offline = await run(['doctor', '--json', '--offline']);
fs.writeFileSync(path.join(base, 'doctor-json-offline.stdout.json'), offline.stdout);
fs.writeFileSync(path.join(base, 'doctor-json-offline.stderr.txt'), offline.stderr);
const text = await run(['doctor', '--integrations', '--offline']);
fs.writeFileSync(path.join(base, 'doctor-text-integrations.stdout.txt'), text.stdout);
// Control run WITHOUT --offline: the live key check must try (and be blocked by the preload).
const online = await run(['doctor', '--json']);
fs.writeFileSync(path.join(base, 'doctor-json-online.stderr.txt'), online.stderr);
const onlineBlocked = (online.stderr.match(/external (network|fetch) blocked/g) ?? []).length;

let report = null;
try { report = JSON.parse(offline.stdout.slice(offline.stdout.indexOf('{'))); } catch { /* below */ }
const blocked = (offline.stderr.match(/external (network|fetch) blocked/g) ?? []).length;
const lm = report?.checks?.find((c) => c.id === 'lm-resizer');
const summary = {
  item: 'P3',
  jsonExit: offline.code,
  jsonParsed: Boolean(report),
  offlineFlag: report?.offline,
  integrationIds: report?.checks?.filter((c) => c.section === 'integrations').map((c) => `${c.id}:${c.status}`) ?? [],
  lmResizer: lm ? { status: lm.status, mentionsToolOutput: lm.message.includes('tool-output') } : null,
  externalConnectionAttemptsBlocked: blocked,
  controlOnlineRunBlockedAttempts: onlineBlocked,
  secretLeakedInJson: offline.stdout.includes('sk-test-recette-p3'),
  textShowsIntegrationsHeader: text.stdout.includes('Integrations (no network)'),
};
summary.pass = summary.jsonParsed && summary.offlineFlag === true && lm?.status === 'warn' && summary.lmResizer.mentionsToolOutput
  && blocked === 0 && onlineBlocked > 0 && !summary.secretLeakedInJson && summary.textShowsIntegrationsHeader;
fs.writeFileSync(path.join(base, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.pass ? 0 : 1);
