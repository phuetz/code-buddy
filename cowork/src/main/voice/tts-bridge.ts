/**
 * TTSBridge — Cowork text-to-speech via the shared Code Buddy renderers.
 *
 * Pocket is the realtime path, Voicebox is the expressive GPU path, and the
 * older one-shot Piper path remains the final compatibility fallback.
 *
 * @module main/voice/tts-bridge
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildFilteredSubprocessEnv } from '../../../../src/utils/subprocess-env.js';
import { readAssistantConfig } from '../../../../src/companion/assistant-config.js';
import {
  resolveTtsEngine,
  synthesizePocketWav,
  type LocalTtsEngine,
} from '../../../../src/voice/local-tts.js';
import { synthesizeVoiceboxWav } from '../../../../src/voice/voicebox-tts.js';
import { normalizeWavFile } from '../../../../src/voice/tts-volume.js';
import { log, logWarn } from '../utils/logger';

const DEFAULT_VOICE_NAME = 'fr_FR-siwis-medium.onnx';

function voiceStackRoots(): string[] {
  const explicit = process.env.COWORK_VOICE_ROOT;
  return [
    explicit,
    path.join(os.homedir(), 'DEV', 'ai-stack', 'voice'),
    path.join(os.homedir(), 'ai-stack', 'voice'),
    path.join(os.homedir(), '.codebuddy', 'voice'),
  ].filter((item): item is string => Boolean(item));
}

function executableNames(base: string): string[] {
  return process.platform === 'win32'
    ? [`${base}.exe`, `${base}.cmd`, `${base}.bat`, base]
    : [base];
}

function findOnPath(base: string): string | null {
  const pathValue = process.env.PATH || '';
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const name of executableNames(base)) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function resolvePiperBinary(): string {
  if (process.env.COWORK_PIPER_BIN) return process.env.COWORK_PIPER_BIN;
  const candidates = [
    ...voiceStackRoots().flatMap((root) => [
      path.join(root, 'piper', 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper'),
      path.join(root, 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper'),
    ]),
    findOnPath('piper'),
  ].filter((item): item is string => Boolean(item));
  return (
    candidates.find((candidate) => existsSync(candidate)) ??
    candidates[0] ??
    (process.platform === 'win32' ? 'piper.exe' : 'piper')
  );
}

function resolvePiperVoice(): string {
  if (process.env.COWORK_PIPER_VOICE) return process.env.COWORK_PIPER_VOICE;
  const candidates = voiceStackRoots().map((root) => path.join(root, 'voices', DEFAULT_VOICE_NAME));
  return (
    candidates.find((candidate) => existsSync(candidate)) ??
    candidates[0] ??
    path.join(os.homedir(), '.codebuddy', 'voice', 'voices', DEFAULT_VOICE_NAME)
  );
}

function missingPiperMessage(kind: 'binary' | 'voice', filePath: string): string {
  const envName = kind === 'binary' ? 'COWORK_PIPER_BIN' : 'COWORK_PIPER_VOICE';
  return `${kind === 'binary' ? 'piper binary' : 'piper voice model'} not found at ${filePath}. Set ${envName} or COWORK_VOICE_ROOT to your local voice stack.`;
}

export interface TTSOptions {
  /** Override the legacy Piper fallback binary path. */
  piperBinary?: string;
  /** Override the legacy Piper fallback .onnx voice model. */
  model?: string;
  /** Cap synth time. Default 30 s. */
  timeoutMs?: number;
  /** Speed multiplier (Piper `--length_scale`). 1.0 = default, >1 slower, <1 faster. */
  lengthScale?: number;
}

export interface TTSResult {
  audio: ArrayBuffer;
  /** Approximate playback duration in ms (synth time != playback time). */
  synthesisDurationMs: number;
  /** Sample rate read from the WAV (Pocket uses 24 kHz; Piper FR uses 22.05 kHz). */
  sampleRate: number;
  /** Engine that produced this clip after any fallback. */
  provider: LocalTtsEngine;
}

type PocketSynthesizer = typeof synthesizePocketWav;
type VoiceboxSynthesizer = typeof synthesizeVoiceboxWav;

interface TTSBridgeOptions {
  binary?: string;
  voice?: string;
  engine?: LocalTtsEngine;
  env?: NodeJS.ProcessEnv;
  pocketSynthesizer?: PocketSynthesizer;
  voiceboxSynthesizer?: VoiceboxSynthesizer;
  assistantConfigReader?: () => Record<string, string>;
}

