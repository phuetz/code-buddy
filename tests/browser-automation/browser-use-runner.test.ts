import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'child_process';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the import under test
// ---------------------------------------------------------------------------

const spawnMock = vi.fn();
const spawnSyncMock = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers — a stream-like ChildProcess mock for the local spawn path
// ---------------------------------------------------------------------------

interface MockProc {
  proc: ChildProcess;
  emitStdout: (chunk: string) => void;
  emitStderr: (chunk: string) => void;
  emitClose: (code: number | null) => void;
  emitError: (err: Error) => void;
}

function mockChildProcess(overrides: { pid?: number } = {}): MockProc {
  const stdoutCbs: ((chunk: Buffer) => void)[] = [];
  const stderrCbs: ((chunk: Buffer) => void)[] = [];
  const procCbs = new Map<string, ((...args: unknown[]) => void)[]>();

  const stream = (cbs: ((chunk: Buffer) => void)[]) => ({
    on(event: string, cb: (chunk: Buffer) => void) {
      if (event === 'data') cbs.push(cb);
      return this;
    },
  });

  const proc = {
    pid: overrides.pid ?? 4242,
    stdout: stream(stdoutCbs),
    stderr: stream(stderrCbs),
    unref: vi.fn(),
    kill: vi.fn(),
    on(event: string, cb: (...args: unknown[]) => void) {
      const list = procCbs.get(event) ?? [];
      list.push(cb);
      procCbs.set(event, list);
      return proc;
    },
  } as unknown as ChildProcess;

  return {
    proc,
    emitStdout: (chunk) => stdoutCbs.forEach((cb) => cb(Buffer.from(chunk))),
    emitStderr: (chunk) => stderrCbs.forEach((cb) => cb(Buffer.from(chunk))),
    emitClose: (code) => (procCbs.get('close') ?? []).forEach((cb) => cb(code)),
    emitError: (err) => (procCbs.get('error') ?? []).forEach((cb) => cb(err)),
  };
}

import {
  executeBrowserUseAction,
  parseLocalResult,
} from '../../src/browser-automation/browser-use-runner.js';

const SENTINEL = '__CB_BU_RESULT__';

