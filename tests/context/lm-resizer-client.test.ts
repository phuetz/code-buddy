import { EventEmitter } from 'events';
import type { spawn } from 'child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLmResizerSubprocessEnv,
  optimizeToolOutputWithLmResizer,
  resetLmResizerCircuitBreakers,
} from '../../src/context/lm-resizer-compressor.js';

interface FakeSpawnCall {
  command: string;
  args: string[];
  options: Record<string, unknown>;
  stdin: string;
}

interface FakeSpawnResponse {
  stdout?: string;
  stderr?: string;
  code?: number;
  neverClose?: boolean;
}

function toolReport(original: string, output = 'short result'): string {
  const originalBytes = Buffer.byteLength(original);
  const compressedBytes = Buffer.byteLength(output);
  return JSON.stringify({
    tool_name: 'bash',
    command: 'npm test',
    workspace_root: '/tmp/workspace',
    exit_code: 0,
    filter: 'test',
    original_bytes: originalBytes,
    filtered_bytes: compressedBytes,
    compressed_bytes: compressedBytes,
    bytes_saved: originalBytes - compressedBytes,
    savings_ratio: (originalBytes - compressedBytes) / originalBytes,
    candidate_bytes: compressedBytes,
    candidate_delta_bytes: compressedBytes - originalBytes,
    compression_steps: ['test-filter'],
    cache_keys: ['ccr-hash'],
    recovery_hash: 'ccr-hash',
    accepted: true,
    rejection_reason: null,
    output,
  });
}

function fakeSpawn(
  responder: (call: FakeSpawnCall) => FakeSpawnResponse,
): {
  spawnImpl: typeof spawn;
  calls: FakeSpawnCall[];
  kills: ReturnType<typeof vi.fn>[];
} {
  const calls: FakeSpawnCall[] = [];
  const kills: ReturnType<typeof vi.fn>[] = [];
  const spawnImpl = vi.fn((command: string, args: readonly string[], options: Record<string, unknown>) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => true);
    kills.push(child.kill);
    let stdin = '';
    child.stdin.on('data', (chunk) => {
      stdin += chunk.toString();
    });
    child.stdin.on('end', () => {
      const call = { command, args: [...args], options, stdin };
      calls.push(call);
      const response = responder(call);
      queueMicrotask(() => {
        if (response.stdout) {
          const stdout = response.stdout.startsWith('{') && !response.stdout.includes('"jsonrpc"')
            ? JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n'
              + JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: response.stdout }] } }) + '\n'
            : response.stdout;
          child.stdout.write(stdout);
        }
        if (response.stderr) child.stderr.write(response.stderr);
        if (!response.neverClose) child.emit('close', response.code ?? 0);
      });
    });
    return child;
  }) as unknown as typeof spawn;
  return { spawnImpl, calls, kills };
}

