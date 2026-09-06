/**
 * LiveLauncherBridge — runs `buddy research` / `buddy flow` as a child
 * process: args/env construction, line streaming, success/failure/cancel/
 * timeout lifecycles, single-active-run rule.
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule, resolveCoreEntry } from '../src/main/utils/core-loader';
import {
  LiveLauncherBridge,
  buildLiveLauncherArgs,
  buildLiveLauncherEnv,
} from '../src/main/launcher/live-launcher-bridge';
import type { LiveLauncherEventPayload } from '../src/shared/live-launcher-types';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(),
  resolveCoreEntry: vi.fn(),
}));

vi.mock('../src/main/ipc-main-bridge', () => ({
  sendToRenderer: vi.fn(),
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

const mockedResolveCoreEntry = vi.mocked(resolveCoreEntry);
vi.mocked(loadCoreModule).mockResolvedValue(null);

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid: number | undefined;
  killed: string[] = [];
  kill(signal?: string): boolean {
    this.killed.push(signal ?? 'SIGTERM');
    return true;
  }
}

function makeBridge(overrides: Partial<ConstructorParameters<typeof LiveLauncherBridge>[0]> = {}) {
  const events: LiveLauncherEventPayload[] = [];
  const child = new FakeChild();
  const spawnCalls: Array<{
    file: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    shell?: boolean;
    windowsHide?: boolean;
    detached?: boolean;
  }> = [];
  const bridge = new LiveLauncherBridge({
    send: (event) => events.push(event.payload),
    spawnImpl: ((
      file: string,
      args: string[],
      options: {
        env: NodeJS.ProcessEnv;
        shell?: boolean;
        windowsHide?: boolean;
        detached?: boolean;
      }
    ) => {
      spawnCalls.push({
        file,
        args,
        env: options.env,
        shell: options.shell,
        windowsHide: options.windowsHide,
        detached: options.detached,
      });
      return child as never;
    }) as never,
    reportDir: '/tmp/reports',
    readReport: vi.fn().mockResolvedValue('# Rapport\n\ncontenu'),
    ...overrides,
  });
  return { bridge, child, events, spawnCalls };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockedResolveCoreEntry.mockReturnValue('/repo/dist/index.js');
});

afterEach(() => {
  vi.useRealTimers();
  mockedResolveCoreEntry.mockReset();
});

describe('buildLiveLauncherArgs', () => {
  it('builds research args with report path, model, timeout — wide only on demand', () => {
    const direct = buildLiveLauncherArgs(
      { kind: 'research', prompt: ' topic ', model: 'qwen3.6:27b' },
      'r1',
      '/tmp/reports',
    );
    expect(direct.args).toEqual([
      'research', 'topic', '--model', 'qwen3.6:27b', '--timeout-ms', '300000', '--report', '/tmp/reports/cowork-r1.md',
    ]);
    expect(direct.reportPath).toBe('/tmp/reports/cowork-r1.md');

    const wide = buildLiveLauncherArgs(
      { kind: 'research', prompt: 'topic', wide: true, workers: 8, timeoutMs: 60_000 },
      'r2',
      '/tmp/reports',
    );
    expect(wide.args).toEqual(
      expect.arrayContaining(['--wide', '--workers', '8', '--timeout-ms', '60000']),
    );
  });

  it('builds deep research args with --deep + optional iterations/perspectives, never --wide', () => {
    const deep = buildLiveLauncherArgs(
      { kind: 'research', prompt: 'topic', deep: true, iterations: 2, perspectives: 4 },
      'r3',
      '/tmp/reports',
    );
    expect(deep.args).toEqual(
      expect.arrayContaining([
        '--timeout-ms',
        '1800000',
        '--deep',
        '--iterations',
        '2',
        '--perspectives',
        '4',
      ]),
    );
    expect(deep.args).not.toContain('--wide');
    expect(deep.reportPath).toBe('/tmp/reports/cowork-r3.md');

    // deep takes precedence over wide (the CLI's --deep short-circuits --wide).
    const both = buildLiveLauncherArgs(
      { kind: 'research', prompt: 'topic', deep: true, wide: true },
      'r4',
      '/tmp/reports',
    );
    expect(both.args).toContain('--deep');
    expect(both.args).not.toContain('--wide');

    // A bare --deep (iterations 1 / perspectives 0) omits the optional flags.
    const bare = buildLiveLauncherArgs(
      { kind: 'research', prompt: 'topic', deep: true, iterations: 1, perspectives: 0 },
      'r5',
      '/tmp/reports',
    );
    expect(bare.args).toContain('--deep');
    expect(bare.args).not.toContain('--iterations');
    expect(bare.args).not.toContain('--perspectives');

    // perspectives is clamped into [2,6].
    const clamped = buildLiveLauncherArgs(
      { kind: 'research', prompt: 'topic', deep: true, perspectives: 99 },
      'r6',
      '/tmp/reports',
    );
    expect(clamped.args).toEqual(expect.arrayContaining(['--perspectives', '6']));
  });

  it('builds flow args with verbose + retries and no report path', () => {
    const flow = buildLiveLauncherArgs({ kind: 'flow', prompt: 'fix the bug', maxRetries: 2 }, 'f1', '/tmp/reports');
    expect(flow.args).toEqual(['flow', 'fix the bug', '--model', 'qwen2.5:7b-instruct', '--verbose', '--max-retries', '2']);
    expect(flow.reportPath).toBeUndefined();
  });
});

describe('buildLiveLauncherEnv', () => {
  it('pins Ollama by default, preserves a configured remote host, and inherits otherwise', () => {
    const ollama = buildLiveLauncherEnv({ kind: 'flow', prompt: 'x' }, { electronAsNode: true }, {});
    expect(ollama.CODEBUDDY_PROVIDER).toBe('ollama');
    expect(ollama.OLLAMA_HOST).toBe('http://localhost:11434');
    expect(ollama.ELECTRON_RUN_AS_NODE).toBe('1');

    const gpuNode = buildLiveLauncherEnv(
      { kind: 'research', prompt: 'x' },
      { electronAsNode: false },
      { OLLAMA_HOST: 'http://gpuNode:11434' },
    );
    expect(gpuNode.OLLAMA_HOST).toBe('http://gpuNode:11434');

    const explicit = buildLiveLauncherEnv(
      { kind: 'research', prompt: 'x', ollamaUrl: 'http://gpu-peer:11434/v1/' },
      { electronAsNode: false },
      { OLLAMA_HOST: 'http://gpuNode:11434' },
    );
    expect(explicit.OLLAMA_HOST).toBe('http://gpu-peer:11434');

    const inherit = buildLiveLauncherEnv(
      { kind: 'flow', prompt: 'x', provider: 'inherit' },
      { electronAsNode: false },
      { GROK_API_KEY: 'k' },
    );
    expect(inherit.CODEBUDDY_PROVIDER).toBeUndefined();
    expect(inherit.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(inherit.GROK_API_KEY).toBe('k');
  });
});

describe('LiveLauncherBridge lifecycle', () => {
  it('fails honestly without a built CLI, an empty prompt, or a concurrent run', () => {
    mockedResolveCoreEntry.mockReturnValue(null);
    const { bridge } = makeBridge();
    expect(bridge.start({ kind: 'research', prompt: 'x' }).error).toContain('npm run build');

    mockedResolveCoreEntry.mockReturnValue('/repo/dist/index.js');
    expect(bridge.start({ kind: 'research', prompt: '  ' }).error).toContain('topic');

    const first = bridge.start({ kind: 'research', prompt: 'topic' });
    expect(first.ok).toBe(true);
    const second = bridge.start({ kind: 'flow', prompt: 'goal' });
    expect(second.ok).toBe(false);
    expect(second.error).toContain('still active');
  });

  it('rejects malformed renderer input and always spawns without a shell', () => {
    const { bridge, spawnCalls } = makeBridge();
    expect(
      bridge.start({ kind: 'research', prompt: 'x'.repeat(50_001) }).error
    ).toContain('character limit');
    expect(
      bridge.start({
        kind: 'research',
        prompt: 'topic',
        provider: 'unexpected' as 'ollama',
      }).error
    ).toContain('provider');
    expect(
      bridge.start({ kind: 'research', prompt: 'topic', provider: 'inherit' }).error
    ).toContain('cost acknowledgement');
    expect(
      bridge.start({ kind: 'research', prompt: 'topic', timeoutMs: Number.POSITIVE_INFINITY })
        .error
    ).toContain('finite');

    expect(bridge.start({ kind: 'research', prompt: 'safe topic' }).ok).toBe(true);
    expect(spawnCalls[0]).toMatchObject({ detached: true, shell: false, windowsHide: true });
  });

  it('kills the POSIX process group created for the launcher', () => {
    const killProcessImpl = vi.fn().mockReturnValue(true);
    const { bridge, child } = makeBridge({
      platform: 'linux',
      killProcessImpl: killProcessImpl as never,
    });
    child.pid = 4_242;
    const started = bridge.start({ kind: 'research', prompt: 'topic' });

    expect(bridge.cancel(started.runId!).ok).toBe(true);
    expect(killProcessImpl).toHaveBeenCalledWith(-4_242, 'SIGTERM');
  });

  it('uses taskkill /T /F for the complete launcher tree on Windows', () => {
    const spawnSyncImpl = vi.fn().mockReturnValue({ status: 0 });
    const { bridge, child, spawnCalls } = makeBridge({
      platform: 'win32',
      spawnSyncImpl: spawnSyncImpl as never,
    });
    child.pid = 7_733;
    const started = bridge.start({ kind: 'flow', prompt: 'goal' });

    expect(bridge.cancel(started.runId!).ok).toBe(true);
    expect(spawnCalls[0]?.detached).toBe(false);
    expect(spawnSyncImpl).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '7733', '/t', '/f'],
      expect.objectContaining({ shell: false, windowsHide: true })
    );
  });

  it('streams stdout line-by-line with partial-line buffering', () => {
    const { bridge, child, events } = makeBridge();
    bridge.start({ kind: 'flow', prompt: 'goal' });

    child.stdout.emit('data', Buffer.from('ligne 1\nlig'));
    child.stdout.emit('data', Buffer.from('ne 2\n'));

    const logEvents = events.filter((e) => e.kind === 'log');
    expect(logEvents).toHaveLength(2);
    expect(logEvents[0]).toMatchObject({ kind: 'log', stream: 'stdout', lines: ['ligne 1'] });
    expect(logEvents[1]).toMatchObject({ kind: 'log', stream: 'stdout', lines: ['ligne 2'] });
  });

  it('bounds a single unterminated output line', () => {
    const { bridge, child, events } = makeBridge();
    bridge.start({ kind: 'flow', prompt: 'goal' });

    child.stdout.emit('data', Buffer.from('x'.repeat(20_000)));

    const logEvent = events.find((event) => event.kind === 'log');
    expect(logEvent && logEvent.kind === 'log' && logEvent.lines[0]?.length).toBeLessThan(17_000);
    expect(logEvent && logEvent.kind === 'log' && logEvent.lines[0]).toContain('line truncated');
  });

  it('caps the total retained log size per run', () => {
    const { bridge, child } = makeBridge();
    const started = bridge.start({ kind: 'flow', prompt: 'goal' });
    child.stdout.emit('data', Buffer.from(`${'x'.repeat(1_000)}\n`.repeat(1_200)));

    const retained = bridge.status(started.runId!)?.logTail.join('') ?? '';
    expect(retained.length).toBeLessThanOrEqual(1_000_000);
  });

  it('succeeds on exit 0 — research reads the report artifact', async () => {
    const readReport = vi.fn().mockResolvedValue('# Rapport final');
    const { bridge, child, events } = makeBridge({ readReport });
    const started = bridge.start({ kind: 'research', prompt: 'topic' });

    child.stdout.emit('data', Buffer.from('working...\n'));
    child.emit('close', 0);
    await vi.waitFor(() => {
      const status = events.filter((e) => e.kind === 'status').pop();
      expect(status && status.kind === 'status' && status.run.status).toBe('succeeded');
    });

    expect(readReport).toHaveBeenCalledWith('/tmp/reports/cowork-' + started.runId + '.md');
    const run = bridge.status(started.runId!);
    expect(run?.result).toBe('# Rapport final');
    expect(run?.exitCode).toBe(0);
    expect(bridge.list()[0]).toMatchObject({ logTail: [], hasResult: true, logLineCount: 1 });
    expect(bridge.list()[0]?.result).toBeUndefined();
  });

  it('flow success uses the accumulated stdout as the result', async () => {
    const { bridge, child } = makeBridge();
    const started = bridge.start({ kind: 'flow', prompt: 'goal' });

    child.stdout.emit('data', Buffer.from('Plan: 2 steps\nDone: step 1\nrésultat final\n'));
    child.emit('close', 0);
    await vi.waitFor(() => expect(bridge.status(started.runId!)?.status).toBe('succeeded'));

    expect(bridge.status(started.runId!)?.result).toContain('résultat final');
  });

  it('fails with the stderr tail on a non-zero exit', async () => {
    const { bridge, child } = makeBridge();
    const started = bridge.start({ kind: 'flow', prompt: 'goal' });

    child.stderr.emit('data', Buffer.from('Error: no provider available\n'));
    child.emit('close', 1);
    await vi.waitFor(() => expect(bridge.status(started.runId!)?.status).toBe('failed'));

    expect(bridge.status(started.runId!)?.error).toContain('exited with code 1');
  });

  it('cancel SIGTERMs the child and settles as cancelled', async () => {
    const { bridge, child } = makeBridge();
    const started = bridge.start({ kind: 'research', prompt: 'topic' });

    const cancelled = bridge.cancel(started.runId!);
    expect(cancelled.ok).toBe(true);
    expect(child.killed).toContain('SIGTERM');

    child.emit('close', null);
    await vi.waitFor(() => expect(bridge.status(started.runId!)?.status).toBe('cancelled'));
    expect(bridge.cancel('ll_ghost').ok).toBe(false);
  });

  it('does not start a replacement until the cancelled child has actually closed', async () => {
    const { bridge, child } = makeBridge();
    const started = bridge.start({ kind: 'research', prompt: 'first' });

    expect(bridge.cancel(started.runId!).ok).toBe(true);
    expect(bridge.start({ kind: 'flow', prompt: 'too early' }).error).toContain('still active');

    child.emit('close', null);
    await vi.waitFor(() => expect(bridge.status(started.runId!)?.status).toBe('cancelled'));
    expect(bridge.start({ kind: 'flow', prompt: 'now safe' }).ok).toBe(true);
  });

  it('the hard timeout terminates a stuck run as failed', async () => {
    const { bridge, child } = makeBridge();
    const started = bridge.start({ kind: 'flow', prompt: 'goal', timeoutMs: 1_000 });

    vi.advanceTimersByTime(1_000 + 30_000 + 1);
    expect(child.killed).toContain('SIGTERM');

    child.emit('close', null);
    await vi.waitFor(() => expect(bridge.status(started.runId!)?.status).toBe('failed'));
    expect(bridge.status(started.runId!)?.error).toContain('Timed out');
  });

  it('force-kills the active launcher child during Cowork shutdown', () => {
    const { bridge, child } = makeBridge();
    const started = bridge.start({ kind: 'flow', prompt: 'goal' });

    bridge.shutdown();

    expect(child.killed).toContain('SIGKILL');
    expect(bridge.status(started.runId!)?.status).toBe('cancelled');
    expect(bridge.cancel(started.runId!).ok).toBe(false);
    expect(bridge.start({ kind: 'research', prompt: 'too late' }).error).toContain('shutting down');
  });

  it('rejects launches after shutdown even when no run was active', () => {
    const { bridge } = makeBridge();
    bridge.shutdown();
    expect(bridge.start({ kind: 'flow', prompt: 'too late' }).ok).toBe(false);
  });
});
