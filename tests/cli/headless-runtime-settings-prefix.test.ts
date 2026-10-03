import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

type Message = { role: string; content?: string | null };

it('keeps the observed CLI settings in the native prompt prefix across completed tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-runtime-prefix-'));
  const home = join(root, '_qa/harnais-opus/home');
  await mkdir(home, { recursive: true });
  const files = ['one.txt', 'two.txt'].map(file => join(root, file));
  await writeFile(files[0]!, 'ONE_MARKER');
  await writeFile(files[1]!, 'TWO_MARKER');
  const requests: Array<{ messages: Message[] }> = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    res.setHeader('content-type', 'application/x-ndjson');
    if (!body.messages) { res.end('{}'); return; }
    requests.push(body);
    const index = requests.length - 1;
    res.end(JSON.stringify({ model: 'qwen3.5:4b', message: index < 2
      ? { role: 'assistant', content: '', tool_calls: [{ function: {
        name: 'view_file', arguments: { path: files[index] },
      } }] }
      : { role: 'assistant', content: 'ONE_MARKER, TWO_MARKER.' },
      done: true, done_reason: 'stop', prompt_eval_count: 100, eval_count: 20,
    }) + '\n');
  });
  try {
    await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((accept, reject) => {
      const child = spawn(process.execPath, ['--import', resolve('node_modules/tsx/dist/loader.mjs'),
        resolve('src/index.ts'), '-p', 'Lis one.txt et two.txt, puis explique leurs valeurs.',
        '--permission-mode', 'dontAsk', '--max-tool-rounds', '4', '--output-format', 'json'], {
        cwd: root, env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, NO_COLOR: '1',
          CODEBUDDY_PROVIDER: 'ollama', OLLAMA_HOST: `http://127.0.0.1:${address.port}`,
          GROK_MODEL: 'qwen3.5:4b', CODEBUDDY_MAX_CONTEXT: '32768',
          CODEBUDDY_DISABLE_MCP: 'true', CODEBUDDY_SESSION_END_FLUSH: 'false', LOG_LEVEL: 'error' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 40_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); accept({ code, stdout, stderr }); });
    });
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ success: true, result: 'ONE_MARKER, TWO_MARKER.' });
    expect(requests).toHaveLength(3);
    // Initial workspace discovery is independently ephemeral. Compare the
    // subsequent requests after both completed observations, as in A-27B.
    for (let index = 2; index < requests.length; index++) {
      const previous = requests[index - 1]!.messages;
      expect(requests[index]!.messages.slice(0, previous.length)).toEqual(previous);
    }
    expect(requests[2]!.messages.filter(message => message.content?.includes('<runtime_settings'))).toHaveLength(1);
    expect(await readFile(files[0]!, 'utf8')).toBe('ONE_MARKER');
    expect(await readFile(files[1]!, 'utf8')).toBe('TWO_MARKER');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(accept => server.close(() => accept()));
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
