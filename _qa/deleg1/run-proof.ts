import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { CodeBuddyClient } from '../../src/codebuddy/client.js';
import {
  createDefaultBatchSpawnFn,
  handleBatchCommand,
} from '../../src/commands/handlers/batch-handlers.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';

const model = 'qwen3:4b-instruct';
const baseURL = 'http://127.0.0.1:11434/v1';
const proofRoot = resolve('_qa/deleg1');
const runId = process.env.DELEG1_RUN_ID?.trim() || 'run-1';
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error(`Invalid DELEG1_RUN_ID: ${runId}`);
const beforeRoot = resolve(proofRoot, `toy-before-${runId}`);
const afterRoot = resolve(proofRoot, `toy-after-${runId}`);

for (const directory of [beforeRoot, afterRoot]) {
  mkdirSync(directory, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: directory });
  execFileSync(
    'git',
    ['-c', 'user.email=deleg1@local', '-c', 'user.name=DELEG1', 'commit', '--allow-empty', '-qm', 'initial'],
    { cwd: directory },
  );
}

interface ProofTask {
  label: 'alpha' | 'beta';
  file: 'alpha.js' | 'beta.js';
  exportName: 'alpha' | 'beta';
  value: 21 | 34;
}

const tasks: ProofTask[] = [
  { label: 'alpha', file: 'alpha.js', exportName: 'alpha', value: 21 },
  { label: 'beta', file: 'beta.js', exportName: 'beta', value: 34 },
];

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:[\w.+-]*)\r?\n([\s\S]*?)```/);
  const body = (fenced?.[1] ?? text).replace(/^\uFEFF/, '');
  return body.endsWith('\n') ? body : `${body}\n`;
}

async function runLegacyChatPath(task: ProofTask): Promise<{ label: string; durationMs: number }> {
  const started = performance.now();
  const instruction = `Create ${task.file} exporting function ${task.exportName}() that returns ${task.value}. Only touch ${task.file}.`;
  const prompt = [
    `You are editing exactly one file: ${task.file}`,
    `Instruction: ${instruction}`,
    'Current contents:',
    '```',
    '(file does not exist yet)',
    '```',
    'Return the COMPLETE new file contents. No commentary. A single markdown fence is allowed.',
  ].join('\n');
  const client = new CodeBuddyClient('ollama', model, baseURL);
  const response = await client.chat([{ role: 'user', content: prompt }]);
  const content = response.choices[0]?.message?.content ?? '';
  if (!content.trim()) throw new Error(`Legacy chat returned no content for ${task.label}`);
  writeFileSync(resolve(beforeRoot, task.file), stripCodeFence(content), 'utf8');
  const durationMs = performance.now() - started;
  process.stdout.write(`[before:${task.label}:done] ${durationMs.toFixed(1)}ms\n`);
  return { label: task.label, durationMs };
}

async function verifyExports(directory: string): Promise<Record<string, number>> {
  const values: Record<string, number> = {};
  for (const task of tasks) {
    const module = await import(`${pathToFileURL(resolve(directory, task.file)).href}?proof=${Date.now()}`) as Record<string, () => number>;
    const value = module[task.exportName]?.();
    if (value !== task.value) {
      throw new Error(`${task.file} returned ${String(value)} instead of ${task.value}`);
    }
    values[task.exportName] = value;
  }
  return values;
}

process.stdout.write(`MODEL=${model}\n`);
process.stdout.write('BEFORE_PATH=base commit chat-per-file behavior\n');
const beforeStarted = performance.now();
const beforeUnits = await Promise.all(tasks.map(runLegacyChatPath));
const beforeTotalMs = performance.now() - beforeStarted;
const beforeValues = await verifyExports(beforeRoot);
process.stdout.write(`[before:verified] ${JSON.stringify(beforeValues)} total=${beforeTotalMs.toFixed(1)}ms\n`);

// This non-interactive proof has explicit authority to create the two named
// files. Exercise the isolated posture intended for child agents.
getPermissionModeManager().setSubagentMode('acceptEdits');
const afterStarted = performance.now();
const intervals = new Map<string, { startedAt?: number; doneAt?: number }>();
const events: Array<{ atMs: number; agentId: string; kind: string }> = [];
const spawn = createDefaultBatchSpawnFn({
  cwd: afterRoot,
  apiKey: 'ollama',
  baseURL,
  model,
  concurrency: 2,
  maxToolRounds: 6,
  eventSink: (event) => {
    const atMs = performance.now() - afterStarted;
    events.push({ atMs, agentId: event.agentId, kind: event.kind });
    const interval = intervals.get(event.agentId) ?? {};
    if (
      event.kind === 'status' &&
      typeof event.payload === 'object' &&
      event.payload !== null &&
      'state' in event.payload &&
      event.payload.state === 'turn_started'
    ) {
      interval.startedAt = atMs;
    }
    if (event.kind === 'done') interval.doneAt = atMs;
    intervals.set(event.agentId, interval);
    const payload = JSON.stringify(event.payload).replace(/\r?\n/g, '\\n').slice(0, 500);
    process.stdout.write(`[after:+${atMs.toFixed(1)}ms:${event.agentId}:${event.kind}] ${payload}\n`);
  },
});
const goal = tasks
  .map(
    (task, index) =>
      `${index + 1}. Create ${task.file} exporting function ${task.exportName}() that returns ${task.value}. Only touch ${task.file}.`,
  )
  .join('\n');
const batchOutput = await handleBatchCommand(goal, undefined, spawn);
const afterTotalMs = performance.now() - afterStarted;
const afterValues = await verifyExports(afterRoot);

const alphaInterval = intervals.get('alpha');
const betaInterval = intervals.get('beta');
const overlapMs = alphaInterval?.startedAt !== undefined && alphaInterval.doneAt !== undefined &&
  betaInterval?.startedAt !== undefined && betaInterval.doneAt !== undefined
  ? Math.max(
      0,
      Math.min(alphaInterval.doneAt, betaInterval.doneAt) -
        Math.max(alphaInterval.startedAt, betaInterval.startedAt),
    )
  : 0;

process.stdout.write(`${batchOutput}\n`);
process.stdout.write(`[after:verified] ${JSON.stringify(afterValues)} total=${afterTotalMs.toFixed(1)}ms overlap=${overlapMs.toFixed(1)}ms\n`);
process.stdout.write(
  `SUMMARY=${JSON.stringify({
    beforeTotalMs: Number(beforeTotalMs.toFixed(1)),
    beforeUnitMs: Object.fromEntries(beforeUnits.map((unit) => [unit.label, Number(unit.durationMs.toFixed(1))])),
    afterTotalMs: Number(afterTotalMs.toFixed(1)),
    overlapMs: Number(overlapMs.toFixed(1)),
    eventCount: events.length,
    beforeValues,
    afterValues,
  })}\n`,
);
// CodeBuddyAgent owns bounded background timers; all proof assertions and
// delegate disposals have completed before this deterministic harness exit.
process.exit(0);
