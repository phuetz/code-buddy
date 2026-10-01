import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it.each([
  ['-p', 'explique le point d’entrée de ce projet', '--output-format', 'json', '--ephemeral'],
  ['-p', 'explain this code', '--output-format', 'json', '--ephemeral'],
  ['-p', 'analyze the codebase structure', '--output-format', 'json', '--ephemeral'],
  ['--model', 'fixture-model', 'dev', 'explain'],
])('reads repository files for %s %s even when the model never calls tools', async (...args) => {
  const root = await mkdtemp(join(tmpdir(), 'repository-read-'));
  const home = join(root, 'home');
  const workspace = join(root, 'workspace');
  await mkdir(home);
  await mkdir(workspace);
  await writeFile(join(workspace, 'package.json'), '{"main":"launch.js"}');
  await writeFile(join(workspace, 'launch.js'), 'console.log("ORACLE_TANGERINE");');
  await writeFile(join(workspace, 'README.md'), '# Tangerine\nEntry: launch.js');
  const requests: Array<{ model?: string; messages: Array<{ role: string; content: string; tool_calls?: unknown[] }> }> = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/ps') {
      res.end(JSON.stringify({ models: [{ name: 'fixture-model', context_length: 32768 }] }));
      return;
    }
    if (req.url === '/api/tags') {
      res.end('{"models":[{"name":"fixture-model"}]}');
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body.messages) { res.end('{}'); return; }
    requests.push(body);
    const read = body.messages.some((m: { role: string; content: string }) =>
      (m.role === 'tool' || m.role === 'user') && m.content.includes('ORACLE_TANGERINE'));
    res.end(JSON.stringify({ model: 'fixture-model', message: { role: 'assistant',
      content: read ? 'launch.js prints ORACLE_TANGERINE.' : 'I have no access to project files.' },
    done: true, done_reason: 'stop', prompt_eval_count: 10, eval_count: 10 }) + '\n');
  });
  try {
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((accept, reject) => {
      const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/index.ts'),
        ...args], {
        cwd: workspace, env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home,
          XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'),
          CODEBUDDY_PROVIDER: 'ollama', OLLAMA_HOST: `http://127.0.0.1:${address.port}`,
          GROK_MODEL: args.includes('dev') ? 'ambient-default' : 'fixture-model', LOG_LEVEL: 'error', NODE_ENV: 'development' },
      });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
      child.once('error', reject);
      child.once('close', code => { clearTimeout(timer); accept({ code, stdout, stderr }); });
    });
    expect(result.code, result.stderr).toBe(0);
    if (args[1]?.includes('point d’entrée')) {
      const output = JSON.parse(result.stdout);
      expect(output.result).toContain('package.json déclare `launch.js`');
      expect(output.result).toContain('Appel observé (launch.js:1) : `console.log("ORACLE_TANGERINE")`');
      expect(output.messages.filter((m: { role: string }) => m.role === 'tool').map((m: { content: string }) => m.content).join('\n')).toContain('ORACLE_TANGERINE');
      expect(requests.some(r => r.messages.some(m => m.role === 'user' && m.content === args[1]))).toBe(false);
    } else {
    expect(result.stdout).toContain('launch.js prints ORACLE_TANGERINE');
    const first = requests.find(r => r.messages?.some(m => m.role === 'user'));
    expect(first?.messages.filter(m => m.role === (args.includes('dev') ? 'user' : 'tool')).map(m => m.content).join('\n'))
      .toContain('ORACLE_TANGERINE');
    expect(first?.messages.some(m => m.role === 'tool')).toBe(!args.includes('dev'));
    expect(first?.messages.filter(m => m.role === 'assistant' && m.tool_calls?.length)
      .every(m => m.content === '')).toBe(true);
    if (!args.includes('dev')) expect(result.stdout).toContain('Repository context read requested by Code Buddy');
    if (args.includes('dev')) expect(first?.model).toBe('fixture-model');
    }
  } finally {
    await new Promise<void>(accept => server.close(() => accept()));
    await rm(root, { recursive: true, force: true });
  }
}, 45_000);