export class TTSBridge {
  private bootError: string | null = null;
  private resolvedBinary: string;
  private resolvedVoice: string;
  private engine: LocalTtsEngine;
  private env: NodeJS.ProcessEnv;
  private pocketSynthesizer: PocketSynthesizer;
  private voiceboxSynthesizer: VoiceboxSynthesizer;
  private assistantConfigReader: () => Record<string, string>;

  constructor(opts: TTSBridgeOptions = {}) {
    this.env = opts.env ?? process.env;
    // Production follows the Assistant panel's persisted volume immediately.
    // Injected envs in tests remain hermetic unless a reader is also injected.
    this.assistantConfigReader = opts.assistantConfigReader ??
      (opts.env === undefined ? readAssistantConfig : () => ({}));
    let persisted: Record<string, string> = {};
    try {
      persisted = this.assistantConfigReader();
    } catch {
      /* injected/process env remains authoritative */
    }
    this.engine = opts.engine ?? resolveTtsEngine({ ...persisted, ...this.env });
    this.pocketSynthesizer = opts.pocketSynthesizer ?? synthesizePocketWav;
    this.voiceboxSynthesizer = opts.voiceboxSynthesizer ?? synthesizeVoiceboxWav;
    this.resolvedBinary = opts.binary ?? resolvePiperBinary();
    this.resolvedVoice = opts.voice ?? resolvePiperVoice();
    if (this.engine === 'piper' && !existsSync(this.resolvedBinary)) {
      this.bootError = missingPiperMessage('binary', this.resolvedBinary);
      logWarn('[TTSBridge]', this.bootError);
    } else if (this.engine === 'piper' && !existsSync(this.resolvedVoice)) {
      this.bootError = missingPiperMessage('voice', this.resolvedVoice);
      logWarn('[TTSBridge]', this.bootError);
    } else if (this.engine === 'pocket') {
      log('[TTSBridge] ready — engine=Pocket TTS (resident), fallback=Piper');
    } else if (this.engine === 'voicebox') {
      log('[TTSBridge] ready — engine=Voicebox, fallback=Pocket TTS → Piper');
    } else {
      log(
        `[TTSBridge] ready — engine=Piper binary=${this.resolvedBinary} voice=${path.basename(
          this.resolvedVoice
        )}`
      );
    }
  }

  isReady(): boolean {
    return this.bootError === null;
  }

  getBootError(): string | null {
    return this.bootError;
  }

  getProvider(): LocalTtsEngine {
    return this.engine;
  }

  getFallbackProvider(): 'pocket' | 'piper' | null {
    if (this.engine === 'voicebox') return 'pocket';
    return this.engine === 'pocket' ? 'piper' : null;
  }

