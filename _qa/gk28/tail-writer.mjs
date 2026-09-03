#!/usr/bin/env node
import { RunStore } from '../../src/observability/run-store.ts';

const runsDir = process.env.CODEBUDDY_RUNS_DIR;
if (!runsDir) {
  console.error('CODEBUDDY_RUNS_DIR required');
  process.exit(1);
}

const store = new RunStore(runsDir);
const runId = store.startRun('gk28 tail probe', { channel: 'cli', tags: ['gk28-tail'] });
console.log(`RUNID=${runId}`);
store.emit(runId, { type: 'decision', data: { kind: 'gk28', step: 'started' } });

await new Promise((r) => setTimeout(r, 1500));
store.emit(runId, {
  type: 'tool_call',
  data: { toolName: 'bash', args: { command: 'echo GK28-TAIL-MARKER' } },
});
await new Promise((r) => setTimeout(r, 1500));
store.emit(runId, { type: 'decision', data: { kind: 'gk28', step: 'closing' } });
store.endRun(runId, 'completed');
store.dispose();
