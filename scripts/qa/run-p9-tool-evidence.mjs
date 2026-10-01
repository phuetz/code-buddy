import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { evaluateEvidence, fileDigest } from './evidence-oracles.mjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const qa = path.resolve(process.argv[2] ?? path.join(checkout, '_qa/preuves-p9'));
const root = path.join(qa, 'reprise-1/project');
const raw = path.join(qa, 'reprise-1/raw');
const only = process.argv[3]?.split(',');
process.chdir(root);
mkdirSync(raw, { recursive: true });
const load = file => import(pathToFileURL(path.join(checkout, 'dist', file)).href);
const { createInteractiveToolAdapters } = await load('tools/registry/interactive-adapters.js');
const { createCsvTools } = await load('tools/registry/csv-tools.js');
const { ConfirmationService } = await load('utils/confirmation-service.js');
ConfirmationService.getInstance().setSessionFlag('allOperations', true);
const { getPermissionModeManager } = await load('security/permission-modes.js');
getPermissionModeManager().setMode('bypassPermissions');
const tools = new Map([...createInteractiveToolAdapters(), ...createCsvTools()].map(tool => [tool.name, tool]));
const { initToolSearchIndex } = await load('tools/tool-search.js');
initToolSearchIndex(Array.from(tools.values()).map(t => ({ name: t.name, description: t.description, parameters: t.getSchema?.().parameters ?? {} })));
const scenarios = JSON.parse(readFileSync(path.join(checkout, 'scripts/qa/p9-tool-scenarios.json'), 'utf8'));
const substitute = value => typeof value === 'string' ? value.replaceAll('<QA_PROJECT>', root).replaceAll('<QA_HOME>', process.env.HOME).replaceAll('<NODE_VERSION>', process.version) : Array.isArray(value) ? value.map(substitute) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, val]) => [key, substitute(val)])) : value;
const text = file => existsSync(file) ? readFileSync(file, 'utf8') : '';
const json = file => JSON.parse(text(file));
const allTextFiles = directory => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? allTextFiles(path.join(directory, entry.name)) : /\.(json|md|html)$/.test(entry.name) ? [path.join(directory, entry.name)] : []);
};
const containsObject = (value, predicate) => value && typeof value === 'object' && (predicate(value) || Object.values(value).some(child => containsObject(child, predicate)));
const outputs = [];
let preparationCalls = [];
const call = async (name, input) => {
  if (!tools.has(name)) throw new Error(`No production adapter: ${name}`);
  return tools.get(name).execute(input);
};

