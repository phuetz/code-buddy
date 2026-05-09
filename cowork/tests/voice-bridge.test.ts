/**
 * Voice bridge protocol — sanity-checks the JSON-line dispatcher between
 * Cowork main and the faster-whisper Python worker.
 *
 * We don't spawn a real Python process here (the venv lives outside the
 * test fixtures and adds 800 ms of model boot per test). Instead we
 * stub `child_process.spawn` with a manual transport that forwards
 * stdin lines to a fake JSON responder.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
  },
}));

class FakeChildProcess extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  killed = false;
  private _stdoutPush: (chunk: string) => void = () => undefined;
  private _stdinHandler: (line: string) => void = () => undefined;

  constructor() {
    super();
    const self = this;
    this.stdin = new Writable({
      write(chunk, _enc, cb) {
        const text = chunk.toString();
        for (const line of text.split('\n').filter(Boolean)) {
          self._stdinHandler(line);
        }
        cb();
      },
    });
    this.stdout = new Readable({ read() {} });
    this._stdoutPush = (chunk: string) => {
      this.stdout.push(chunk);
    };
    this.stderr = new Readable({ read() {} });
  }

  /** Test helper — what the worker emitted. */
  emitStdout(line: string) {
    this._stdoutPush(line + '\n');
  }

  setStdinHandler(handler: (line: string) => void) {
    this._stdinHandler = handler;
  }

  kill() {
    this.killed = true;
  }
}

let lastSpawned: FakeChildProcess | null = null;

vi.mock('node:child_process', () => ({
  spawn: () => {
    const fake = new FakeChildProcess();
    lastSpawned = fake;
    return fake;
  },
}));

vi.mock('node:fs/promises', async () => {
  const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...real,
    mkdtemp: vi.fn(async () => '/tmp/cowork-voice-test'),
    writeFile: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
  };
});

vi.mock('node:fs', async () => {
  const real = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...real,
    existsSync: vi.fn(() => true),
  };
});

import { VoiceBridge } from '../src/main/voice/voice-bridge';

describe('VoiceBridge protocol', () => {
  beforeEach(() => {
    lastSpawned = null;
  });

  it('signals readiness on `boot:ok` and resolves a transcription request', async () => {
    const bridge = new VoiceBridge();
    const sentLines: string[] = [];
    // Kick off a transcribe; this triggers spawn + boot wait.
    const transcribePromise = bridge.transcribe(Buffer.from('fake audio'), {
      language: 'fr',
    });

    // Wait one tick for spawn() and the boot promise to settle.
    await new Promise((r) => setImmediate(r));
    expect(lastSpawned).not.toBeNull();
    lastSpawned!.setStdinHandler((line) => sentLines.push(line));
    lastSpawned!.emitStdout(JSON.stringify({ id: 'boot', ok: true, model: 'base', device: 'cpu' }));

    // Allow the boot promise to drain + the request to be sent.
    await new Promise((r) => setImmediate(r));
    expect(sentLines).toHaveLength(1);
    const parsed = JSON.parse(sentLines[0]) as Record<string, unknown>;
    expect(parsed).toMatchObject({ language: 'fr' });
    expect(typeof parsed.id).toBe('string');

    // Worker replies.
    lastSpawned!.emitStdout(
      JSON.stringify({ id: parsed.id, ok: true, text: 'bonjour le monde', duration: 0.5 })
    );

    const result = await transcribePromise;
    expect(result.text).toBe('bonjour le monde');
    expect(result.durationMs).toBe(500);
  });

  it('rejects a transcription when the worker reports ok=false', async () => {
    const bridge = new VoiceBridge();
    const promise = bridge.transcribe(Buffer.from('x'));

    await new Promise((r) => setImmediate(r));
    let sent: string | null = null;
    lastSpawned!.setStdinHandler((line) => {
      sent = line;
    });
    lastSpawned!.emitStdout(JSON.stringify({ id: 'boot', ok: true }));
    await new Promise((r) => setImmediate(r));
    const id = (JSON.parse(sent!) as Record<string, unknown>).id as string;
    lastSpawned!.emitStdout(
      JSON.stringify({ id, ok: false, error: 'whisper barfed on silence' })
    );

    await expect(promise).rejects.toThrow(/whisper barfed/);
  });

  it('rejects all pending requests if the worker exits unexpectedly', async () => {
    const bridge = new VoiceBridge();
    const a = bridge.transcribe(Buffer.from('a'));
    await new Promise((r) => setImmediate(r));
    lastSpawned!.emitStdout(JSON.stringify({ id: 'boot', ok: true }));
    await new Promise((r) => setImmediate(r));

    lastSpawned!.emit('exit', 137);
    await expect(a).rejects.toThrow(/exited/);
  });

  it('rejects boot with a clear error when the worker cannot load the model', async () => {
    const bridge = new VoiceBridge();
    const promise = bridge.transcribe(Buffer.from('x'));
    await new Promise((r) => setImmediate(r));
    lastSpawned!.emitStdout(
      JSON.stringify({ id: 'boot', ok: false, error: 'model load failed: no GPU' })
    );
    await expect(promise).rejects.toThrow(/model load failed/);
  });
});
