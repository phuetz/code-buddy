import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const rulesFile = path.join(root, '_qa/p3/sensory-rules.json');
process.env.CODEBUDDY_SENSORY_RULES_FILE = rulesFile;
process.env.CODEBUDDY_RULE_RUNS_FILE = path.join(root, '_qa/p3/rule-runs.jsonl');
await fs.rm(process.env.CODEBUDDY_RULE_RUNS_FILE, { force: true });
await fs.rm(path.join(root, '_qa/p3/rules-action.txt'), { force: true });
const { getGlobalEventBus } = await import(pathToFileURL(`${root}/src/events/event-bus.ts`));
const { wireSensoryRules, readRuleRuns } = await import(pathToFileURL(`${root}/src/sensory/sensory-rules-engine.ts`));
const stop = wireSensoryRules({
  rules: [{ id: 'p3-local-action', match: { modality: 'vision', kind: 'person_entered' }, action: { type: 'shell', command: 'printf triggered > _qa/p3/rules-action.txt' } }],
});
getGlobalEventBus().emit('sensory:perception', {
  id: 'p3-rule-event', type: 'sensory:perception', source: 'p3-local-fixture', timestamp: Date.now(),
  metadata: { modality: 'vision', kind: 'person_entered', salience: 150, payload: {} },
});
let runs = [];
for (let i = 0; i < 50; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  runs = await readRuleRuns(5);
  if (runs.some((run) => run.rule === 'p3-local-action')) break;
}
stop();
const action = await fs.readFile(path.join(root, '_qa/p3/rules-action.txt'), 'utf8').catch(() => '');
console.log(JSON.stringify({ auditEntries: runs.length, lastRun: runs.find((run) => run.rule === 'p3-local-action') ?? null, actionBytes: Buffer.byteLength(action), actionOutput: action }, null, 2));
if (!runs.some((run) => run.rule === 'p3-local-action' && run.ok) || action !== 'triggered') process.exitCode = 1;