async function prepare(c) {
  const setup = async (name, input) => {
    const result = await call(name, input);
    preparationCalls.push({ name, input, result });
    if (!result.success) throw new Error(`Preparation failed: ${name}: ${result.error ?? result.output}`);
    return result;
  };
  const n = c.name;
  if (['str_replace_editor', 'multi_edit'].includes(n)) writeFileSync('new.txt', n === 'str_replace_editor' ? 'P9_NEW' : 'P9_EDIT');
  if (n === 'meeting_notes') c.input.output_prefix = `meeting-report-${Date.now()}`;
  if (n === 'export' && existsSync('export.csv')) unlinkSync('export.csv');
  if (n === 'plan' && existsSync('PLAN.md')) unlinkSync('PLAN.md');
  for (const [tool, file] of [['screenshot', 'p9-screen.png'], ['text_to_speech', 'tts-p9.wav'], ['video_stitch', 'stitched-second.mp4']]) {
    if (n === tool && existsSync(file)) unlinkSync(file);
  }
  if (n === 'patch') writeFileSync('patch-nine.txt', 'P9_BEFORE');
  if (n === 'resolve_conflicts') writeFileSync('conflict.txt', '<<<<<<< HEAD\nP9_OURS\n=======\nP9_THEIRS\n>>>>>>> branch\n');
  if (n === 'format_project') writeFileSync('format-fixture/unformatted.js', 'const   p9=42');
  if (n === 'lsp_rename') writeFileSync('rename-space test.ts', text('sample.ts'));
  if (n === 'build_project' && existsSync('dist/app.js')) unlinkSync('dist/app.js');
  if (n === 'generate_document' && existsSync('p9.docx')) unlinkSync('p9.docx');
  if (n === 'create_file' && existsSync('new.txt')) unlinkSync('new.txt');
  if (n === 'write_file' && existsSync('alias.txt')) unlinkSync('alias.txt');
  if (n === 'scaffold_app' && existsSync(c.input.targetDir)) throw new Error('Use a fresh target directory for scaffold');
  if (n === 'archive' && existsSync('bundle.zip')) unlinkSync('bundle.zip');
  if (n === 'create_todo_list') await setup('create_todo_list', { todos: [{ id: 'p9-todo', content: 'P9_BEFORE', status: 'pending', priority: 'high' }] });
  if (n === 'extension_forge') {
    for (const file of ['widget.html', 'meta.json']) {
      const target = path.join(process.env.HOME, '.codebuddy/widgets/authored-p9-fixture-widget', file);
      if (existsSync(target)) unlinkSync(target);
    }
  }
  const nonce = String(Date.now());
  if (['lessons_add', 'lessons_propose', 'user_model_observe'].includes(n)) c.input.content += ` ${nonce}`;
  if (n === 'memory_propose') c.input.value += ` ${nonce}`;
  if (n === 'todo_update') c.input.text += ` ${nonce}`;
  if (n === 'create_skill') {
    const f = '.codebuddy/skills/authored-p9-fixture/SKILL.md';
    if (existsSync(f)) unlinkSync(f);
  }
  if (n === 'skill_manage' && existsSync('.codebuddy/skills/authored-p9-fixture/SKILL.md')) unlinkSync('.codebuddy/skills/authored-p9-fixture/SKILL.md');
  if (n === 'skill_manage') await setup('create_skill', { name: 'P9 Fixture', overwrite: true, description: 'Synthetic procedure', body: '# P9_SKILL\nUse for P9 fixture only. Run node --test check.test.js.' });
  if (['get_todo_list', 'update_todo_list'].includes(n)) await setup('create_todo_list', { todos: [{ id: 'p9-todo', content: 'P9_TODO', status: 'pending', priority: 'high' }] });
  if (n.startsWith('kanban_')) {
    c.input.id = `p9r1-${n}-${nonce}`;
    if (n !== 'kanban_create') await setup('kanban_create', { id: c.input.id, title: 'P9_CARD' });
    if (n === 'kanban_unblock') await setup('kanban_block', { id: c.input.id, reason: 'QA precondition' });
    if (n === 'kanban_heartbeat') await setup('kanban_unblock', { id: c.input.id });
  }
  if (['recall', 'replace_memory', 'forget'].includes(n)) await setup('remember', { key: 'p9-marker', value: 'P9_MEMORY', scope: 'project' });
  if (n === 'remember') await setup('remember', { key: 'p9-marker', value: 'P9_BEFORE', scope: 'project' });
  if (['lessons_list', 'lessons_search', 'lessons_graph'].includes(n)) await setup('lessons_add', { category: 'RULE', content: 'P9_LESSON', source: 'manual' });
  if (n === 'knowledge_search') await setup('knowledge_add', { title: 'P9 Knowledge', content: 'P9_KNOWLEDGE', tags: ['p9'] });
  if (n === 'knowledge_add') c.input.title = `P9 Knowledge ${Date.now()}`;
  if (n === 'knowledge_graph') c.input.subject = `p9r1-entity-${Date.now()}`;
  if (n === 'computer_control') await setup('computer_control', { action: 'move_mouse', x: 42, y: 84 });
  if (n === 'self_evolution') writeFileSync('CHANGELOG.md', '# Changelog\n\n## 2026-09-30\n### Added\n- P9_SYNTHETIC_RELEASE fixture only.\n');
  if (n === 'docs_search') {
    mkdirSync('.codebuddy/docs', { recursive: true });
    writeFileSync('.codebuddy/docs/p9-fixture.md', '# P9_FIXTURE architecture\nP9_FIXTURE describes isolated evidence collection.\n');
  }
  return { sourceBefore: text('sample.js') };
}

