import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

// Replays C-4B's native length finish after a successful tool, through the
// real CLI. A successful observation must not turn truncation into exit 0.
it.each(['length', 'thinking-stop'] as const)('handles a native %s reply after a tool in the real CLI', async kind => {
  const root = await mkdtemp(join(tmpdir(), 'cb-headless-truncated-'));
  const home = join(root, '_qa/harnais-opus/home');
  const workspace = join(root, 'workspace');
  await mkdir(home, { recursive: true });
  await mkdir(workspace);
  await writeFile(join(workspace, 'marker.txt'), 'UNCHANGED_MARKER');
  let completedTool = false;
  let thinkingOnlyResponses = 0;
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    res.setHeader('content-type', 'application/x-ndjson');
    if (!body.messages) { res.end('{}'); return; }
    completedTool = body.messages.some((message: { role: string; content?: string }) =>
      message.role === 'tool' && message.content?.includes('UNCHANGED_MARKER'));
    const recovered = kind === 'thinking-stop' && completedTool && thinkingOnlyResponses++ > 0;
    res.end(JSON.stringify({
      model: 'qwen3.5:4b',
      message: recovered
        ? { role: 'assistant', content: 'La valeur est UNCHANGED_MARKER.' }
        : completedTool
        ? { role: 'assistant', content: '', thinking: 'Reasoning without an answer.' }
        : { role: 'assistant', content: '', tool_calls: [{ function: {
          name: 'view_file', arguments: { path: join(workspace, 'marker.txt') },
        } }] },
      done: true, done_reason: completedTool && kind === 'length' ? 'length' : 'stop',
      prompt_eval_count: 100, eval_count: completedTool ? 8192 : 20,
    }) + '\n');
  });
  try {
    await new Promise<void>((accept, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', accept);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((accept, reject) => {
      const child = spawn(process.execPath, ['--import', resolve('node_modules/tsx/dist/loader.mjs'),
        resolve('src/index.ts'), '-p', 'Lis marker.txt et explique sa valeur.',
        '--permission-mode', 'dontAsk', '--max-tool-rounds', '3', '--output-format', 'json'], {
        cwd: workspace,
        env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, NO_COLOR: '1',
          CODEBUDDY_PROVIDER: 'ollama', OLLAMA_HOST: `http://127.0.0.1:${address.port}`,
          GROK_MODEL: 'qwen3.5:4b', CODEBUDDY_MAX_CONTEXT: '32768',
          CODEBUDDY_MAX_LENGTH_CONTINUATIONS: '0', CODEBUDDY_DISABLE_MCP: 'true',
          CODEBUDDY_SESSION_END_FLUSH: 'false', LOG_LEVEL: 'error' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 40_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); accept({ code, stdout, stderr }); });
    });
    expect(completedTool, result.stderr).toBe(true);
    expect(result.code, result.stderr).toBe(kind === 'length' ? 1 : 0);
    expect(JSON.parse(result.stdout)).toMatchObject(kind === 'length'
      ? { status: 'failed', success: false, exitCode: 1, reasons: ['response_truncated'] }
      : { status: 'success', success: true, exitCode: 0, result: 'La valeur est UNCHANGED_MARKER.' });
    if (kind === 'thinking-stop') expect(thinkingOnlyResponses).toBe(2);
    expect(await readFile(join(workspace, 'marker.txt'), 'utf8')).toBe('UNCHANGED_MARKER');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(accept => server.close(() => accept()));
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
