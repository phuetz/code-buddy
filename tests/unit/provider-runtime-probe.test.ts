import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

import {
  collectRuntimeActiveProviderIds,
  createProviderCommand,
} from '../../src/commands/provider.js';

const ENV_KEYS = [
  'LMSTUDIO_HOST',
  'LM_STUDIO_HOST',
  'LMSTUDIO_BASE_URL',
  'LM_STUDIO_BASE_URL',
  'VLLM_BASE_URL',
  'OLLAMA_HOST',
];

function createModelsServer(): http.Server {
  return http.createServer((req, res) => {
    req.resume();
    if ((req.url ?? '').includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'local-model' }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
}

async function listen(server: http.Server, port: number, host = '127.0.0.1'): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/v1`;
}

async function closeServer(server: http.Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('provider list runtime probes', () => {
  const previousEnv: Record<string, string | undefined> = {};
  let command: Command;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let lmStudioServer: http.Server | undefined;
  let vllmServer: http.Server | undefined;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      previousEnv[key] = process.env[key];
      delete process.env[key];
    }
    command = createProviderCommand();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    await closeServer(lmStudioServer);
    await closeServer(vllmServer);
    lmStudioServer = undefined;
    vllmServer = undefined;
    for (const key of ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });

  it('marks LM Studio active from a local runtime on the default port', async () => {
    lmStudioServer = createModelsServer();
    await listen(lmStudioServer, 1234);

    await command.parseAsync(['list', '--free'], { from: 'user' });
    const output = consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('✅ 🆓 LM Studio');
  });

  it('marks vLLM active when the same OpenAI-compat probe reaches a fake runtime', async () => {
    vllmServer = createModelsServer();
    const vllmUrl = await listen(vllmServer, 0);
    const active = await collectRuntimeActiveProviderIds({ vllmUrl });
    expect(active.has('vllm')).toBe(true);
  });
});