async function observe(c, result, before) {
  const n = c.name;
  const o = {};
  const followups = [];
  const follow = async (name, input) => {
    const r = await call(name, input);
    followups.push({ name, input, result: r });
    return r;
  };
  if (n === 'find_definition') {
    const location = result.output?.match(/File: (sample\.(?:ts|js)):([0-9]+)/);
    const signature = result.output?.match(/Signature: (.+)/)?.[1];
    o.definitionMatchesFixture = !!location && !!signature && text(location[1]).split('\n')[Number(location[2]) - 1] === signature;
  }
  if (n === 'archive') {
    o.archiveEntries = execFileSync('unzip', ['-Z1', 'bundle.zip'], { encoding: 'utf8' }).trim().split('\n').sort();
    o.archiveA = execFileSync('unzip', ['-p', 'bundle.zip', 'a.txt'], { encoding: 'utf8' });
    o.archiveB = execFileSync('unzip', ['-p', 'bundle.zip', 'b.txt'], { encoding: 'utf8' });
  }
  if (n === 'generate_document') {
    const xml = execFileSync('unzip', ['-p', 'p9.docx', 'word/document.xml'], { encoding: 'utf8' });
    o.docxText = Array.from(xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g), m => m[1]).join(' ').replace(/\s+/g, ' ').trim();
  }
  if (n === 'codebase_replace') o.sourceUnchanged = text('sample.js') === before.sourceBefore;
  if (n === 'codebase_map') {
    const r = await follow('codebase_map', { root, operation: 'symbols' });
    o.mapHasSample = r.success && r.output.includes('add (sample.ts:1)') && r.output.includes('add (sample.js:1)');
  }
  if (['create_todo_list', 'update_todo_list'].includes(n)) {
    const r = await follow('get_todo_list', {});
    o.todoContent = r.success && r.output.includes('P9_TODO') ? 'P9_TODO' : null;
    o.todoStatus = r.output?.includes('1/1 completed') ? 'completed' : r.output?.includes('0/1 completed') ? 'pending' : null;
  }
  if (n.startsWith('kanban_')) {
    const board = json(result.data.boardPath);
    let card;
    containsObject(board, v => { if (v.id === c.input.id && v.title === 'P9_CARD') { card = v; return true; } return false; });
    o.persistedCard = card;
  }
  if (n === 'git_summary') {
    const lines = execFileSync('/usr/bin/git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    o.gitSummaryMatches = result.data.untracked === lines.filter(l => l.startsWith('??')).length;
  }
  if (['remember', 'replace_memory', 'forget'].includes(n)) {
    const r = await follow('recall', { key: 'p9-marker', scope: 'project' });
    o.memoryValue = r.output?.includes('P9_REPLACED') ? 'P9_REPLACED' : r.output?.includes('P9_MEMORY') ? 'P9_MEMORY' : null;
    o.memoryAbsent = !r.output?.includes('P9_MEMORY') && !r.output?.includes('P9_REPLACED') && /not found|no memory|no memories/i.test(r.output ?? r.error ?? '');
  }
  if (n === 'knowledge_add') {
    const file = result.output?.match(/saved to (.+)$/)?.[1];
    o.knowledgePersisted = !!file && text(file).includes('P9_KNOWLEDGE') && text(file).includes(c.input.title);
  }
  if (n === 'knowledge_graph') {
    const r = await follow('knowledge_graph', { action: 'query', subject: c.input.subject, predicate: c.input.predicate, object: c.input.object });
    o.graphHasEdge = r.success && r.output.includes(`${c.input.subject} --calls--> p9-b`);
  }
  if (n === 'extension_forge') {
    const dir = path.join(process.env.HOME, '.codebuddy/widgets/authored-p9-fixture-widget');
    o.widgetTemplate = text(path.join(dir, 'widget.html')).trim();
    o.widgetName = json(path.join(dir, 'meta.json')).kind;
  }
  if (n === 'lessons_add') o.lessonPersisted = text('.codebuddy/lessons.md').includes(c.input.content);
  if (n === 'lessons_propose') {
    o.lessonCandidatePersisted = text('.codebuddy/lesson-candidates.json').includes(c.input.content);
    o.lessonNotAccepted = !text('.codebuddy/lessons.md').includes(c.input.content);
  }
  if (n === 'memory_propose') {
    o.memoryCandidatePersisted = text('.codebuddy/memory-candidates.json').includes(c.input.value);
    const r = await follow('recall', { key: 'p9-candidate', scope: 'project' });
    o.memoryNotAccepted = !r.output?.includes('P9_CANDIDATE');
  }
  if (n === 'user_model_observe') {
    const data = json('.codebuddy/user-model.json');
    o.userProposalPersisted = containsObject(data, x => x.content === c.input.content && x.status === 'pending');
    const r = await follow('user_model_recall', { query: 'P9_SYNTHETIC' });
    o.userNotAccepted = !r.output?.includes('prefers concise output');
  }
  if (n === 'todo_update') o.attentionPersisted = text('todo.md').includes(c.input.text);
  if (n === 'meeting_notes' && result.success) o.meetingArtifacts = Object.values(result.data.paths).every(file => existsSync(file)) && allTextFiles(root).some(file => path.basename(file).includes('meeting-report') && text(file).includes('P9'));
  if (n === 'internet_scout_run') o.scoutFetchedBody = result.data.evidence.some(x => JSON.stringify(x).includes('This domain is for use in documentation examples'));
  if (n === 'reason') o.solution42 = /\b42\b/.test((result.output ?? '').split('📋 SOLUTION:')[1]?.split('🛤️')[0] ?? '');
  if (n === 'task_verify') o.tapActual = /(?:pass\s*1|1 passed)/i.test(result.output ?? '') && !/(?:fail\s*[1-9]|[1-9] failed)/i.test(result.output ?? '');
  if (n === 'remind') {
    const remindersFile = path.join(process.env.HOME, '.codebuddy/reminders.json');
    o.reminderPersisted = json(remindersFile).some(r => r.id === result.data.id && r.label === c.input.label && r.time === c.input.time);
    const { removeReminder } = await load('companion/reminders.js');
    await removeReminder(result.data.id);
    o.reminderRemoved = !json(remindersFile).some(r => r.id === result.data.id);
  }
  if (n === 'text_to_speech') {
    const f = result.data.outputPath;
    const b = readFileSync(f);
    o.wavValid = b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE' && b.length > 1000;
  }
  if (n === 'screenshot') {
    const b = readFileSync(result.data.path);
    o.pngValid = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.readUInt32BE(16) > 0 && b.readUInt32BE(20) > 0;
  }
  if (n === 'qr') {
    const { default: sharp } = await load('../node_modules/sharp/lib/index.js');
    const { default: jsqr } = await import(pathToFileURL(path.join(qa, 'reprise-1/decoder/node_modules/jsqr/dist/jsQR.js')).href);
    const { data, info } = await sharp(result.data.path, { density: 300 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    o.qrDecoded = jsqr(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null;
    o.qrPixelSize = { width: info.width, height: info.height };
    const { default: qrcode } = await import(pathToFileURL(path.join(qa, 'reprise-1/decoder/node_modules/qrcode/lib/index.js')).href);
    const control = await sharp(await qrcode.toBuffer('P9_QR_CONTROL')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    o.qrDecoderControl = jsqr(new Uint8ClampedArray(control.data), control.info.width, control.info.height)?.data === 'P9_QR_CONTROL';
  }
  if (n === 'video_stitch') {
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', result.data.outputPath], { encoding: 'utf8' }));
    o.stitchedDuration = Math.round(Number(info.format.duration));
    o.stitchedWidth = info.streams.find(s => s.codec_type === 'video').width;
  }
  if (n === 'scaffold_app') {
    const p = c.input.targetDir;
    const { symlinkSync } = await import('node:fs');
    if (!existsSync(path.join(p, 'node_modules'))) symlinkSync(path.join(checkout, 'node_modules'), path.join(p, 'node_modules'));
    execFileSync('npm', ['run', 'build'], { cwd: p, encoding: 'utf8' });
    const manifest = json(path.join(p, 'package.json'));
    const entry = typeof manifest.bin === 'string' ? manifest.bin : Object.values(manifest.bin ?? {})[0];
    const out = execFileSync(process.execPath, [path.join(p, entry), '--help'], { encoding: 'utf8' });
    o.scaffoldRun = /p9-cli/.test(out);
  }
  if (['search', 'search_files', 'search_multi'].includes(n)) {
    const input = n === 'search_multi' ? { patterns: ['P9R1_ABSENT_ORACLE'], operator: 'OR' } : { query: 'P9R1_ABSENT_ORACLE', search_type: 'text' };
    const r = await follow(n, input);
    o.searchNegativeEmpty = r.success && (/no (?:results|matches|matching)/i.test(r.output ?? '') || (n === 'search_multi' && /\(0 matches\)/.test(r.output ?? '') && !/\([1-9]\d* matches\)/.test(r.output ?? '')));
  }
  if (n === 'community_search') {
    const queries = ['"A Spectral Theory of Distortion"', '"Weighted Bilinear Hardy Operators"'];
    const results = [];
    for (const query of queries) results.push(await follow('community_search', { query, sources: ['arxiv'], limit: 2, days: 365 }));
    o.communityQueriesRespected = results.every((r, i) => r.success && r.data.hits.length > 0 && r.data.hits.every(h => h.title.includes(queries[i].slice(1, -1))));
  }
  return { observations: o, verificationCalls: followups };
}

try {
  for (const original of scenarios.filter(c => !only || only.includes(c.name))) {
    const c = substitute(original);
    const started = Date.now();
    preparationCalls = [];
    let result, context, extra, error;
    try {
      const prepared = await prepare(c);
      const beforeFiles = Object.fromEntries(c.oracle.rules.filter(r => r.file && r.changed).map(r => [r.file, fileDigest(path.resolve(root, r.file))]));
      result = await call(c.name, c.input);
      extra = await observe(c, result, prepared);
      context = { root, beforeFiles, ...extra };
    } catch (e) {
      error = String(e);
      result ??= { success: false, error };
      context ??= { root };
    }
    const verdict = evaluateEvidence(result, c.oracle, context);
    const echo = evaluateEvidence({ success: true, output: JSON.stringify(c.input), data: c.input }, c.oracle, { root, beforeFiles: Object.fromEntries(c.oracle.rules.filter(r => r.file).map(r => [r.file, fileDigest(path.resolve(root, r.file))])) });
    let row = { ...c, preparationCalls, result, ...extra, ...verdict, echoRejected: !echo.passed, harnessError: error, ms: Date.now() - started };
    try { JSON.stringify(row); } catch { row = { ...row, result: { success: result.success, output: result.output, error: result.error, dataSerialization: 'cyclic data omitted' } }; }
    writeFileSync(path.join(raw, `strict-${c.name}.json`), JSON.stringify(row, null, 2));
    outputs.push(row);
    writeFileSync(path.join(raw, 'strict-results.json'), JSON.stringify(outputs, null, 2));
    process.stdout.write(`${c.name} ${row.passed ? 'PASS' : 'FAIL'} ${error ?? row.checks.filter(x => !x.passed).map(x => x.check).join('; ')}\n`);
  }
} finally {
  const { getLSPClient } = await load('lsp/lsp-client.js');
  await getLSPClient().stopAll();
}
process.exit(0);
