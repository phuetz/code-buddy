import { EventEmitter } from 'events';
import type { spawn } from 'child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../src/utils/logger.js';
import {
  buildArgvToolOutputArgs,
  classifyToolOutputHelp,
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

/** `lm-resizer tool-output --help` of the published 0.2.4 binary (argv form). */
const HELP_ARGV =
  'Usage: lm-resizer tool-output [OPTIONS] --command <COMMAND>\n      --command <COMMAND>  Command that produced the supplied text\n      --json  Emit JSON\n';
/** Older binaries that read a JSON request on stdin. */
const HELP_REQUEST_JSON =
  'Usage: lm-resizer tool-output [OPTIONS]\n      --request-json  Read a JSON request from stdin\n      --json  Emit JSON\n';

function fakeSpawn(
  responder: (call: FakeSpawnCall) => FakeSpawnResponse,
  help: string = HELP_REQUEST_JSON,
): {
  spawnImpl: typeof spawn;
  probes: FakeSpawnCall[];
  calls: FakeSpawnCall[];
  kills: ReturnType<typeof vi.fn>[];
} {
  const calls: FakeSpawnCall[] = [];
  const probes: FakeSpawnCall[] = [];
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
      const isProbe = args.includes('--help');
      (isProbe ? probes : calls).push(call);
      const response = isProbe ? { stdout: help } : responder(call);
      queueMicrotask(() => {
        if (response.stdout) child.stdout.write(response.stdout);
        if (response.stderr) child.stderr.write(response.stderr);
        if (!response.neverClose) child.emit('close', response.code ?? 0);
      });
    });
    return child;
  }) as unknown as typeof spawn;
  return { spawnImpl, probes, calls, kills };
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

  it('uses the stdin-only tool-output CLI fallback with workspace cwd and filtered env', async () => {
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
    expect(call.args).toEqual(expect.arrayContaining(['tool-output', '--request-json', '--json']));
    expect(call.args.join(' ')).not.toContain(query);
    expect(call.args.join(' ')).not.toContain('npm test -- --runInBand');
    expect(call.options.cwd).toBe('/tmp/workspace');
    expect((call.options.env as NodeJS.ProcessEnv).OPENAI_API_KEY).toBeUndefined();
    expect(JSON.parse(call.stdin)).toMatchObject({
      query,
      command: 'npm test -- --runInBand',
      workspace_root: '/tmp/workspace',
      token_budget: 512,
    });
  });

  /** Verbatim shape rendered by lm-resizer 0.2.4 (`tool-output --json`), output shortened. */
  const REPORT_024 = JSON.stringify({
    tokenizer: 'tiktoken-rs/o200k_base',
    token_count_method: 'exact',
    original_tokens: 539987,
    compressed_tokens: 34,
    tokens_saved: 539953,
    command: 'journalctl -u x',
    exit_code: 0,
    filter: 'journalctl',
    original_bytes: 1359978,
    filtered_bytes: 78,
    compressed_bytes: 97,
    bytes_saved: 1359881,
    compression_steps: [],
    cache_keys: ['363823ea1a6dfbf6b35e4865'],
    tee_hint: '[raw: f563cbacfa8a]',
    output: 'ERROR: connexion refusee vers db-7 (code 111)\n19999 INFO lines; raw: tee list\n[tee:f563cbacfa8a]\n',
  });

  it('drives lm-resizer 0.2.4 through argv + stdin, without --request-json, probing once', async () => {
    const content = 'noisy\n'.repeat(2_000);
    const query = 'private user query that must not enter argv';
    const runtime = fakeSpawn(() => ({ stdout: REPORT_024 }), HELP_ARGV);
    const options = { httpUrl: null, bin: '/fake/lm-resizer', spawnImpl: runtime.spawnImpl, storePath: '/tmp/s.db' };

    const first = await optimizeToolOutputWithLmResizer({
      content, toolName: 'bash', command: 'journalctl -u x', query, exitCode: 0,
    }, options);
    await optimizeToolOutputWithLmResizer({ content, toolName: 'bash', command: 'journalctl -u x' }, options);

    expect(runtime.probes).toHaveLength(1);
    expect(runtime.calls).toHaveLength(2);
    const call = runtime.calls[0]!;
    expect(call.args).toEqual([
      'tool-output', '--command=journalctl -u x', '--exit-code=0', '--json', '--store', '/tmp/s.db',
    ]);
    expect(call.args).not.toContain('--request-json');
    expect(call.args.join(' ')).not.toContain(query);
    expect(call.stdin).toBe(content);
    expect(first).toMatchObject({
      transport: 'cli',
      accepted: true,
      hash: '363823ea1a6dfbf6b35e4865',
      filter: 'journalctl',
      originalBytes: 1359978,
      compressedBytes: 97,
      bytesSaved: 1359881,
    });
    expect(first?.compressed).toContain('ERROR: connexion refusee');
  });

  it('keeps the legacy --request-json form when the binary advertises it', async () => {
    const content = 'noisy\n'.repeat(2_000);
    const runtime = fakeSpawn(() => ({ stdout: toolReport(content) }), HELP_REQUEST_JSON);
    await optimizeToolOutputWithLmResizer({ content, toolName: 'bash' }, {
      httpUrl: null, bin: '/fake/lm-resizer', spawnImpl: runtime.spawnImpl,
    });
    expect(runtime.calls[0]!.args).toContain('--request-json');
  });

  it('applies the savings floor itself when 0.2.4 reports no `accepted`', async () => {
    const content = 'x'.repeat(1_000);
    const small = JSON.stringify({ original_bytes: 1000, compressed_bytes: 990, bytes_saved: 10, output: 'y'.repeat(990) });
    const runtime = fakeSpawn(() => ({ stdout: small }), HELP_ARGV);
    const result = await optimizeToolOutputWithLmResizer({
      content, toolName: 'bash', command: 'make', minSavingsBytes: 100,
    }, { httpUrl: null, bin: '/fake/lm-resizer', spawnImpl: runtime.spawnImpl });
    expect(result?.accepted).toBe(false);
  });

  it('builds a safe argv: option-looking command, NUL bytes, failed command with raw-on-failure', () => {
    const args = buildArgvToolOutputArgs({
      content: 'x', tool_name: 'bash', command: '--help\0 now', query: 'q', exit_code: 2,
      raw_on_failure: true, min_savings_bytes: 1, min_savings_ratio: 0,
    }, '/s.db');
    expect(args).toContain('--command=--help now');
    expect(args).toContain('--exit-code=2');
    expect(args).toContain('--raw-on-failure');
  });

  it('classifies the tool-output help text', () => {
    expect(classifyToolOutputHelp(HELP_ARGV)).toBe('argv');
    expect(classifyToolOutputHelp(HELP_REQUEST_JSON)).toBe('request-json');
    expect(classifyToolOutputHelp('Usage: lm-resizer tool-output\n')).toBe('unsupported');
  });

  it('warns once, then stays at debug level, when the CLI fails (no silent failure)', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const runtime = fakeSpawn(() => ({ code: 2, stderr: 'error: unexpected argument\n' }), HELP_ARGV);
    const options = {
      httpUrl: null, bin: '/fake/lm-resizer', spawnImpl: runtime.spawnImpl, circuitFailureThreshold: 99,
    };
    const content = 'noise\n'.repeat(1_000);
    expect(await optimizeToolOutputWithLmResizer({ content, toolName: 'bash' }, options)).toBeNull();
    expect(await optimizeToolOutputWithLmResizer({ content, toolName: 'bash' }, options)).toBeNull();
    const failures = warn.mock.calls.filter(([m]) => String(m).includes('tool-output-cli failed'));
    expect(failures).toHaveLength(1);
    expect(String(failures[0]![0])).toContain('exit 2');
    expect(String(failures[0]![0])).toContain('unexpected argument');
  });

  it('reports an incompatible binary once and never runs the request', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const runtime = fakeSpawn(() => ({ stdout: REPORT_024 }), 'Usage: lm-resizer tool-output\n');
    const options = { httpUrl: null, bin: '/fake/lm-resizer', spawnImpl: runtime.spawnImpl };
    const content = 'noise\n'.repeat(1_000);
    expect(await optimizeToolOutputWithLmResizer({ content, toolName: 'bash' }, options)).toBeNull();
    expect(await optimizeToolOutputWithLmResizer({ content, toolName: 'bash' }, options)).toBeNull();
    expect(runtime.calls).toHaveLength(0);
    expect(runtime.probes).toHaveLength(1);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('supports neither'))).toHaveLength(1);
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
    expect(runtime.calls).toHaveLength(1);
    expect(runtime.kills.at(-1)).toHaveBeenCalledWith('SIGTERM');
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
    expect(runtime.kills.at(-1)).toHaveBeenCalledWith('SIGTERM');
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
      expect(runtime.kills.at(-1)).toHaveBeenCalledWith('SIGTERM');
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