describe('browser-use-runner', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // Clear relevant env vars to avoid test pollution.
    delete process.env.BROWSER_USE_API_KEY;
    delete process.env.CODEBUDDY_NOUS_TOOL_GATEWAY_URL;
    delete process.env.CODEBUDDY_BROWSER_USE_LOCAL;
    delete process.env.CODEBUDDY_BROWSER_USE_PYTHON;
    delete process.env.CODEBUDDY_BROWSER_USE_MODEL;
    delete process.env.OLLAMA_HOST;
    // Auto-detect probe defaults to "not installed" so configured paths and the
    // no-config error path stay deterministic unless a test opts in.
    spawnSyncMock.mockReturnValue({ status: 1, error: new Error('not found') });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  // -----------------------------------------------------------------------
  // No configuration
  // -----------------------------------------------------------------------

  it('returns an error when neither API key nor gateway is configured (and local is unavailable)', async () => {
    // Auto-detect probe returns "not installed" (default mock), and no local flag.
    const result = await executeBrowserUseAction('click button', 'https://example.com');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/i);
    // The local subprocess must NOT be spawned when browser_use is not importable.
    expect(spawnMock).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Browser Use API (API key)
  // -----------------------------------------------------------------------

  describe('Browser Use API', () => {
    it('sends a request with the API key and returns content', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'Heading: Hello World' }),
      });

      const result = await executeBrowserUseAction(
        'Extract the heading',
        'https://example.com',
        { apiKey: 'test-key-123' },
      );

      expect(result.ok).toBe(true);
      expect(result.content).toBe('Heading: Hello World');

      // Verify the fetch call.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.browser-use.com/api/v1/run-task');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key-123');
    });

    it('reads the API key from env when not explicitly provided', async () => {
      process.env.BROWSER_USE_API_KEY = 'env-key-456';
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ content: 'from env' }),
      });

      const result = await executeBrowserUseAction('do something', 'https://example.com');

      expect(result.ok).toBe(true);
      expect(result.content).toBe('from env');
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer env-key-456');
    });

    it('returns screenshot data when present', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          result: 'Page loaded',
          screenshot: 'iVBORw0KGgo=',
        }),
      });

      const result = await executeBrowserUseAction('take screenshot', 'https://example.com', {
        apiKey: 'key',
      });

      expect(result.ok).toBe(true);
      expect(result.screenshot).toBe('iVBORw0KGgo=');
    });

    it('handles HTTP error responses', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const result = await executeBrowserUseAction('click', 'https://example.com', {
        apiKey: 'bad-key',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/401/);
      expect(result.error).toMatch(/Unauthorized/);
    });

    it('handles network errors', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await executeBrowserUseAction('click', 'https://example.com', {
        apiKey: 'key',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/ECONNREFUSED/);
    });

    it('handles abort/timeout errors', async () => {
      const abortError = new DOMException('The operation was aborted.', 'AbortError');
      fetchMock.mockRejectedValue(abortError);

      const result = await executeBrowserUseAction('click', 'https://example.com', {
        apiKey: 'key',
        timeout: 100,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/timed out/i);
    });
  });

  // -----------------------------------------------------------------------
  // Nous Tool Gateway
  // -----------------------------------------------------------------------

  describe('Nous Tool Gateway', () => {
    it('routes through the gateway when only gateway URL is set', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ output: 'Gateway result' }),
      });

      const result = await executeBrowserUseAction(
        'Navigate and extract',
        'https://example.com',
        { gatewayUrl: 'http://localhost:8080/tools' },
      );

      expect(result.ok).toBe(true);
      expect(result.content).toBe('Gateway result');

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:8080/tools/browser-use');
    });

    it('reads gateway URL from env', async () => {
      process.env.CODEBUDDY_NOUS_TOOL_GATEWAY_URL = 'http://gateway.local:9090/';
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'env gateway' }),
      });

      const result = await executeBrowserUseAction('test', 'https://example.com');

      expect(result.ok).toBe(true);
      expect(result.content).toBe('env gateway');
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      // Trailing slash should be stripped.
      expect(url).toBe('http://gateway.local:9090/browser-use');
    });

    it('prefers API key over gateway URL when both are set', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'api wins' }),
      });

      const result = await executeBrowserUseAction(
        'test',
        'https://example.com',
        { apiKey: 'api-key', gatewayUrl: 'http://gateway.local/' },
      );

      expect(result.ok).toBe(true);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      // Should use the Browser Use API, not the gateway.
      expect(url).toBe('https://api.browser-use.com/api/v1/run-task');
    });

    it('handles gateway HTTP errors', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => 'Bad Gateway',
      });

      const result = await executeBrowserUseAction('click', 'https://example.com', {
        gatewayUrl: 'http://gateway.local/',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/502/);
    });
  });

  // -----------------------------------------------------------------------
  // Response normalisation
  // -----------------------------------------------------------------------

  describe('response normalisation', () => {
    it('prefers "result" over "content" over "output" over "text"', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'R', content: 'C', output: 'O', text: 'T' }),
      });

      const result = await executeBrowserUseAction('test', 'https://example.com', {
        apiKey: 'key',
      });
      expect(result.content).toBe('R');
    });

    it('falls back to JSON.stringify for unknown shapes', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ data: { nested: true } }),
      });

      const result = await executeBrowserUseAction('test', 'https://example.com', {
        apiKey: 'key',
      });
      expect(result.content).toContain('"nested":true');
    });
  });

  // -----------------------------------------------------------------------
  // Local (open-source) browser-use path
  // -----------------------------------------------------------------------

  describe('local browser-use path', () => {
    it('spawns the local entrypoint with task + model and normalises the result', async () => {
      const mock = mockChildProcess();
      spawnMock.mockReturnValue(mock.proc);

      const promise = executeBrowserUseAction('Get the page title', 'https://example.com', {
        local: true,
        pythonPath: '/tmp/bu-venv/bin/python',
        model: 'qwen2.5:7b-instruct',
        ollamaHost: 'http://localhost:11434',
      });

      // browser-use is noisy; the result is a sentinel-wrapped JSON line.
      setImmediate(() => {
        mock.emitStdout('INFO  browser-use step 1: navigate\n');
        mock.emitStdout(`${SENTINEL}{"ok": true, "content": "Example Domain"}\n`);
        mock.emitClose(0);
      });

      const result = await promise;

      expect(result.ok).toBe(true);
      expect(result.content).toBe('Example Domain');

      // Fetch was never used — this is a subprocess, not an HTTP call.
      expect(fetchMock).not.toHaveBeenCalled();

      // Verify the spawn call: python interpreter + inline -c script.
      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];
      expect(cmd).toBe('/tmp/bu-venv/bin/python');
      expect(args[0]).toBe('-c');
      expect(args[1]).toContain('from browser_use import Agent');
      // Task + model + host are passed via the child environment.
      expect(opts.env.CB_BU_TASK).toBe('Get the page title');
      expect(opts.env.CB_BU_URL).toBe('https://example.com');
      expect(opts.env.CB_BU_MODEL).toBe('qwen2.5:7b-instruct');
      expect(opts.env.CB_BU_OLLAMA_HOST).toBe('http://localhost:11434');
    });

    it('auto-detects local when browser_use is importable and nothing else is configured', async () => {
      // Probe reports the package is importable.
      spawnSyncMock.mockReturnValue({ status: 0 });
      const mock = mockChildProcess();
      spawnMock.mockReturnValue(mock.proc);

      const promise = executeBrowserUseAction('do a thing', 'https://example.com');

      setImmediate(() => {
        mock.emitStdout(`${SENTINEL}{"ok": true, "content": "auto detected"}\n`);
        mock.emitClose(0);
      });

      const result = await promise;
      expect(result.ok).toBe(true);
      expect(result.content).toBe('auto detected');
      expect(spawnSyncMock).toHaveBeenCalled();
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('reads the model + ollama host from env', async () => {
      process.env.CODEBUDDY_BROWSER_USE_LOCAL = '1';
      process.env.CODEBUDDY_BROWSER_USE_MODEL = 'devstral-small-2:24b-instruct-2512-q4_K_M';
      process.env.OLLAMA_HOST = 'http://ollama.local:11434';
      const mock = mockChildProcess();
      spawnMock.mockReturnValue(mock.proc);

      const promise = executeBrowserUseAction('task', 'https://example.com');
      setImmediate(() => {
        mock.emitStdout(`${SENTINEL}{"ok": true, "content": "ok"}\n`);
        mock.emitClose(0);
      });
      await promise;

      const [, , opts] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];
      expect(opts.env.CB_BU_MODEL).toBe('devstral-small-2:24b-instruct-2512-q4_K_M');
      expect(opts.env.CB_BU_OLLAMA_HOST).toBe('http://ollama.local:11434');
    });

    it('threads launch knobs (chrome path, no-sandbox, vision, max-steps) into the child env', async () => {
      const mock = mockChildProcess();
      spawnMock.mockReturnValue(mock.proc);

      const promise = executeBrowserUseAction('task', 'https://example.com', {
        local: true,
        chromePath: '/opt/chrome/chrome',
        noSandbox: true,
        useVision: false,
        maxSteps: 4,
      });
      setImmediate(() => {
        mock.emitStdout(`${SENTINEL}{"ok": true, "content": "ok"}\n`);
        mock.emitClose(0);
      });
      await promise;

      const [, args, opts] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];
      // The script builds a BrowserProfile and honours use_vision.
      expect(args[1]).toContain('BrowserProfile');
      expect(args[1]).toContain('use_vision');
      expect(args[1]).toContain('--no-sandbox');
      expect(opts.env.CB_BU_CHROME).toBe('/opt/chrome/chrome');
      expect(opts.env.CB_BU_NO_SANDBOX).toBe('1');
      expect(opts.env.CB_BU_VISION).toBe('0');
      expect(opts.env.CB_BU_MAX_STEPS).toBe('4');
    });

    it('reads launch knobs from env vars', async () => {
      process.env.CODEBUDDY_BROWSER_USE_LOCAL = '1';
      process.env.CODEBUDDY_BROWSER_USE_CHROME = '/env/chrome';
      process.env.CODEBUDDY_BROWSER_USE_NO_SANDBOX = 'true';
      process.env.CODEBUDDY_BROWSER_USE_VISION = 'yes';
      const mock = mockChildProcess();
      spawnMock.mockReturnValue(mock.proc);

      const promise = executeBrowserUseAction('task', 'https://example.com');
      setImmediate(() => {
        mock.emitStdout(`${SENTINEL}{"ok": true, "content": "ok"}\n`);
        mock.emitClose(0);
      });
      await promise;

      const [, , opts] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];
      expect(opts.env.CB_BU_CHROME).toBe('/env/chrome');
      expect(opts.env.CB_BU_NO_SANDBOX).toBe('1');
      expect(opts.env.CB_BU_VISION).toBe('1');
    });

    it('propagates a structured error result from the entrypoint', async () => {
      const mock = mockChildProcess();
      spawnMock.mockReturnValue(mock.proc);

      const promise = executeBrowserUseAction('task', 'https://example.com', { local: true });
      setImmediate(() => {
        mock.emitStdout(`${SENTINEL}{"ok": false, "error": "RuntimeError: model not found"}\n`);
        mock.emitClose(1);
      });

      const result = await promise;
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/model not found/);
    });

    it('reports an actionable error when browser_use is not installed (no sentinel)', async () => {
      const mock = mockChildProcess();
      spawnMock.mockReturnValue(mock.proc);

      const promise = executeBrowserUseAction('task', 'https://example.com', { local: true });
      setImmediate(() => {
        mock.emitStderr("ModuleNotFoundError: No module named 'browser_use'\n");
        mock.emitClose(1);
      });

      const result = await promise;
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/browser_use Python package is not importable/i);
      expect(result.error).toMatch(/pip install browser-use/);
    });

    it('surfaces an Ollama connection failure honestly', async () => {
      const mock = mockChildProcess();
      spawnMock.mockReturnValue(mock.proc);

      const promise = executeBrowserUseAction('task', 'https://example.com', { local: true });
      setImmediate(() => {
        mock.emitStderr('ConnectionError: Failed to connect to localhost:11434\n');
        mock.emitClose(1);
      });

      const result = await promise;
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Ollama/i);
    });

    it('handles a spawn error (interpreter missing)', async () => {
      const mock = mockChildProcess();
      spawnMock.mockReturnValue(mock.proc);

      const promise = executeBrowserUseAction('task', 'https://example.com', { local: true });
      setImmediate(() => {
        mock.emitError(new Error('spawn python3 ENOENT'));
      });

      const result = await promise;
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/ENOENT/);
      expect(result.error).toMatch(/not installed/i);
    });

    it('respects an explicit local:false override even when the env flag is unset', async () => {
      // Probe says importable, but caller forces local off.
      spawnSyncMock.mockReturnValue({ status: 0 });
      const result = await executeBrowserUseAction('task', 'https://example.com', { local: false });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not configured/i);
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('CODEBUDDY_BROWSER_USE_LOCAL=0 disables the local path even if importable', async () => {
      process.env.CODEBUDDY_BROWSER_USE_LOCAL = '0';
      spawnSyncMock.mockReturnValue({ status: 0 });
      const result = await executeBrowserUseAction('task', 'https://example.com');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not configured/i);
      expect(spawnMock).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // parseLocalResult unit
  // -----------------------------------------------------------------------

  describe('parseLocalResult', () => {
    it('pulls the last sentinel JSON line out of noisy stdout', () => {
      const stdout = [
        'INFO  starting agent',
        'INFO  step 1',
        `${SENTINEL}{"ok": true, "content": "final answer"}`,
        'INFO  cleanup',
      ].join('\n');
      const result = parseLocalResult(stdout);
      expect(result).toEqual({ ok: true, content: 'final answer', screenshot: undefined });
    });

    it('returns null when no sentinel line is present', () => {
      expect(parseLocalResult('INFO  nothing useful here\n')).toBeNull();
    });

    it('stringifies non-string content', () => {
      const stdout = `${SENTINEL}{"ok": true, "content": {"title": "X"}}`;
      const result = parseLocalResult(stdout);
      expect(result?.ok).toBe(true);
      expect(result?.content).toContain('"title":"X"');
    });
  });
});
