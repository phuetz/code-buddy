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
  killed: string[] = [];
  kill(signal?: string): boolean {
    this.killed.push(signal ?? 'SIGTERM');
    return true;
  }
}

function makeBridge(overrides: Partial<ConstructorParameters<typeof LiveLauncherBridge>[0]> = {}) {
  const events: LiveLauncherEventPayload[] = [];
  const child = new FakeChild();
  const spawnCalls: Array<{ file: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const bridge = new LiveLauncherBridge({
    send: (event) => events.push(event.payload),
    spawnImpl: ((file: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
      spawnCalls.push({ file, args, env: options.env });
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

  it('builds flow args with verbose + retries and no report path', () => {
    const flow = buildLiveLauncherArgs({ kind: 'flow', prompt: 'fix the bug', maxRetries: 2 }, 'f1', '/tmp/reports');
    expect(flow.args).toEqual(['flow', 'fix the bug', '--model', 'qwen2.5:7b-instruct', '--verbose', '--max-retries', '2']);
    expect(flow.reportPath).toBeUndefined();
  });
});

describe('buildLiveLauncherEnv', () => {
  it('pins local Ollama by default and inherits otherwise', () => {
    const ollama = buildLiveLauncherEnv({ kind: 'flow', prompt: 'x' }, { electronAsNode: true }, {});
    expect(ollama.CODEBUDDY_PROVIDER).toBe('ollama');
    expect(ollama.OLLAMA_HOST).toBe('http://localhost:11434');
    expect(ollama.ELECTRON_RUN_AS_NODE).toBe('1');

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
    expect(second.error).toContain('already in progress');
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

  it('the hard timeout terminates a stuck run as failed', async () => {
    const { bridge, child } = makeBridge();
    const started = bridge.start({ kind: 'flow', prompt: 'goal', timeoutMs: 1_000 });

    vi.advanceTimersByTime(1_000 + 30_000 + 1);
    expect(child.killed).toContain('SIGTERM');

    child.emit('close', null);
    await vi.waitFor(() => expect(bridge.status(started.runId!)?.status).toBe('failed'));
    expect(bridge.status(started.runId!)?.error).toContain('Timed out');
  });
});
