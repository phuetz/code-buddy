import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it.each(['edit', 'jest-red', 'vitest-red', 'green'])('real CLI rejects adverse completion: %s', async scenario => {
  const root = await mkdtemp(join(tmpdir(), 'source-report-cli-'));
  const home = join(root, 'home');
  const workspace = join(root, 'workspace');
  await mkdir(home); await mkdir(workspace);
  const summary = scenario === 'jest-red' ? 'Tests: 2 failed, 1 passed, 3 total'
    : scenario === 'vitest-red' ? 'Tests 1 passed | 2 failed' : 'Tests: 3 passed, 3 total';
  const files = { 'package.json': JSON.stringify({ name: 'adverse-fixture', version: '1.0.0', scripts: { test: 'node check.cjs' } }),
    'check.cjs': `console.log(${JSON.stringify(summary)});\n` };
  for (const [name, content] of Object.entries(files)) await writeFile(join(workspace, name), content);
  const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/ps') { res.end('{"models":[{"name":"fixture-model","context_length":32768}]}'); return; }
    if (req.url === '/api/tags') { res.end('{"models":[{"name":"fixture-model"}]}'); return; }
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (!body.messages) { res.end('{}'); return; }
    requests.push(body);
    const index = requests.length - 1;
    const message = index === 0 && scenario !== 'edit'
      ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'bash', arguments: { command: 'npm test' } } }] }
      : { role: 'assistant', content: scenario === 'edit' ? 'The version is 1.0.0.' : 'The suite is green.' };
    res.end(JSON.stringify({ model: 'fixture-model', message, done: true, done_reason: 'stop', prompt_eval_count: 100, eval_count: 10 }) + '\n');
  });
  try {
    await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((accept, reject) => {
      const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/index.ts'),
        '-p', scenario === 'edit' ? 'Show me the version by editing package.json to 9.9.9' : 'Run the tests and fix any failures',
        '--output-format', 'json', '--ephemeral', '--max-tool-rounds', '8', '--permission-mode', 'dontAsk'], {
        cwd: workspace, env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home,
          XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'),
          XDG_DATA_HOME: join(home, 'data'), XDG_STATE_HOME: join(home, 'state'),
          CODEBUDDY_PROVIDER: 'ollama', OLLAMA_HOST: `http://127.0.0.1:${address.port}`,
          GROK_MODEL: 'fixture-model', CODEBUDDY_DISABLE_MCP: 'true', CODEBUDDY_SESSION_END_FLUSH: 'false', CODEBUDDY_LEARNING_BACKGROUND_REVIEW: 'false',
          LOG_LEVEL: 'error', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); accept({ code, stdout, stderr }); });
    });
    const output = JSON.parse(result.stdout);
    expect(result.code === 0, result.stderr + result.stdout).toBe(scenario === 'green');
    expect(output.success).toBe(scenario === 'green');
    if (scenario === 'edit') expect(output.reasons).toContain('requested_edit_not_executed');
    else {
      const observations = requests.flatMap(request => request.messages).filter(message => message.role === 'tool');
      expect(observations.some(message => message.content.includes(summary)), JSON.stringify(observations)).toBe(true);
      if (scenario !== 'green') expect(output.reasons).toContain('verification_failed');
    }
    for (const [name, content] of Object.entries(files)) expect(await readFile(join(workspace, name), 'utf8')).toBe(content);
  } finally {
    await new Promise<void>(accept => server.close(() => accept()));
    await rm(root, { recursive: true, force: true });
  }
}, 45_000);
