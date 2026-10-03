import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

type Call = { name: string; arguments: Record<string, unknown> };
const read: Call = { name: 'view_file', arguments: { path: 'source.js' } };
const edit = (path: string): Call => ({ name: 'str_replace_editor', arguments: { path, command: 'str_replace', old_str: '1', new_str: '2' } });
const cases: Array<{ name: string; prompt: string; calls: Call[]; success: boolean; source?: string; package?: string; answer?: string }> = [
  { name: 'reminder-read-missing', prompt: "N'oublie pas d'expliquer source.js", calls: [], success: false },
  { name: 'reminder-read-ok', prompt: 'You must not forget to explain source.js.', calls: [read], success: true, answer: 'source.js exports value, equal to 1.' },
  { name: 'reminder-edit-missing', prompt: "N'hésite pas à modifier source.js", calls: [], success: false },
  { name: 'reminder-edit-ok', prompt: "N'oublie pas de modifier source.js", calls: [edit('source.js')], success: true, source: 'export const value = 2;\n' },
  { name: 'incidental-means-missing', prompt: 'Explain closures. The change occurs in source.js by editing it.', calls: [], success: false },
  { name: 'mixed-wrong-target', prompt: 'Do not edit package.json; update source.js.', calls: [edit('package.json')], success: false, package: '{"name":"fixture","version":"2"}\n' },
  { name: 'mixed-right-target', prompt: 'Do not edit package.json; update source.js.', calls: [edit('source.js')], success: true, source: 'export const value = 2;\n' },
  { name: 'numeric-prefix-replace', prompt: 'Change value to 2 in source.js.', calls: [{ name: 'str_replace_editor', arguments: { path: 'source.js', old_str: '1.2 export const value = 1;\n', new_str: '1.2 export const value = 2;\n' } }], success: false },
  { name: 'numeric-prefix-whole-replace', prompt: 'Change value to 2 in source.js.', calls: [{ name: 'str_replace_editor', arguments: { path: 'source.js', old_str: '1.0 export const value = 1;\n', new_str: 'mutated' } }], success: false },
  { name: 'recovered-search', prompt: 'Which file sets value? Update only its literal in source.js.', calls: [
    { name: 'bash', arguments: { command: 'grep -r value --include="*.js" . | grep -i missing' } },
    { name: 'bash', arguments: { command: 'grep -r value --include="*.js" .' } }, edit('source.js')], success: true, source: 'export const value = 2;\n', answer: 'source.js sets value, now equal to 2.' },
];

it.each(cases)('real CLI verifies positive obligations: $name', async scenario => {
  const root = await mkdtemp(join(tmpdir(), 'positive-cli-'));
  const home = join(root, 'home'); const workspace = join(root, 'workspace');
  await mkdir(home); await mkdir(workspace);
  const source = 'export const value = 1;\n'; const manifest = '{"name":"fixture","version":"1"}\n';
  await writeFile(join(workspace, 'source.js'), source);
  await writeFile(join(workspace, 'package.json'), manifest);
  const requests: unknown[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/ps') { res.end('{"models":[{"name":"fixture-model","context_length":32768}]}'); return; }
    if (req.url === '/api/tags') { res.end('{"models":[{"name":"fixture-model"}]}'); return; }
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (!body.messages) { res.end('{}'); return; }
    const call = scenario.calls[requests.length]; requests.push(body);
    const message = call ? { role: 'assistant', content: '', tool_calls: [{ function: call }] }
      : { role: 'assistant', content: scenario.answer ?? 'Observed answer.' };
    res.end(JSON.stringify({ model: 'fixture-model', message, done: true, done_reason: 'stop', prompt_eval_count: 100, eval_count: 10 }) + '\n');
  });
  try {
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No port');
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((accept, reject) => {
      const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/index.ts'), '-p', scenario.prompt,
        '--output-format', 'json', '--ephemeral', '--max-tool-rounds', '8', '--permission-mode', 'dontAsk'], {
        cwd: workspace, env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home,
          XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), XDG_DATA_HOME: join(home, 'data'), XDG_STATE_HOME: join(home, 'state'),
          CODEBUDDY_PROVIDER: 'ollama', OLLAMA_HOST: `http://127.0.0.1:${address.port}`, GROK_MODEL: 'fixture-model',
          CODEBUDDY_DISABLE_MCP: 'true', CODEBUDDY_SESSION_END_FLUSH: 'false', CODEBUDDY_LEARNING_BACKGROUND_REVIEW: 'false',
          LOG_LEVEL: 'error', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); accept({ code, stdout, stderr }); });
    });
    const files = { source: await readFile(join(workspace, 'source.js'), 'utf8'), package: await readFile(join(workspace, 'package.json'), 'utf8') };
    if (process.env.QA_HEADLESS_TRACE_DIR) {
      await mkdir(process.env.QA_HEADLESS_TRACE_DIR, { recursive: true });
      await writeFile(join(process.env.QA_HEADLESS_TRACE_DIR, scenario.name + '.json'), JSON.stringify({ result, requests, files }, null, 2));
    }
    expect(result.code, result.stderr + result.stdout).toBe(scenario.success ? 0 : 1);
    expect(JSON.parse(result.stdout).success).toBe(scenario.success);
    expect(files.source).toBe(scenario.source ?? source);
    expect(files.package).toBe(scenario.package ?? manifest);
  } finally {
    await new Promise<void>(accept => server.close(() => accept()));
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
