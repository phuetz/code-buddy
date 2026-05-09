/**
 * VoiceBridge — Cowork microphone-to-text via faster-whisper.
 *
 * Spawns a long-running Python worker process that loads the Whisper
 * model once at startup. Each `transcribe()` call writes one JSON line
 * to the worker's stdin and resolves with the matching response from
 * stdout. Worker boot is lazy — it doesn't pay the 800 ms model-load
 * cost until the user clicks the mic button.
 *
 * @module main/voice/voice-bridge
 */
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, logError, logWarn } from '../utils/logger';

interface PendingTranscription {
  resolve: (result: { text: string; durationMs: number }) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

interface WorkerResponse {
  id: string;
  ok: boolean;
  text?: string;
  duration?: number;
  error?: string;
  model?: string;
  device?: string;
}

const DEFAULT_VENV = '/home/patrice/DEV/ai-stack/voice/.venv';
const WORKER_SCRIPT_BUNDLED = 'transcribe-worker.py';

/**
 * Resolve the path of `transcribe-worker.py` regardless of whether
 * Cowork is running in dev (loose ts files) or packaged (bundled main).
 * In dev, the file lives next to this module's source in
 * `cowork/src/main/voice/`. In production, the build step copies it
 * next to the compiled main bundle.
 */
function resolveWorkerScript(): string {
  // Production (post-`vite build`): dist-electron/main/transcribe-worker.py
  // Dev / source layout: cowork/src/main/voice/transcribe-worker.py
  if (process.env.COWORK_VOICE_WORKER && existsSync(process.env.COWORK_VOICE_WORKER)) {
    return process.env.COWORK_VOICE_WORKER;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, WORKER_SCRIPT_BUNDLED),
    path.join(here, 'voice', WORKER_SCRIPT_BUNDLED),
    path.resolve(here, '../voice', WORKER_SCRIPT_BUNDLED),
    path.resolve(here, '../../src/main/voice', WORKER_SCRIPT_BUNDLED),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export class VoiceBridge {
  private worker: ChildProcessWithoutNullStreams | null = null;
  private bootPromise: Promise<void> | null = null;
  private bootError: string | null = null;
  private pending = new Map<string, PendingTranscription>();
  private bootResolve: (() => void) | null = null;
  private bootReject: ((err: Error) => void) | null = null;
  private stdoutBuffer = '';
  private nextId = 0;

  /** True when the worker process is alive and the model has loaded. */
  isReady(): boolean {
    return this.worker !== null && this.bootError === null;
  }

  /** Last-known boot error (e.g. faster-whisper missing, venv broken). */
  getBootError(): string | null {
    return this.bootError;
  }

  /**
   * Transcribe a webm/wav/opus audio buffer. Writes the audio to a temp
   * file (faster-whisper reads from disk) then forwards the path to the
   * Python worker.
   */
  async transcribe(
    audioBuffer: Buffer,
    options: { language?: string; timeoutMs?: number } = {}
  ): Promise<{ text: string; durationMs: number }> {
    await this.ensureWorker();
    if (!this.worker || this.bootError) {
      throw new Error(this.bootError ?? 'voice worker unavailable');
    }
    const timeoutMs = options.timeoutMs ?? 60000;

    // Write audio to a temp file. We pick `.webm` because the browser's
    // default MediaRecorder produces opus-in-webm, and faster-whisper
    // (via av/ffmpeg) reads it natively.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cowork-voice-'));
    const audioPath = path.join(tmpDir, 'clip.webm');
    await fs.writeFile(audioPath, audioBuffer);

    const id = `req_${++this.nextId}_${Date.now()}`;
    const payload = JSON.stringify({
      id,
      path: audioPath,
      language: options.language ?? null,
    });

    const result = await new Promise<{ text: string; durationMs: number }>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`transcription timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve,
        reject: (err) => {
          clearTimeout(timeoutHandle);
          reject(err);
        },
        timeoutHandle,
      });
      this.worker!.stdin.write(payload + '\n');
    }).finally(() => {
      // Best-effort cleanup; ignore errors so a failed unlink doesn't
      // mask a transcription error.
      void fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    });

    return result;
  }

  /** Stop the worker. Called on app quit. */
  shutdown(): void {
    if (this.worker) {
      try {
        this.worker.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      this.worker = null;
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(new Error('voice bridge shutting down'));
    }
    this.pending.clear();
  }

  // ─────────── Internals ───────────

  private async ensureWorker(): Promise<void> {
    if (this.worker && !this.bootError) return;
    if (this.bootPromise) return this.bootPromise;

    this.bootPromise = new Promise<void>((resolve, reject) => {
      this.bootResolve = resolve;
      this.bootReject = reject;
      try {
        const venv = process.env.COWORK_VOICE_VENV ?? DEFAULT_VENV;
        const python = path.join(venv, 'bin', 'python');
        const script = resolveWorkerScript();
        log(`[VoiceBridge] spawning worker ${python} ${script}`);
        this.worker = spawn(python, ['-u', script], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            // Default to the FR-friendly base model on CPU/int8. Patrice
            // can tune via env vars.
            COWORK_WHISPER_MODEL: process.env.COWORK_WHISPER_MODEL ?? 'base',
            COWORK_WHISPER_COMPUTE: process.env.COWORK_WHISPER_COMPUTE ?? 'int8',
            COWORK_WHISPER_DEVICE: process.env.COWORK_WHISPER_DEVICE ?? 'cpu',
          },
        });
        this.worker.stdout.on('data', (chunk) => this.handleStdout(chunk));
        this.worker.stderr.on('data', (chunk) => {
          // Whisper logs noisy progress on stderr — only surface real errors.
          const msg = chunk.toString().trim();
          if (msg) logWarn('[VoiceBridge:stderr]', msg);
        });
        this.worker.on('exit', (code) => {
          logWarn(`[VoiceBridge] worker exited (code ${code ?? '?'})`);
          this.worker = null;
          for (const pending of this.pending.values()) {
            clearTimeout(pending.timeoutHandle);
            pending.reject(new Error('voice worker exited unexpectedly'));
          }
          this.pending.clear();
        });
        this.worker.on('error', (err) => {
          this.bootError = err.message;
          this.bootReject?.(err);
          this.bootReject = null;
          this.bootResolve = null;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.bootError = message;
        reject(new Error(message));
      }
    }).finally(() => {
      this.bootPromise = null;
    });

    return this.bootPromise;
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString();
    let newlineIdx;
    while ((newlineIdx = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
      if (!line) continue;
      let parsed: WorkerResponse;
      try {
        parsed = JSON.parse(line) as WorkerResponse;
      } catch (err) {
        logWarn('[VoiceBridge] bad worker line:', line, err);
        continue;
      }
      if (parsed.id === 'boot') {
        if (parsed.ok) {
          log(`[VoiceBridge] worker ready (model=${parsed.model}, device=${parsed.device})`);
          this.bootResolve?.();
        } else {
          this.bootError = parsed.error ?? 'worker boot failed';
          logError('[VoiceBridge] worker boot failed:', this.bootError);
          this.bootReject?.(new Error(this.bootError));
        }
        this.bootResolve = null;
        this.bootReject = null;
        continue;
      }
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        logWarn('[VoiceBridge] response for unknown id:', parsed.id);
        continue;
      }
      this.pending.delete(parsed.id);
      clearTimeout(pending.timeoutHandle);
      if (parsed.ok && typeof parsed.text === 'string') {
        pending.resolve({
          text: parsed.text,
          durationMs: Math.round((parsed.duration ?? 0) * 1000),
        });
      } else {
        pending.reject(new Error(parsed.error ?? 'transcription failed'));
      }
    }
  }
}