describe('robust lm-resizer client', () => {
  const originalTokenFile = process.env.CODEBUDDY_LM_RESIZER_TOKEN_FILE;
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    resetLmResizerCircuitBreakers();
  });

  afterEach(() => {
    if (originalTokenFile === undefined) delete process.env.CODEBUDDY_LM_RESIZER_TOKEN_FILE;
    else process.env.CODEBUDDY_LM_RESIZER_TOKEN_FILE = originalTokenFile;
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    vi.restoreAllMocks();
  });

  it('uses the published 0.2.4 MCP contract and the last CCR key for the exact original', async () => {
    const content = 'verbose test output\n'.repeat(2_000);
    const runtime = fakeSpawn((call) => {
      if (call.args[0] !== 'mcp') return { code: 2, stderr: 'unexpected --request-json' };
      const messages = call.stdin.trim().split('\n').map((line) => JSON.parse(line));
      expect(messages.map((message) => message.method)).toEqual([
        'initialize', 'notifications/initialized', 'tools/call',
      ]);
      expect(messages[2].params).toEqual({
        name: 'lm_resizer_tool_output',
        arguments: { content, command: 'npm test', query: 'private query', exit_code: 0, raw_on_failure: false },
      });
      const report = JSON.parse(toolReport(content));
      delete report.recovery_hash;
      delete report.accepted;
      report.cache_keys = ['filtered-intermediate', 'exact-original'];
      return { stdout: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n'
        + JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify(report) }] } }) + '\n' };
    });
    const result = await optimizeToolOutputWithLmResizer({ content, command: 'npm test', query: 'private query' }, {
      httpUrl: null, bin: '/fake/lm-resizer', spawnImpl: runtime.spawnImpl,
    });
    expect(result?.compressed).toBe('short result');
    expect(result?.hash).toBe('exact-original');
    expect(runtime.calls).toHaveLength(1);
    expect(runtime.calls[0]!.args).toEqual(['mcp', '--store', expect.any(String)]);
    expect(runtime.calls[0]!.args.join(' ')).not.toMatch(/npm test|private query|verbose/);
  });

  it('uses the stdin-only MCP fallback with workspace cwd and filtered env', async () => {
    const content = 'noisy\n'.repeat(2_000);
    const query = 'private user query that must not enter argv';
    process.env.OPENAI_API_KEY = 'sk-super-secret';
    const runtime = fakeSpawn(() => ({ stdout: toolReport(content) }));

    const result = await optimizeToolOutputWithLmResizer({
      content,
      toolName: 'bash',
      command: 'npm test -- --runInBand',
      workspaceRoot: '/tmp/workspace',
      query,
      tokenBudget: 512,
    }, {
      httpUrl: null,
      bin: '/fake/lm-resizer',
      spawnImpl: runtime.spawnImpl,
    });

    expect(result?.transport).toBe('cli');
    expect(runtime.calls).toHaveLength(1);
    const call = runtime.calls[0]!;
    expect(call.args).toEqual(['mcp', '--store', expect.any(String)]);
    expect(call.args.join(' ')).not.toContain(query);
    expect(call.args.join(' ')).not.toContain('npm test -- --runInBand');
    expect(call.options.cwd).toBe('/tmp/workspace');
    expect((call.options.env as NodeJS.ProcessEnv).OPENAI_API_KEY).toBeUndefined();
    expect(JSON.parse(call.stdin.trim().split('\n')[2]!).params.arguments).toMatchObject({
      query,
      command: 'npm test -- --runInBand',
      content,
      exit_code: 0,
      raw_on_failure: false,
    });
  });

  it.each([
    { jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'unknown tool' } },
    { jsonrpc: '2.0', id: 2, result: { isError: true, content: [{ type: 'text', text: 'error' }] } },
    { jsonrpc: '2.0', id: 99, result: { content: [{ type: 'text', text: '{}' }] } },
  ])('keeps the host fallback on an unsuccessful MCP response: %j', async (response) => {
    const runtime = fakeSpawn(() => ({ stdout:
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n' + JSON.stringify(response) + '\n',
    }));
    expect(await optimizeToolOutputWithLmResizer({ content: 'raw'.repeat(1_000) }, {
      httpUrl: null, bin: '/fake/lm-resizer', spawnImpl: runtime.spawnImpl,
    })).toBeNull();
  });

  it('enforces minimum savings locally because the 0.2.4 MCP tool has no such parameters', async () => {
    const content = 'x'.repeat(100);
    const runtime = fakeSpawn(() => ({ stdout: toolReport(content, 'x'.repeat(90)) }));
    const result = await optimizeToolOutputWithLmResizer({ content, minSavingsBytes: 20 }, {
      httpUrl: null, bin: '/fake/lm-resizer', spawnImpl: runtime.spawnImpl,
    });
    expect(result?.accepted).toBe(false);
  });

  it('sends failure preservation over MCP and never accepts a shortened failed output', async () => {
    const content = 'error: failure diagnostic\n'.repeat(100);
    const runtime = fakeSpawn((call) => {
      const args = JSON.parse(call.stdin.trim().split('\n')[2]!).params.arguments;
      expect(args).toMatchObject({ exit_code: 7, raw_on_failure: true });
      return { stdout: toolReport(content, 'shortened diagnostic') };
    });
    const result = await optimizeToolOutputWithLmResizer({ content, exitCode: 7 }, {
      httpUrl: null, bin: '/fake/lm-resizer', spawnImpl: runtime.spawnImpl,
    });
    expect(result?.accepted).toBe(false);
  });

  it('discovers tool-output-v1 and reads the sidecar token from a private file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lmr-token-'));
    const tokenFile = join(dir, 'server-token');
    writeFileSync(tokenFile, 'private-sidecar-token\n', { mode: 0o600 });
    chmodSync(tokenFile, 0o600);
    process.env.CODEBUDDY_LM_RESIZER_TOKEN_FILE = tokenFile;
    const content = 'line\n'.repeat(2_000);
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-lm-resizer-token']).toBe('private-sidecar-token');
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({
          ok: true,
          capabilities: ['compress-v1', 'tool-output-v1'],
        }), { status: 200 });
      }
      expect(url.endsWith('/tool-output')).toBe(true);
      expect(url).not.toContain('private query');
      expect(JSON.parse(String(init?.body))).toMatchObject({ query: 'private query' });
      return new Response(toolReport(content), { status: 200 });
    }) as typeof fetch;

    try {
      const result = await optimizeToolOutputWithLmResizer({
        content,
        toolName: 'bash',
        query: 'private query',
      }, {
        httpUrl: 'http://127.0.0.1:8787',
        fetchImpl,
      });

      expect(result?.transport).toBe('http');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('opens the HTTP circuit and continues through CLI after a failed capability probe', async () => {
    const content = 'noise\n'.repeat(1_000);
    const fetchImpl = vi.fn(async () => new Response('down', { status: 503 })) as typeof fetch;
    const runtime = fakeSpawn(() => ({ stdout: toolReport(content) }));
    const options = {
      httpUrl: 'http://127.0.0.1:8787',
      fetchImpl,
      bin: '/fake/lm-resizer',
      spawnImpl: runtime.spawnImpl,
      circuitFailureThreshold: 1,
    };

    const first = await optimizeToolOutputWithLmResizer({ content, toolName: 'bash' }, options);
    const second = await optimizeToolOutputWithLmResizer({ content, toolName: 'bash' }, options);

    expect(first?.transport).toBe('cli');
    expect(second?.transport).toBe('cli');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(runtime.calls).toHaveLength(2);
  });

  it('bounds CLI stdout and terminates an overflowing subprocess', async () => {
    const runtime = fakeSpawn(() => ({ stdout: 'x'.repeat(512) }));
    const result = await optimizeToolOutputWithLmResizer({
      content: 'raw'.repeat(1_000),
      toolName: 'bash',
    }, {
      httpUrl: null,
      bin: '/fake/lm-resizer',
      spawnImpl: runtime.spawnImpl,
      maxStdoutBytes: 64,
    });

    expect(result).toBeNull();
    expect(runtime.kills[0]).toHaveBeenCalledWith('SIGTERM');
  });

  it('honours AbortSignal and terminates an in-flight CLI request', async () => {
    const runtime = fakeSpawn(() => ({ neverClose: true }));
    const controller = new AbortController();
    const pending = optimizeToolOutputWithLmResizer({
      content: 'raw'.repeat(1_000),
      toolName: 'bash',
    }, {
      httpUrl: null,
      bin: '/fake/lm-resizer',
      spawnImpl: runtime.spawnImpl,
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(pending).resolves.toBeNull();
    expect(runtime.kills[0]).toHaveBeenCalledWith('SIGTERM');
  });

  it('times out and terminates an unresponsive CLI request', async () => {
    vi.useFakeTimers();
    try {
      const runtime = fakeSpawn(() => ({ neverClose: true }));
      const pending = optimizeToolOutputWithLmResizer({
        content: 'raw'.repeat(1_000),
        toolName: 'bash',
      }, {
        httpUrl: null,
        bin: '/fake/lm-resizer',
        spawnImpl: runtime.spawnImpl,
        timeoutMs: 25,
      });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(26);

      await expect(pending).resolves.toBeNull();
      expect(runtime.kills[0]).toHaveBeenCalledWith('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not perform implicit HTTP or CLI IO under NODE_ENV=test', async () => {
    const previousFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const result = await optimizeToolOutputWithLmResizer({
        content: 'raw observation',
        toolName: 'bash',
      });
      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('keeps credential-shaped variables out of the subprocess environment', () => {
    const env = buildLmResizerSubprocessEnv({
      PATH: '/usr/bin',
      HOME: '/home/test',
      LANG: 'fr_FR.UTF-8',
      OPENAI_API_KEY: 'secret',
      CODEBUDDY_LM_RESIZER_SERVER_TOKEN: 'secret',
      DATABASE_URL: 'postgres://secret',
    });
    expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/home/test', LANG: 'fr_FR.UTF-8' });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CODEBUDDY_LM_RESIZER_SERVER_TOKEN).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });
});
