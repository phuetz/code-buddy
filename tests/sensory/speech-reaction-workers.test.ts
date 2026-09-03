import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workerHarness = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  type Response = 'timeout' | 'empty' | 'text' | 'error' | 'one-shot-error';

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
            response === 'error'
              ? JSON.stringify({ id: request.id, error: 'decoder unavailable' })
              : JSON.stringify({ id: request.id, text: response === 'text' ? 'bonjour' : '' }),
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
    if (response === 'one-shot-error') {
      queueMicrotask(() => {
        stderr.emit('data', 'decoder unavailable');
        proc.emit('close', 1);
      });
    }
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
  vi.stubEnv('BUDDY_SENSE_STT_MODEL_DIR', undefined);
  vi.stubEnv('CODEBUDDY_PARAKEET_MODEL_DIR', undefined);
  vi.stubEnv('CODEBUDDY_SHERPA_ONNX_MODEL_DIR', undefined);
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
    const timedOutAssertion = expect(timedOut).rejects.toThrow('timed out');
    await vi.runAllTimersAsync();

    await timedOutAssertion;
    expect(workerHarness.processes).toHaveLength(1);
    expect(workerHarness.processes[0]?.kill).toHaveBeenCalledOnce();

    const retried = transcribeWav('/tmp/second.wav', engine);
    await vi.runAllTimersAsync();

    expect(await retried).toBe('bonjour');
    expect(workerHarness.spawn).toHaveBeenCalledTimes(2);
    expect(workerHarness.processes[1]?.command).toBe(command);
  });

  it('rejects a worker error instead of returning an empty transcript', async () => {
    workerHarness.queueResponses('error');
    const { transcribeWav } = await loadSpeechReaction();

    await expect(transcribeWav('/tmp/failed.wav', 'faster-whisper'))
      .rejects.toThrow('decoder unavailable');
  });

  it('rejects a non-zero one-shot STT process instead of returning its empty stdout', async () => {
    vi.stubEnv('CODEBUDDY_SPEECH_WORKER', 'false');
    workerHarness.queueResponses('one-shot-error');
    const { transcribeWav } = await loadSpeechReaction();

    await expect(transcribeWav('/tmp/failed-one-shot.wav', 'faster-whisper'))
      .rejects.toThrow('faster-whisper STT failed');
  });

  it('routes an explicit French pin away from auto-detect-only Parakeet and propagates hotwords', async () => {
    vi.stubEnv('CODEBUDDY_SPEECH_ENGINE', 'parakeet');
    vi.stubEnv('CODEBUDDY_SPEECH_LANG', 'fr');
    vi.stubEnv('CODEBUDDY_SPEECH_FALLBACK', 'true');
    vi.stubEnv('CODEBUDDY_SPEECH_HOTWORDS', 'Lisa');
    workerHarness.queueResponses('text');
    const { transcribeWav } = await loadSpeechReaction();

    await expect(transcribeWav('/tmp/lisa-fr.wav')).resolves.toBe('bonjour');

    const workerScript = workerHarness.processes[0]?.args.join('\n') ?? '';
    expect(workerScript).toContain('from faster_whisper import WhisperModel');
    expect(workerScript).toContain('"language": "fr"');
    expect(workerScript).toContain('"hotwords": "Lisa');
    expect(workerScript).not.toContain('import sherpa_onnx');
  });

  it('does not choose sherpa-rs for an incomplete auto model directory', async () => {
    const modelDir = await mkdtemp(path.join(process.cwd(), '.conv4-test-auto-model-'));
    vi.stubEnv('CODEBUDDY_SPEECH_STT_BIN', process.execPath);
    vi.stubEnv('CODEBUDDY_PARAKEET_MODEL_DIR', modelDir);
    vi.stubEnv('CODEBUDDY_SPEECH_FALLBACK', 'true');
    workerHarness.queueResponses('text');
    const { transcribeWav } = await loadSpeechReaction();

    try {
      await expect(transcribeWav('/tmp/silence.wav', 'auto')).resolves.toBe('bonjour');
      expect(workerHarness.spawn).toHaveBeenCalledOnce();
      expect(workerHarness.processes[0]?.command).toBe('fake-python');
      expect(workerHarness.processes[0]?.args.join('\n')).toContain('from faster_whisper import WhisperModel');
    } finally {
      await rm(modelDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('logs an auto fallback caused by a missing Rust/model pair only once per process', async () => {
    const modelDir = await mkdtemp(path.join(process.cwd(), '.conv4-test-auto-missing-'));
    vi.stubEnv('CODEBUDDY_SPEECH_STT_BIN', process.execPath);
    vi.stubEnv('CODEBUDDY_PARAKEET_MODEL_DIR', modelDir);
    vi.stubEnv('CODEBUDDY_SPEECH_FALLBACK', 'true');
    workerHarness.queueResponses('text', 'text');
    const { transcribeWav } = await loadSpeechReaction();
    const loadedLogger = (await import('../../src/utils/logger.js')).logger;
    const warn = vi.spyOn(loadedLogger, 'warn').mockImplementation(() => {});

    try {
      await expect(transcribeWav('/tmp/first.wav', 'auto')).resolves.toBe('bonjour');
      await expect(transcribeWav('/tmp/second.wav', 'auto')).resolves.toBe('bonjour');
      const autoFallbacks = warn.mock.calls.filter(([message]) =>
        String(message).includes('auto STT fallback activated'),
      );
      expect(autoFallbacks).toHaveLength(1);
    } finally {
      warn.mockRestore();
      await rm(modelDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
