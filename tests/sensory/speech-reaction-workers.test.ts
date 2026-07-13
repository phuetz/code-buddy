import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerHarness = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  type Response = 'timeout' | 'empty' | 'text';

  class FakeEmitter {
    private readonly listeners = new Map<string, Listener[]>();

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    emit(event: string, ...args: unknown[]): boolean {
      const listeners = this.listeners.get(event) ?? [];
      for (const listener of listeners) listener(...args);
      return listeners.length > 0;
    }
  }

  type FakeReader = FakeEmitter & { close: ReturnType<typeof vi.fn> };
  type FakeStream = FakeEmitter & {
    destroy: ReturnType<typeof vi.fn>;
    reader?: FakeReader;
  };
  type FakeProcess = FakeEmitter & {
    command: string;
    args: string[];
    stdin: FakeStream & { write: ReturnType<typeof vi.fn> };
    stdout: FakeStream;
    stderr: FakeStream;
    kill: ReturnType<typeof vi.fn>;
  };

  const responses: Response[] = [];
  const processes: FakeProcess[] = [];

  const spawn = vi.fn((command: string, args: string[]) => {
    const response = responses.shift() ?? 'empty';
    const stdout = Object.assign(new FakeEmitter(), {
      destroy: vi.fn(),
      reader: undefined as FakeReader | undefined,
    });
    const stderr = Object.assign(new FakeEmitter(), { destroy: vi.fn() });
    const stdin = Object.assign(new FakeEmitter(), {
      destroy: vi.fn(),
      write: vi.fn((payload: string) => {
        if (response === 'timeout') return true;
        const request = JSON.parse(payload) as { id: string };
        queueMicrotask(() => {
          stdout.reader?.emit(
            'line',
            JSON.stringify({ id: request.id, text: response === 'text' ? 'bonjour' : '' })
          );
        });
        return true;
      }),
    });
    const proc = Object.assign(new FakeEmitter(), {
      command,
      args,
      stdin,
      stdout,
      stderr,
      kill: vi.fn(() => true),
    });
    processes.push(proc);
    return proc;
  });

  const createInterface = vi.fn(({ input }: { input: FakeStream }) => {
    const reader = Object.assign(new FakeEmitter(), { close: vi.fn() });
    input.reader = reader;
    queueMicrotask(() => reader.emit('line', JSON.stringify({ ready: true })));
    return reader;
  });

  return {
    createInterface,
    processes,
    queueResponses(...next: Response[]): void {
      responses.push(...next);
    },
    reset(): void {
      responses.length = 0;
      processes.length = 0;
      spawn.mockClear();
      createInterface.mockClear();
    },
    spawn,
  };
});

vi.mock('child_process', () => ({ spawn: workerHarness.spawn }));
vi.mock('readline', () => ({ createInterface: workerHarness.createInterface }));

async function loadSpeechReaction() {
  vi.resetModules();
  return import('../../src/sensory/speech-reaction.js');
}

beforeEach(() => {
  workerHarness.reset();
  vi.stubEnv('CODEBUDDY_SPEECH_WORKER', 'true');
  vi.stubEnv('CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS', '25');
  vi.stubEnv('CODEBUDDY_SPEECH_WORKER_READY_TIMEOUT_MS', '25');
  vi.stubEnv('CODEBUDDY_SPEECH_STT_READY_TIMEOUT_MS', '25');
  vi.stubEnv('CODEBUDDY_SPEECH_FALLBACK', 'false');
  vi.stubEnv('CODEBUDDY_SPEECH_PYTHON', 'fake-python');
  vi.stubEnv('CODEBUDDY_SPEECH_STT_BIN', '/tmp/fake-buddy-sense');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('speech reaction — persistent STT workers', () => {
  it.each([
    ['faster-whisper', 'fake-python'],
    ['parakeet', 'fake-python'],
    ['sherpa-rs', '/tmp/fake-buddy-sense'],
  ] as const)('kills and recreates a timed-out %s worker', async (engine, command) => {
    workerHarness.queueResponses('timeout', 'text');
    const { transcribeWav } = await loadSpeechReaction();
    vi.useFakeTimers();

    const timedOut = transcribeWav('/tmp/first.wav', engine);
    await vi.runAllTimersAsync();

    expect(await timedOut).toBe('');
    expect(workerHarness.processes).toHaveLength(1);
    expect(workerHarness.processes[0]?.kill).toHaveBeenCalledOnce();

    const retried = transcribeWav('/tmp/second.wav', engine);
    await vi.runAllTimersAsync();

    expect(await retried).toBe('bonjour');
    expect(workerHarness.spawn).toHaveBeenCalledTimes(2);
    expect(workerHarness.processes[1]?.command).toBe(command);
  });

  it('does not cascade auto STT when sherpa-rs returns an empty transcript', async () => {
    const modelDir = await mkdtemp(path.join(os.tmpdir(), 'speech-auto-model-'));
    vi.stubEnv('CODEBUDDY_PARAKEET_MODEL_DIR', modelDir);
    vi.stubEnv('CODEBUDDY_SPEECH_FALLBACK', 'true');
    workerHarness.queueResponses('empty');
    const { transcribeWav } = await loadSpeechReaction();

    try {
      await expect(transcribeWav('/tmp/silence.wav', 'auto')).resolves.toBe('');
      expect(workerHarness.spawn).toHaveBeenCalledOnce();
      expect(workerHarness.processes[0]?.command).toBe('/tmp/fake-buddy-sense');
    } finally {
      await rm(modelDir, { recursive: true, force: true });
    }
  });
});
