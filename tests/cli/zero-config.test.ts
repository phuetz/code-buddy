/**
 * Zero-config detection against a real loopback HTTP server that speaks the
 * Ollama `/api/tags` shape (no mock of fetch), plus the tailored guidance.
 */
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RECOMMENDED_LOCAL_MODEL,
  buildNoProviderGuidance,
  detectZeroConfigLocal,
  formatZeroConfigChoice,
  isZeroConfigDisabled,
  ollamaInstallCommand,
} from '../../src/cli/zero-config.js';
import { NO_PROVIDER_GUIDANCE } from '../../src/cli/first-run.js';

const GiB = 1024 ** 3;
const PLENTY = 64 * GiB;

let server: Server | undefined;
const savedHost = process.env.OLLAMA_HOST;

async function fakeOllama(models: Array<{ name: string; size?: number }>): Promise<string> {
  server = createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

beforeEach(() => {
  delete process.env.OLLAMA_HOST;
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  if (savedHost === undefined) delete process.env.OLLAMA_HOST;
  else process.env.OLLAMA_HOST = savedHost;
});

describe('detectZeroConfigLocal (fake Ollama over HTTP)', () => {
  it('picks the tool-capable model and skips a chat-only one', async () => {
    process.env.OLLAMA_HOST = await fakeOllama([
      { name: 'qwen2.5-coder:7b', size: 4.7 * GiB },
      { name: 'nomic-embed-text:latest', size: 0.3 * GiB },
      { name: 'qwen3:8b', size: 5.2 * GiB },
    ]);
    const decision = await detectZeroConfigLocal({ freeMemoryBytes: () => PLENTY });
    expect(decision.kind).toBe('ollama');
    if (decision.kind !== 'ollama') return;
    expect(decision.model).toBe('qwen3:8b');
    expect(decision.baseURL).toBe(`${process.env.OLLAMA_HOST}/v1`);
    expect(decision.reason).toContain('tool-calling');
  });

  it('reports no-tool-model when only chat-only models are installed', async () => {
    process.env.OLLAMA_HOST = await fakeOllama([{ name: 'qwen2.5-coder:7b', size: 4.7 * GiB }]);
    const decision = await detectZeroConfigLocal({ freeMemoryBytes: () => PLENTY });
    expect(decision).toMatchObject({ kind: 'none', ollama: 'no-tool-model' });
    const guidance = buildNoProviderGuidance(decision, 'linux');
    expect(guidance).toContain(`ollama pull ${RECOMMENDED_LOCAL_MODEL}`);
    expect(guidance).not.toContain('install.sh'); // Ollama is already there
    expect(guidance).not.toContain('export ');
  });

  it('reports no-models on an empty Ollama', async () => {
    process.env.OLLAMA_HOST = await fakeOllama([]);
    const decision = await detectZeroConfigLocal({ freeMemoryBytes: () => PLENTY });
    expect(decision).toMatchObject({ kind: 'none', ollama: 'no-models' });
  });

  it('refuses a tool model that does not fit in free RAM (fail-closed)', async () => {
    process.env.OLLAMA_HOST = await fakeOllama([{ name: 'qwen3:8b', size: 5.2 * GiB }]);
    const decision = await detectZeroConfigLocal({ freeMemoryBytes: () => 2 * GiB });
    expect(decision).toMatchObject({ kind: 'none', ollama: 'no-tool-model' });
  });

  it('reports not-running when nothing answers, with the install command', async () => {
    // Bind then close a port so nothing listens there.
    const url = await fakeOllama([]);
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    process.env.OLLAMA_HOST = url;
    const decision = await detectZeroConfigLocal({ freeMemoryBytes: () => PLENTY });
    expect(decision).toMatchObject({ kind: 'none', ollama: 'not-running' });
    const guidance = buildNoProviderGuidance(decision, 'linux');
    expect(guidance).toContain('curl -fsSL https://ollama.com/install.sh | sh');
    expect(guidance).toContain(`ollama pull ${RECOMMENDED_LOCAL_MODEL}`);
  });

  it('never throws when the probe itself throws', async () => {
    const decision = await detectZeroConfigLocal({
      probeOllama: async () => {
        throw new Error('boom');
      },
    });
    expect(decision).toMatchObject({ kind: 'none', ollama: 'not-running' });
  });
});

describe('zero-config messages', () => {
  it('says what was chosen and why, and how to opt out', () => {
    const text = formatZeroConfigChoice({
      kind: 'ollama',
      baseURL: 'http://localhost:11434/v1',
      model: 'qwen3:8b',
      reason: 'tool-calling, 5.2 GiB < 30.0 GiB free RAM',
    });
    expect(text).toContain('http://localhost:11434');
    expect(text).toContain('qwen3:8b (tool-calling');
    expect(text).toContain('No environment variable needed');
    expect(text).toContain('CODEBUDDY_ZERO_CONFIG=false');
  });

  it('credits --model when the user named one', () => {
    const text = formatZeroConfigChoice(
      { kind: 'ollama', baseURL: 'http://localhost:11434/v1', model: 'qwen3:8b', reason: 'x' },
      'devstral-small-2',
    );
    expect(text).toContain('devstral-small-2 (model given with --model)');
  });

  it('gives a platform-specific Ollama install command', () => {
    expect(ollamaInstallCommand('win32')).toBe('winget install Ollama.Ollama');
    expect(ollamaInstallCommand('darwin')).toContain('brew install ollama');
    expect(ollamaInstallCommand('linux')).toContain('install.sh');
  });

  it('keeps login first and no longer asks for an export', () => {
    expect(NO_PROVIDER_GUIDANCE.indexOf('buddy login')).toBeLessThan(NO_PROVIDER_GUIDANCE.indexOf('ollama pull'));
    expect(NO_PROVIDER_GUIDANCE).not.toContain('export OLLAMA_HOST');
    expect(NO_PROVIDER_GUIDANCE).toContain('buddy --profile local|cloud|fleet|max');
  });

  it('can be turned off', () => {
    expect(isZeroConfigDisabled({ CODEBUDDY_ZERO_CONFIG: 'false' })).toBe(true);
    expect(isZeroConfigDisabled({ CODEBUDDY_ZERO_CONFIG: 'off' })).toBe(true);
    expect(isZeroConfigDisabled({})).toBe(false);
    expect(isZeroConfigDisabled({ CODEBUDDY_ZERO_CONFIG: 'true' })).toBe(false);
  });
});
