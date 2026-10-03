import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it.each(['text', 'stream-json'])('persists a completed tool before the next request in %s mode', async format => {
  const root = await mkdtemp(join(tmpdir(), 'headless-checkpoint-'));
  const home = join(root, 'home');
  const workspace = join(root, 'workspace');
  const sessions = join(home, '.codebuddy', 'sessions');
  await mkdir(home);
  await mkdir(workspace);
  await writeFile(join(workspace, 'marker.txt'), 'CHECKPOINT_TOOL_OBSERVATION');
  let sawTool = false;
  let stop: (() => void) | undefined;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/tags') { res.end('{"models":[]}'); return; }
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (!body.messages) { res.end('{}'); return; }
    if (body.messages.some((m: { role: string; content: string }) =>
      m.role === 'tool' && m.content.includes('CHECKPOINT_TOOL_OBSERVATION'))) {
      sawTool = true;
      // Kill while the next inference is pending: final-turn save cannot help.
      stop?.();
      return;
    }
    res.end(JSON.stringify({ model: 'fixture-model', message: { role: 'assistant', content: '',
      tool_calls: [{ function: { name: 'view_file', arguments: { path: join(workspace, 'marker.txt') } } }] },
    done: true, done_reason: 'stop', prompt_eval_count: 10, eval_count: 10 }) + '\n');
  });
  try {
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    let stderr = '';
    await new Promise<void>((accept, reject) => {
      const child = spawn(process.execPath, ['--import', resolve('node_modules/tsx/dist/loader.mjs'), resolve('src/index.ts'),
        '-p', 'Read marker.txt and report its exact content.', '--output-format', format,
        '--permission-mode', 'dontAsk', '--max-tool-rounds', '3'], {
        cwd: workspace, env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home,
          XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'),
          CODEBUDDY_SESSIONS_DIR: sessions, CODEBUDDY_DISABLE_MCP: 'true',
          CODEBUDDY_PROVIDER: 'ollama', OLLAMA_HOST: `http://127.0.0.1:${address.port}`,
          GROK_MODEL: 'fixture-model', LOG_LEVEL: 'error', NODE_ENV: 'development' },
      });
      stop = () => child.kill('SIGKILL');
      child.stdout.resume();
      child.stderr.on('data', chunk => { stderr += chunk; });
      const timer = setTimeout(stop, 40_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', () => { clearTimeout(timer); accept(); });
    });
    expect(sawTool, stderr).toBe(true);
    const files = (await readdir(sessions)).filter(file => /^session_.*\.json$/.test(file));
    expect(files).toHaveLength(1);
    const session = JSON.parse(await readFile(join(sessions, files[0]!), 'utf8'));
    expect(JSON.stringify(session.messages)).toContain('CHECKPOINT_TOOL_OBSERVATION');
    expect(session.messages.some((m: { type: string }) => m.type === 'user')).toBe(true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(accept => server.close(() => accept()));
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
