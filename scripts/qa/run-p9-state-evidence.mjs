import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const qa = path.resolve(process.argv[2] ?? path.join(checkout, '_qa/preuves-p9'));
const root = path.join(qa, 'reprise-1/project');
process.chdir(root);
const load = file => import(pathToFileURL(path.join(checkout, 'dist', file)).href);
const { createInteractiveToolAdapters } = await load('tools/registry/interactive-adapters.js');
const tools = new Map(createInteractiveToolAdapters().map(t => [t.name, t]));
const call = (name, input) => tools.get(name).execute(input);
const rows = [];
const record = (name, input, results, observations) => {
  const result = results.at(-1);
  const passed = results.every(r => r.success === true) && Object.values(observations).every(v => v === true);
  rows.push({ name, input, result, results, observations, passed });
  writeFileSync(path.join(qa, 'reprise-1/raw/state-strict.json'), JSON.stringify(rows, null, 2));
  process.stdout.write(`${name} ${passed ? 'PASS' : 'FAIL'}\n`);
};

const c = await call('canvas', { action: 'create' });
const canvasId = c.output.match(/created: (.*)/)?.[1];
const add = await call('canvas', { action: 'add_element', canvasId, element: { type: 'text', content: 'P9_CANVAS', position: { x: 12, y: 34 }, size: { width: 100, height: 50 } } });
const exported = await call('canvas', { action: 'export', canvasId });
const canvas = JSON.parse(exported.output);
record('canvas', { sequence: ['create', 'add_element', 'export'] }, [c, add, exported], { uniqueCanvas: canvas.id === canvasId, renderedContent: canvas.elements?.length === 1 && canvas.elements[0].content === 'P9_CANVAS', actualSnapping: canvas.elements?.[0]?.position?.x === 20 && canvas.elements[0].position.y === 40 });

const surfaceId = `p9-r1-${Date.now()}`;
const ui = [];
for (const input of [{ action: 'create_surface', surfaceId }, { action: 'add_component', surfaceId, component: { id: 'p9-text', type: 'text', props: { value: 'P9_A2UI' } } }, { action: 'begin_rendering', surfaceId, root: 'p9-text' }, { action: 'get_surface', surfaceId }, { action: 'render_terminal', surfaceId }]) ui.push(await call('a2ui', input));
record('a2ui', { surfaceId, sequence: ['create_surface', 'add_component', 'begin_rendering', 'get_surface', 'render_terminal'] }, ui, { surfaceVisible: ui[3].output.includes('1 components, visible=true'), terminalFrame: ui[4].output.includes('╔') && ui[4].output.includes('P9_A2UI') && ui[4].output.includes(surfaceId) });

const { getProcessTool } = await load('tools/process-tool.js');
const child = spawn(process.execPath, ['-e', "console.log('P9_READY');process.stdin.on('data',d=>process.stdout.write('P9_ECHO:'+d))"], { stdio: ['pipe', 'pipe', 'pipe'] });
const stdout = [];
child.stdout.on('data', b => stdout.push(String(b)));
const exited = once(child, 'exit');
getProcessTool().trackProcess(child.pid, 'P9_CHILD', child);
try {
  await new Promise(resolve => setTimeout(resolve, 150));
  const results = [await call('process', { action: 'poll', args: { pid: child.pid } }), await call('process', { action: 'log', args: { pid: child.pid } }), await call('process', { action: 'write', args: { pid: child.pid, input: 'P9_INPUT' } })];
  await new Promise(resolve => setTimeout(resolve, 150));
  results.push(await call('process', { action: 'log', args: { pid: child.pid } }), await call('process', { action: 'kill', args: { pid: child.pid } }));
  await exited;
  results.push(await call('process', { action: 'poll', args: { pid: child.pid } }));
  record('process', { sequence: ['poll', 'log', 'write', 'log', 'kill', 'poll'] }, results, { liveOutput: results[1].output.includes('P9_READY'), echoThroughChildStdin: results[3].output.includes('P9_ECHO:P9_INPUT') && stdout.join('').includes('P9_ECHO:P9_INPUT'), actualExit: child.exitCode !== null || child.signalCode !== null, trackedExit: results[5].output.includes('not running') });
} finally { child.kill('SIGTERM'); }

const created = await call('cronjob', { action: 'create', name: 'P9_CRON_R1', at: '2099-01-01T00:00:00Z', command: { executable: 'node', args: ['-e', 'console.log(42)'] } });
const id = created.data?.job?.id;
let shown, removed;
try { shown = await call('cronjob', { action: 'show', id }); }
finally { removed = await call('cronjob', { action: 'remove', id }); }
const listed = await call('cronjob', { action: 'list' });
record('cronjob', { sequence: ['create', 'show', 'remove', 'list'] }, [created, shown, removed, listed], { persistedJob: shown.data?.job?.name === 'P9_CRON_R1' && shown.data.job.schedule.at === '2099-01-01T00:00:00.000Z' && shown.data.job.task.command.args[1] === 'console.log(42)', removed: !listed.output.includes(id) && !listed.output.includes('P9_CRON_R1') });

const { CodeBuddyAgent } = await load('agent/codebuddy-agent.js');
const { ConfirmationService } = await load('utils/confirmation-service.js');
const { getPermissionModeManager } = await load('security/permission-modes.js');
ConfirmationService.getInstance().setSessionFlag('allOperations', true);
getPermissionModeManager().setMode('bypassPermissions');
const agent = new CodeBuddyAgent('ollama', process.env.GROK_BASE_URL, process.env.GROK_MODEL, 4, true, undefined, root, undefined, 'You are a concise assistant.');
try {
  await agent.processUserMessage('Reply READY without tools.');
  const file = 'p9-apply-r1.txt';
  if (existsSync(file)) unlinkSync(file);
  const input = { patch: `*** Begin Patch\n*** Add File: ${file}\n+P9_APPLIED_R1\n*** End Patch` };
  const applied = await agent.executeToolByName('apply_patch', input);
  record('apply_patch', input, [applied], { actualWrite: existsSync(file) && readFileSync(file, 'utf8').trimEnd() === 'P9_APPLIED_R1' });
  const code = { code: "const r=await tools.read_file({path:'data.json'}); text(r.output);" };
  const ran = await agent.executeToolByName('code_exec', code);
  const data = readFileSync('data.json', 'utf8');
  record('code_exec', code, [ran], { actualReadContent: ran.output.includes(data.trim()) && data.includes('P9_JSON') && data.includes('42'), noRequestEcho: !code.code.includes('P9_JSON') });
} finally {
  const { getLSPClient } = await load('lsp/lsp-client.js');
  await getLSPClient().stopAll();
}
process.exit(0);