  /**
   * Synthesise `text` to speech. Pocket failures fall back to Piper.
   * The caller (renderer) is expected to play the returned bytes.
   */
  async synthesize(text: string, options: TTSOptions = {}): Promise<TTSResult> {
    if (!text || text.trim().length === 0) {
      throw new Error('TTSBridge: text is empty');
    }
    if (this.bootError) {
      throw new Error(this.bootError);
    }
    const binary = options.piperBinary ?? this.resolvedBinary;
    const voice = options.model ?? this.resolvedVoice;
    const timeoutMs = options.timeoutMs ?? 30000;
    const effectiveEnv = this.resolveEffectiveEnv();

    // Strip markdown / control noise so the speech engine doesn't read backticks
    // and underscores aloud. Cheap heuristic — for richer cleanup the
    // renderer should pre-process before calling.
    const cleaned = sanitizeForSpeech(text);
    if (!cleaned) {
      throw new Error('TTSBridge: text is empty after sanitization');
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cowork-tts-'));
    const outPath = path.join(tmpDir, 'speech.wav');

    try {
      const startedAt = Date.now();
      let provider: LocalTtsEngine = 'piper';
      if (this.engine === 'voicebox') {
        const generated = await this.voiceboxSynthesizer(
          cleaned,
          outPath,
          effectiveEnv,
          { timeoutMs }
        );
        if (generated) {
          provider = 'voicebox';
        } else {
          logWarn('[TTSBridge] Voicebox synthesis failed; falling back to Pocket TTS');
          const pocketGenerated = await this.pocketSynthesizer(
            cleaned,
            outPath,
            effectiveEnv,
            timeoutMs
          );
          if (pocketGenerated) {
            provider = 'pocket';
          } else {
            logWarn('[TTSBridge] Pocket fallback failed; falling back to Piper');
            this.assertPiperFallbackReady(binary, voice);
            await this.synthesizePiper(
              binary,
              voice,
              outPath,
              cleaned,
              timeoutMs,
              options.lengthScale
            );
          }
        }
      } else if (this.engine === 'pocket') {
        const generated = await this.pocketSynthesizer(cleaned, outPath, effectiveEnv, timeoutMs);
        if (generated) {
          provider = 'pocket';
        } else {
          logWarn('[TTSBridge] Pocket synthesis failed; falling back to Piper');
          this.assertPiperFallbackReady(binary, voice);
          await this.synthesizePiper(
            binary,
            voice,
            outPath,
            cleaned,
            timeoutMs,
            options.lengthScale
          );
        }
      } else {
        await this.synthesizePiper(binary, voice, outPath, cleaned, timeoutMs, options.lengthScale);
      }
      // Pocket is normalized in the shared core. This second pass is
      // intentionally idempotent and also covers the Piper fallback.
      await normalizeWavFile(outPath, effectiveEnv);
      const synthesisDurationMs = Date.now() - startedAt;

      const bytes = await fs.readFile(outPath);
      const sampleRate = readWavSampleRate(bytes) ?? (provider === 'piper' ? 22050 : 24000);
      const audio = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return {
        audio: audio as ArrayBuffer,
        synthesisDurationMs,
        sampleRate,
        provider,
      };
    } finally {
      void fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private resolveEffectiveEnv(): NodeJS.ProcessEnv {
    let persisted: Record<string, string> = {};
    try {
      persisted = this.assistantConfigReader();
    } catch {
      /* default volume remains fail-open */
    }
    // Cowork consumes the same persisted engine/profile/delivery settings as
    // the resident assistant. Explicit process values still win for launches
    // that deliberately override the shared configuration.
    return {
      ...persisted,
      ...this.env,
    };
  }

  private assertPiperFallbackReady(binary: string, voice: string): void {
    if (!existsSync(binary)) throw new Error(missingPiperMessage('binary', binary));
    if (!existsSync(voice)) throw new Error(missingPiperMessage('voice', voice));
  }

  private async synthesizePiper(
    binary: string,
    voice: string,
    outPath: string,
    text: string,
    timeoutMs: number,
    lengthScale?: number
  ): Promise<void> {
    const args = ['--model', voice, '--output_file', outPath, '--quiet'];
    if (typeof lengthScale === 'number' && lengthScale > 0) {
      args.push('--length_scale', String(lengthScale));
    }
    await spawnPiper(binary, args, text, timeoutMs);
  }
}

function spawnPiper(
  binary: string,
  args: string[],
  text: string,
  timeoutMs: number
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildPiperEnv(),
    });
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    const killer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      reject(new Error(`piper timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(killer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(killer);
      if (code === 0) {
        resolve();
      } else {
        const tail = stderr.split('\n').slice(-3).join(' | ').trim();
        reject(new Error(`piper exited with code ${code ?? '?'}${tail ? ` — ${tail}` : ''}`));
      }
    });
    child.stdin.write(text + '\n');
    child.stdin.end();
  });
}

function buildPiperEnv(): NodeJS.ProcessEnv {
  return buildFilteredSubprocessEnv({
    allowEnv: ['COWORK_VOICE_ROOT'],
  });
}

/**
 * Parse the RIFF/WAVE header to extract the sample rate. Returns
 * `null` for malformed input. Covers only the canonical PCM header
 * Piper produces (22050 Hz mono 16-bit).
 */
function readWavSampleRate(buf: Buffer): number | null {
  if (buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  // `fmt ` chunk: byte 24 = sampleRate (little-endian u32).
  return buf.readUInt32LE(24);
}

/**
 * Make text suitable for TTS playback. Removes markdown noise that
 * a speech engine would otherwise read aloud, and elides code blocks (no point
 * speaking 100 lines of bash).
 */
function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (bloc de code) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export const __test = {
  sanitizeForSpeech,
  readWavSampleRate,
  resolvePiperBinary,
  resolvePiperVoice,
  missingPiperMessage,
  buildPiperEnv,
};
