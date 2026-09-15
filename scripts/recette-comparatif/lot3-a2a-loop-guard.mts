/**
 * Lot 3 recette — AGY's real A2ACallTool over HTTP against a loopback fixture, observed by THIS
 * branch's ToolLoopGuard. Nothing is merged: the tool is imported read-only from the AGY build.
 *
 *   node scripts/recette-comparatif/run-isolated.mjs lot3-a2a -- \
 *     node node_modules/tsx/dist/cli.mjs scripts/recette-comparatif/lot3-a2a-loop-guard.mts [/path/to/interop/dist/tools/a2a-call-tool.js]
 *
 * Scenarios (8 identical calls each):
 * - same text, new task/context UUIDs every call  → expected: warn at 5, stop at 8;
 * - stable control output                          → warn at 5, stop at 8;
 * - text changes every call (progress)             → never warns;
 * - peer state/instruction untouched, text constant but a different peer arg each call → never warns.
 * No LLM, no cloud; only 127.0.0.1.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ToolLoopGuard } from '../../src/agent/execution/tool-loop-guard.ts';

const toolModule = process.argv[2];
if (!toolModule) throw new Error('usage: lot3-a2a-loop-guard.mts <path/to/dist/tools/a2a-call-tool.js>');
const qaBase = process.env.RECETTE_QA_BASE;
if (!qaBase) throw new Error('run through run-isolated.mjs');
const { A2ACallTool } = await import(toolModule);

type Mode = 'constant-text' | 'changing-text';
let mode: Mode = 'constant-text';
let calls = 0;
const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  calls++;
  res.setHeader('Content-Type', 'application/json');
  const text = mode === 'constant-text' ? 'SAME_REVIEW_RESULT' : `REVIEW_RESULT_${calls}`;
  res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { task: { id: randomUUID(), contextId: randomUUID(), status: { state: 'TASK_STATE_COMPLETED' }, artifacts: [{ artifactId: randomUUID(), parts: [{ text }] }] } } }));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
process.env.A2A_QA_REVIEW_TOKEN = `synthetic-qa-only-${randomUUID()}`;
process.env.CODEBUDDY_A2A_PEERS = JSON.stringify({
  review: { url: `http://127.0.0.1:${port}`, outboundTokenEnv: 'A2A_QA_REVIEW_TOKEN' },
  review2: { url: `http://127.0.0.1:${port}`, outboundTokenEnv: 'A2A_QA_REVIEW_TOKEN' },
});

async function scenario(name: string, next: (n: number) => { args: Record<string, unknown>; mode: Mode }) {
  const guard = new ToolLoopGuard();
  const actions: string[] = [];
  const outputs: string[] = [];
  for (let n = 0; n < 8; n++) {
    const step = next(n);
    mode = step.mode;
    const result = await new A2ACallTool().execute(step.args);
    if (!result.success) throw new Error(`${name}: ${result.error}`);
    outputs.push(result.output);
    actions.push(guard.observe({ name: 'a2a_call', argumentsJson: JSON.stringify(step.args), result }).action);
  }
  return { name, actions, stopped: guard.hasStopped, distinctOutputs: new Set(outputs).size, sampleOutputKeys: Object.keys(JSON.parse(outputs[0]!)) };
}

try {
  const same = { peer: 'review', text: 'Read-only review of same file' };
  const results = [
    await scenario('constant text, new task/context ids', () => ({ args: same, mode: 'constant-text' })),
    await scenario('changing text (progress)', () => ({ args: same, mode: 'changing-text' })),
    await scenario('changing arguments (text)', (n) => ({ args: { peer: 'review', text: `Review file ${n}` }, mode: 'constant-text' })),
    await scenario('alternating peer argument', (n) => ({ args: { peer: n % 2 ? 'review' : 'review2', text: same.text }, mode: 'constant-text' })),
  ];
  const control = new ToolLoopGuard();
  const controlActions = Array.from({ length: 8 }, () => control.observe({ name: 'a2a_call', argumentsJson: JSON.stringify(same), result: { success: true, output: 'SAME_REVIEW_RESULT' } }).action);
  const report = {
    scope: 'AGY A2ACallTool (read-only import, not merged) over HTTP loopback + ToolLoopGuard from this branch; no LLM, no cloud',
    toolModule,
    httpCalls: calls,
    scenarios: results,
    stableControl: controlActions,
  };
  const [constant, changingText, changingArgs] = results;
  const pass = constant!.actions[4] === 'warn' && constant!.actions[7] === 'stop' && constant!.distinctOutputs === 8
    && !changingText!.actions.some((a) => a !== 'none') && !changingArgs!.actions.some((a) => a !== 'none')
    && controlActions[4] === 'warn' && controlActions[7] === 'stop';
  fs.writeFileSync(path.join(qaBase, 'summary.json'), `${JSON.stringify({ ...report, pass }, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, pass }, null, 2));
  process.exitCode = pass ? 0 : 1;
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
