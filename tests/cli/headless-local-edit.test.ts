import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('headless local editing without permission recipes', () => {
  it.each([undefined, 'default', 'plan', 'plan-empty'] as const)('respects the %s posture through the real CLI', async posture => {
    const mode = posture === 'plan-empty' ? 'plan' : posture;
    const emptyAfterDenial = posture === 'plan-empty';
    const root = await mkdtemp(join(tmpdir(), 'headless-local-edit-'));
    const home = join(root, 'home');
    const workspace = join(root, 'workspace');
    await mkdir(home);
    await mkdir(workspace);
    const file = join(workspace, 'value.mjs');
    await writeFile(file, 'export const value = 0;\n');
    const toolResults: string[] = [];
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'fixture-model' }] }));
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as {
        messages?: Array<{ role: string; content?: string }>;
        stream?: boolean;
      };
      const results = body.messages?.filter(message => message.role === 'tool') ?? [];
      toolResults.push(...results.map(message => message.content ?? ''));
      const completion = {
        id: 'fixture-completion', object: 'chat.completion', model: 'fixture-model',
        choices: [{ index: 0, finish_reason: results.length ? 'stop' : 'tool_calls',
          message: results.length ? { role: 'assistant', content: emptyAfterDenial ? '' : 'Finished.' } : {
            role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'edit-1', type: 'function',
              function: { name: 'str_replace_editor', arguments: JSON.stringify({
                command: 'str_replace', path: 'value.mjs',
                old_str: 'value = 0', new_str: 'value = 1',
              }) } }],
          } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      };
      if (req.url === '/api/chat') {
        const message = completion.choices[0]!.message;
        const nativeMessage = { ...message, content: message.content ?? '',
          ...('tool_calls' in message ? { tool_calls: message.tool_calls?.map(call => ({
            function: { name: call.function.name, arguments: JSON.parse(call.function.arguments) },
          })) } : {}),
        };
        res.end(JSON.stringify({ model: 'fixture-model', message: nativeMessage, done: true,
          done_reason: 'stop', prompt_eval_count: 10, eval_count: 10 }) + '\n');
      } else if (body.stream) {
        res.setHeader('content-type', 'text/event-stream');
        const choice = completion.choices[0]!;
        res.end(`data: ${JSON.stringify({ ...completion, choices: [{ index: 0,
          delta: choice.message, finish_reason: choice.finish_reason }] })}\n\ndata: [DONE]\n\n`);
      } else res.end(JSON.stringify(completion));
    });
    try {
      await new Promise<void>((accept, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', accept);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No listening port');
      const env = { ...process.env,
        HOME: home, USERPROFILE: home, CODEBUDDY_HOME: join(home, '.codebuddy'),
        CODEBUDDY_PROVIDER: 'ollama', OLLAMA_HOST: `http://127.0.0.1:${address.port}`,
        GROK_MODEL: 'fixture-model', CODEBUDDY_LEARNING_BACKGROUND_REVIEW: 'false',
        CODEBUDDY_TELEMETRY: 'false', LOG_LEVEL: 'error', NODE_ENV: 'production',
      };
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((accept, reject) => {
        const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'),
          resolve('src/index.ts'), '-p', 'Change value.mjs from 0 to 1.',
          '--model', 'fixture-model', '--output-format', 'json', '--ephemeral',
          '--max-tool-rounds', '2', ...(mode ? ['--permission-mode', mode] : []),
        ], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let stdout = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => { clearTimeout(timer); accept({ code, stdout, stderr }); });
      });
      expect(result.code, result.stderr).toBe(mode ? 1 : 0);
      expect(JSON.parse(result.stdout)).toMatchObject({ success: !mode, status: emptyAfterDenial ? 'failed' : mode ? 'unverified' : 'success', exitCode: mode ? 1 : 0 });
      if (emptyAfterDenial) expect(result.stderr).toMatch(/empty|vide/i);
      expect(await readFile(file, 'utf8')).toBe(`export const value = ${mode ? 0 : 1};\n`);
      if (!mode) expect(toolResults.join('\n')).not.toMatch(/User cancelled|Permission denied/);
    } finally {
      await new Promise<void>(accept => server.close(() => accept()));
      await rm(root, { recursive: true, force: true });
    }
  }, 45_000);
});
