/**
 * Sidecar Bridge
 *
 * Communicates with the Rust sidecar process (codebuddy-sidecar) via
 * JSON-RPC over stdin/stdout. Provides native performance for:
 * - Local Whisper STT (whisper-rs)
 * - Desktop automation (enigo + arboard)
 *
 * Falls back gracefully when the sidecar binary is not available.
 */

import { spawn, ChildProcess } from 'child_process';
import { createInterface, Interface } from 'readline';
import { join } from 'path';
import { existsSync } from 'fs';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface SidecarRequest {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

export interface SidecarResponse {
  id: number;
  result?: unknown;
  error?: string;
}

export interface TranscribeResult {
  text: string;
  segments: Array<{ text: string; start: number; end: number }>;
  duration_secs: number;
  processing_ms: number;
  model_used: string;
  model_slot: 'fast' | 'accurate';
}

export interface PasteResult {
  pasted: boolean;
  method?: string;
  clipboard?: boolean;
}

// ============================================================================
// Sidecar Bridge
// ============================================================================

export class SidecarBridge {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private available: boolean | null = null;
  private binaryPath: string | null = null;

  /**
   * Find the sidecar binary
   */
  private findBinary(): string | null {
    const candidates = [
      // Development: built via `cargo build`
      join(process.cwd(), 'src-sidecar', 'target', 'release', 'codebuddy-sidecar.exe'),
      join(process.cwd(), 'src-sidecar', 'target', 'release', 'codebuddy-sidecar'),
      join(process.cwd(), 'src-sidecar', 'target', 'debug', 'codebuddy-sidecar.exe'),
      join(process.cwd(), 'src-sidecar', 'target', 'debug', 'codebuddy-sidecar'),
      // Installed globally
      join(process.env.HOME || process.env.USERPROFILE || '', '.cargo', 'bin', 'codebuddy-sidecar.exe'),
      join(process.env.HOME || process.env.USERPROFILE || '', '.cargo', 'bin', 'codebuddy-sidecar'),
    ];

    for (const path of candidates) {
      if (existsSync(path)) {
        return path;
      }
    }
    return null;
  }

  /**
   * Check if sidecar is available
   */
  isAvailable(): boolean {
    if (this.available !== null) return this.available;
    this.binaryPath = this.findBinary();
    this.available = this.binaryPath !== null;
    return this.available;
  }

  /**
   * Start the sidecar process
   */
  async start(): Promise<void> {
    if (this.process) return;

    if (!this.isAvailable() || !this.binaryPath) {
      throw new Error('Sidecar binary not found. Build with: cd src-sidecar && cargo build --release');
    }

    this.process = spawn(this.binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.readline = createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    this.readline.on('line', (line: string) => {
      try {
        const resp: SidecarResponse = JSON.parse(line);
        const pending = this.pending.get(resp.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(resp.id);
          if (resp.error) {
            pending.reject(new Error(resp.error));
          } else {
            pending.resolve(resp.result);
          }
        }
      } catch (e) {
        logger.debug('Sidecar parse error', { line, error: String(e) });
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      logger.debug('Sidecar stderr', { data: data.toString() });
    });

    this.process.on('exit', (code) => {
      logger.info('Sidecar exited', { code });
      this.process = null;
      this.readline = null;
      // Reject all pending requests
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Sidecar process exited'));
      }
      this.pending.clear();
    });

    // Verify connection with ping
    const pong = await this.call('ping', {});
    logger.info('Sidecar started', { pong });
  }

  /**
   * Stop the sidecar process
   */
  stop(): void {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
  }

  /**
   * Call a sidecar method
   */
  async call(method: string, params: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
    if (!this.process?.stdin) {
      await this.start();
    }

    const id = this.nextId++;
    const request: SidecarRequest = { id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Sidecar call timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });

      const line = JSON.stringify(request) + '\n';
      this.process!.stdin!.write(line);
    });
  }

  // ── STT convenience methods ──

  async loadModel(path: string, slot?: 'fast' | 'accurate'): Promise<{ loaded: string; slot: string }> {
    return await this.call('stt.load_model', { path, slot }) as { loaded: string; slot: string };
  }

  async transcribe(audioBase64: string, language?: string, durationThreshold?: number): Promise<TranscribeResult> {
    return await this.call('stt.transcribe', {
      audio_b64: audioBase64,
      language,
      duration_threshold: durationThreshold,
    }, 120000) as TranscribeResult;
  }

  async sttStatus(): Promise<{ fast_loaded: boolean; accurate_loaded: boolean; ready: boolean }> {
    return await this.call('stt.status', {}) as { fast_loaded: boolean; accurate_loaded: boolean; ready: boolean };
  }

  // ── Desktop automation convenience methods ──

  async paste(text: string, method?: 'clipboard' | 'type' | 'none', autoSubmit?: boolean): Promise<PasteResult> {
    return await this.call('desktop.paste', { text, method, auto_submit: autoSubmit }) as PasteResult;
  }

  async typeText(text: string): Promise<{ typed: boolean; length: number }> {
    return await this.call('desktop.type_text', { text }) as { typed: boolean; length: number };
  }

  async keyPress(key: string, modifiers?: string[]): Promise<{ pressed: boolean; key: string }> {
    return await this.call('desktop.key_press', { key, modifiers }) as { pressed: boolean; key: string };
  }

  async clipboardGet(): Promise<{ text: string }> {
    return await this.call('desktop.clipboard_get', {}) as { text: string };
  }

  async clipboardSet(text: string): Promise<{ set: boolean }> {
    return await this.call('desktop.clipboard_set', { text }) as { set: boolean };
  }

  async version(): Promise<{ name: string; version: string; features: string[] }> {
    return await this.call('version', {}) as { name: string; version: string; features: string[] };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SidecarBridge | null = null;

export function getSidecarBridge(): SidecarBridge {
  if (!instance) {
    instance = new SidecarBridge();
  }
  return instance;
}

export function resetSidecarBridge(): void {
  if (instance) {
    instance.stop();
  }
  instance = null;
}
