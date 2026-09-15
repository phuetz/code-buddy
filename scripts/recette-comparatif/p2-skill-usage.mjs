#!/usr/bin/env node
/**
 * P2 recette — real CLI: a FIXTURE provider makes `buddy -p` call skill_view twice on
 * a workspace skill, then `buddy skills usage --json` must report the activity.
 *
 *   node scripts/recette-comparatif/run-isolated.mjs p2-recette -- node scripts/recette-comparatif/p2-skill-usage.mjs
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureProvider } from './fixture-openai-server.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = process.env.RECETTE_QA_BASE;
if (!base) throw new Error('run through run-isolated.mjs');
const workspace = path.join(base, 'workspace');
const skillDir = path.join(workspace, '.codebuddy', 'skills', 'qa-repo-check');
fs.mkdirSync(skillDir, { recursive: true });
const skillFile = path.join(skillDir, 'SKILL.md');
fs.writeFileSync(skillFile, '---\nname: qa-repo-check\ndescription: Count QA markers in the repository\n---\n\nCount the lines containing QA-MARKER.\n');
const hash = () => createHash('sha256').update(fs.readFileSync(skillFile)).digest('hex');
const hashBefore = hash();

const provider = await startFixtureProvider({
  model: 'fixture-skill-model',
  script: (_body, index) => (index < 2
    ? { toolCalls: [{ name: 'skill_view', arguments: { name: 'qa-repo-check' } }] }
    : { content: 'Viewed the skill twice.' }),
});

const tsx = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const entry = path.join(repoRoot, 'src', 'index.ts');
function run(args, timeoutMs = 240_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsx, entry, ...args], { cwd: workspace, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

const chat = await run(['-d', workspace, '-u', provider.baseUrl, '-k', 'fixture-not-a-secret', '-m', 'fixture-skill-model',
  '--output-format', 'json', '-p', 'Use the qa-repo-check skill.']);
await provider.close();
fs.writeFileSync(path.join(base, 'chat-stdout.txt'), chat.stdout);
fs.writeFileSync(path.join(base, 'chat-stderr.txt'), chat.stderr);

const usage = await run(['skills', 'usage', '--json'], 120_000);
fs.writeFileSync(path.join(base, 'usage-stdout.txt'), usage.stdout);
fs.writeFileSync(path.join(base, 'usage-stderr.txt'), usage.stderr);
let usageJson = null;
try {
  usageJson = JSON.parse(usage.stdout.slice(usage.stdout.indexOf('{')));
} catch { /* reported below */ }
const activity = usageJson?.activity?.find((a) => a.skill === 'qa-repo-check');
const toolResults = provider.requests.flatMap((b) => (b.messages ?? []).filter((m) => m.role === 'tool'));

const summary = {
  item: 'P2',
  provider: 'fixture (deterministic, not a model)',
  chatExit: chat.code,
  usageExit: usage.code,
  providerRequests: provider.requests.length,
  skillViewResultsSeenByProvider: toolResults.length,
  skillViewSucceeded: toolResults.some((m) => typeof m.content === 'string' && m.content.includes('qa-repo-check') && !m.content.includes('not found')),
  activity: activity ?? null,
  skillFileUnchanged: hash() === hashBefore,
};
summary.pass = chat.code === 0 && usage.code === 0 && (activity?.viewCount ?? 0) >= 2 && Boolean(activity?.lastViewedAt) && summary.skillFileUnchanged;
fs.writeFileSync(path.join(base, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.pass ? 0 : 1);
