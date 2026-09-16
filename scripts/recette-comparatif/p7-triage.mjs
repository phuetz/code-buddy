#!/usr/bin/env node
/**
 * P7 recette — real `buddy triage` in a throwaway profile.
 *
 *   node scripts/recette-comparatif/run-isolated.mjs p7-recette -- node scripts/recette-comparatif/p7-triage.mjs
 *
 * Seeds a fake `.env` (sk-test key, JWT, URL with password), a settings file, a
 * 10,000-line log with those secrets and a failed run, then runs the real CLI
 * twice (`--json` and text), with stdin not a TTY. Child-process and network
 * calls made from Code Buddy sources are counted by count-child-and-network.cjs.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const base = process.env.RECETTE_QA_BASE;
if (!base) throw new Error('run through run-isolated.mjs');
const home = process.env.HOME;
const workspace = path.join(base, 'workspace');
fs.mkdirSync(path.join(home, '.codebuddy', 'logs'), { recursive: true });
fs.mkdirSync(workspace, { recursive: true });

const SK = 'sk-test-RECETTEp7ABCDEFGHIJKLMNOPQRSTUVWXYZ0123';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZWNldHRlLXA3In0.cmVjZXR0ZS1wNy1zaWduYXR1cmUtdmFsdWU';
const PASSWORD = 'P7-recette-password';
const URL_WITH_PASSWORD = `https://deploy:${PASSWORD}@git.example.invalid/repo.git`;
fs.writeFileSync(path.join(workspace, '.env'), `OPENAI_API_KEY=${SK}\nAUTH_JWT=${JWT}\nREMOTE_URL=${URL_WITH_PASSWORD}\n`);
fs.writeFileSync(path.join(home, '.codebuddy', 'settings.json'), JSON.stringify({ model: 'fixture', apiKey: SK }));
const lines = [];
for (let i = 0; i < 10_000; i++) {
  lines.push(i % 50 === 0
    ? `2026-09-15T10:00:00Z ERROR push failed ${URL_WITH_PASSWORD} key=${SK} Authorization: Bearer ${JWT}`
    : `2026-09-15T10:00:00Z INFO step ${i}`);
}
lines.push('2026-09-15T10:00:01Z ERROR RECETTE-P7-LAST-LINE');
fs.writeFileSync(path.join(home, '.codebuddy', 'logs', 'codebuddy.log'), `${lines.join('\n')}\n`);
const runDir = path.join(home, '.codebuddy', 'runs', 'run_recette_p7');
fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ runId: 'run_recette_p7', objective: `deploy using ${JWT}`, status: 'failed', startedAt: Date.parse('2026-09-15T09:00:00Z'), endedAt: Date.parse('2026-09-15T09:01:00Z'), eventCount: 3, artifactCount: 0 }), { mode: 0o600 });
fs.writeFileSync(path.join(runDir, 'events.jsonl'), '');

const counts = path.join(base, 'counts.jsonl');
fs.rmSync(counts, { force: true });
const env = {
  ...process.env,
  RECETTE_COUNT_FILE: counts,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${path.join(here, 'count-child-and-network.cjs')}`.trim(),
};
const tsx = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const entry = path.join(repoRoot, 'src', 'index.ts');
const outParent = path.join(base, 'triage-out');

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

const json = await run(['triage', '--json', '--out', outParent]);
fs.writeFileSync(path.join(base, 'triage-json.stdout.json'), json.stdout);
fs.writeFileSync(path.join(base, 'triage-json.stderr.txt'), json.stderr);
const jsonCounts = fs.existsSync(counts) ? fs.readFileSync(counts, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
const text = await run(['triage', '--out', outParent]);
// Control: the same counter on plain `doctor --offline` must see its `which`/`git` probes.
fs.rmSync(counts, { force: true });
await run(['doctor', '--json', '--offline']);
const controlCounts = fs.existsSync(counts) ? fs.readFileSync(counts, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
const controlChildCalls = controlCounts.reduce((n, row) => n + Object.values(row.childProcess).reduce((a, b) => a + b, 0), 0);
fs.writeFileSync(path.join(base, 'triage-text.stdout.txt'), text.stdout);

let summary;
try {
  summary = JSON.parse(json.stdout.slice(json.stdout.indexOf('{')));
} catch {
  summary = null;
}
const bundleText = summary ? fs.readFileSync(summary.files.json, 'utf8') : '';
const promptText = summary ? fs.readFileSync(summary.files.prompt, 'utf8') : '';
const leaked = [SK, JWT, PASSWORD, 'eyJzdWIiOiJyZWNldHRl'].filter((s) => bundleText.includes(s) || promptText.includes(s) || json.stdout.includes(s) || text.stdout.includes(s));
const mode = (p) => (fs.statSync(p).mode & 0o777).toString(8);
const sourceCalls = jsonCounts.reduce((acc, row) => {
  for (const [k, v] of Object.entries(row.childProcess)) {
    acc.childProcess += v;
    acc.detail.push(`child:${k}=${v}`);
  }
  for (const [k, v] of Object.entries(row.network)) {
    acc.network += v;
    acc.detail.push(`net:${k}=${v}`);
  }
  return acc;
}, { childProcess: 0, network: 0, detail: [] });

const result = {
  item: 'P7',
  jsonExit: json.code,
  textExit: text.code,
  summaryParsed: Boolean(summary),
  leakedSecretCount: leaked.length,
  promptBytes: summary ? Buffer.byteLength(promptText, 'utf8') : null,
  promptHasLastLogLine: promptText.includes('RECETTE-P7-LAST-LINE'),
  promptHasFailedRun: promptText.includes('run_recette_p7'),
  homePathInFiles: bundleText.includes(home) || promptText.includes(home),
  redactions: summary?.redactions,
  dirMode: summary ? mode(summary.dir) : null,
  jsonMode: summary ? mode(summary.files.json) : null,
  promptMode: summary ? mode(summary.files.prompt) : null,
  processesInstrumented: jsonCounts.length,
  childProcessCallsFromSources: sourceCalls.childProcess,
  networkCallsFromSources: sourceCalls.network,
  callDetail: sourceCalls.detail,
  blockedExternal: (json.stderr.match(/external (network|fetch) blocked/g) ?? []).length,
  agentLaunched: summary?.agentLaunched,
  textMentionsNothingSent: text.stdout.includes('nothing was sent'),
  controlDoctorChildCalls: controlChildCalls,
};
result.pass = result.jsonExit === 0 && result.textExit === 0 && result.summaryParsed && result.leakedSecretCount === 0
  && result.promptBytes <= 8192 && result.promptHasLastLogLine && result.promptHasFailedRun && !result.homePathInFiles && result.redactions > 1
  && result.dirMode === '700' && result.jsonMode === '600' && result.promptMode === '600'
  && result.processesInstrumented > 0 && result.childProcessCallsFromSources === 0 && result.networkCallsFromSources === 0
  && result.blockedExternal === 0 && result.agentLaunched === false && result.textMentionsNothingSent && result.controlDoctorChildCalls > 0;
fs.writeFileSync(path.join(base, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
