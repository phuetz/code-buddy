/**
 * Kyutai Pocket TTS Provider
 *
 * A 100M-parameter on-CPU text-to-speech model (MIT) with **5-second voice
 * cloning** and six languages (English, French, German, Spanish, Portuguese,
 * Italian). Runs faster than real-time on a laptop CPU — no GPU, no web API.
 *
 * This provider shells out to the `pocket-tts` CLI, mirroring the edge-tts
 * provider's pattern: a launcher is auto-detected (`pocket-tts` on PATH, else
 * `uvx pocket-tts` which auto-installs), `generate` writes `./tts_output.wav`
 * in a throwaway working dir, and we read it back. Fail-open: if no launcher is
 * found, `isAvailable()` is false and `synthesize()` throws a clear install
 * hint (the TTS manager then falls back to another provider, e.g. Piper).
 *
 * Notes learned from the real CLI:
 *  - French has ONLY a 24-layer model → the language token must be `french_24l`
 *    (plain `french` errors). The language mapper handles this.
 *  - `--voice` takes a preset name OR a path to a .wav/.mp3/.flac to clone.
 *  - First ever run downloads torch + the model (seconds on a fast box), so the
 *    synthesis timeout is generous by default.
 *
 * @module talk-mode/providers/pocket-tts
 */

import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import type {
  TTSProviderConfig,
  Voice,
  SynthesisOptions,
  SynthesisResult,
  PocketTTSConfig,
} from '../types.js';
import type { ITTSProvider } from '../tts-manager.js';

/** A resolved launcher: `command` + a fixed args prefix (e.g. `uvx pocket-tts`). */
export interface PocketLauncher {
  command: string;
  argsPrefix: string[];
}

const SAMPLE_RATE = 24000; // Pocket TTS emits 24 kHz mono WAV.

/** A launcher from a command/path: a `…/uvx` needs the `pocket-tts` subcommand prefix. */
function launcherFor(cmd: string): PocketLauncher {
  return { command: cmd, argsPrefix: /(^|\/)uvx$/.test(cmd) ? ['pocket-tts'] : [] };
}

/**
 * Ordered launcher candidates. PATH-relative first (`pocket-tts`, `uvx`), then
 * an explicit `CODEBUDDY_POCKET_BIN`, then ABSOLUTE fallbacks under the home dir
 * — critical because a systemd daemon runs with a minimal PATH (no `~/.local/bin`),
 * so `uvx` is otherwise unreachable and Pocket silently falls back to Piper. Pure
 * except for the `existsSync` check on absolute paths (only real files are kept).
 */
export function pocketLauncherCandidates(
  binaryPath?: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  exists: (p: string) => boolean = existsSync
): PocketLauncher[] {
  const out: PocketLauncher[] = [];
  const seen = new Set<string>();
  const push = (cmd: string): void => {
    if (cmd && !seen.has(cmd)) {
      seen.add(cmd);
      out.push(launcherFor(cmd));
    }
  };
  if (binaryPath) push(binaryPath);
  if (env.CODEBUDDY_POCKET_BIN?.trim()) push(env.CODEBUDDY_POCKET_BIN.trim());
  push('pocket-tts');
  push('uvx');
  for (const abs of [
    join(home, '.local/bin/pocket-tts'),
    join(home, '.local/bin/uvx'),
    join(home, '.cargo/bin/uvx'),
  ]) {
    if (exists(abs)) push(abs);
  }
  return out;
}

/**
 * Map an incoming language (a BCP-47-ish code like `fr-FR`/`fr`, or a raw
 * Pocket token like `french`/`french_24l`) to a valid Pocket TTS language.
 *
 * Two hard rules from the model: English has no `_24l` variant, and **French
 * only exists as `french_24l`** — plain `french` is rejected by the CLI.
 * `highQuality` upgrades any other non-English language to its `_24l` variant.
 * Pure.
 */
export function resolvePocketLanguage(input?: string, highQuality = false): string {
  const raw = (input ?? '').trim().toLowerCase();
  if (!raw) return 'english';

  // Already a Pocket token (e.g. 'french_24l', 'italian') — pass through,
  // but still enforce the French-must-be-24l rule.
  const base = raw.replace(/_24l$/, '');
  const wants24l = raw.endsWith('_24l') || highQuality;

  const CODE_TO_LANG: Record<string, string> = {
    en: 'english',
    eng: 'english',
    english: 'english',
    fr: 'french',
    fra: 'french',
    fre: 'french',
    french: 'french',
    de: 'german',
    deu: 'german',
    ger: 'german',
    german: 'german',
    es: 'spanish',
    spa: 'spanish',
    spanish: 'spanish',
    pt: 'portuguese',
    por: 'portuguese',
    portuguese: 'portuguese',
    it: 'italian',
    ita: 'italian',
    italian: 'italian',
  };
  // Accept 'fr-FR' → 'fr' → 'french', etc.
  const key = base.split(/[-_]/)[0] ?? base;
  const lang = CODE_TO_LANG[base] ?? CODE_TO_LANG[key] ?? 'english';

  if (lang === 'english') return 'english'; // no 24l variant
  if (lang === 'french') return 'french_24l'; // French is ONLY available as 24l
  return wants24l ? `${lang}_24l` : lang;
}

/** True if `voice` looks like a local audio sample to clone (a path, not a preset). */
export function isVoiceSamplePath(voice?: string): boolean {
  if (!voice) return false;
  if (/\.(wav|mp3|flac|ogg|m4a)$/i.test(voice)) return true;
  return voice.includes('/') || voice.includes('\\');
}

/**
 * Build the argv for `pocket-tts generate` (WITHOUT the launcher prefix).
 * Pure + unit-testable. `generate` writes `tts_output.wav` in its cwd, so the
 * caller runs it inside a throwaway dir and reads that file back.
 */
export function buildGenerateArgs(opts: {
  text: string;
  language: string;
  voice?: string;
  configPath?: string;
}): string[] {
  const args = ['generate', '--language', opts.language, '--text', opts.text];
  if (opts.voice) args.push('--voice', opts.voice);
  if (opts.configPath) args.push('--config', opts.configPath);
  return args;
}

/** Parse the PCM data-chunk length from a canonical WAV header → duration ms. */
export function wavDurationMs(buf: Buffer, sampleRate = SAMPLE_RATE): number {
  // 44-byte canonical header: bytesPerSample assumed 2 (16-bit), mono.
  if (buf.length <= 44) return 0;
  const dataBytes = buf.length - 44;
  return Math.round((dataBytes / (sampleRate * 2)) * 1000);
}

/**
 * The 26 built-in preset voices — the SAME catalog is available in every
 * language (a voice can speak any language; a non-native sample may transfer
 * its accent). Any name here, or a path to a ~5 s sample, is a valid `--voice`.
 * When no voice is given the CLI picks a language-appropriate default itself
 * (estelle for French, giovanni/it, lola/es, juergen/de, rafael/pt, alba else).
 */
const PRESET_VOICES = [
  'alba',
  'anna',
  'azelma',
  'bill_boerst',
  'caro_davy',
  'charles',
  'cosette',
  'eponine',
  'estelle',
  'eve',
  'fantine',
  'george',
  'giovanni',
  'jane',
  'javert',
  'jean',
  'juergen',
  'lola',
  'marius',
  'mary',
  'michael',
  'paul',
  'peter_yearsley',
  'rafael',
  'stuart_bell',
  'vera',
] as const;

export class PocketTTSProvider implements ITTSProvider {
  readonly id = 'pocket' as const;
  private config: PocketTTSConfig = {};
  private initialized = false;
  private launcher: PocketLauncher | null = null;

  async initialize(config: TTSProviderConfig): Promise<void> {
    this.config = (config.settings as PocketTTSConfig | undefined) ?? {};
    this.launcher = await this.detectLauncher();
    if (!this.launcher) {
      console.warn(
        'pocket-tts launcher not found. Install with: pip install pocket-tts (or install uv for `uvx pocket-tts`).'
      );
    }
    this.initialized = true;
  }

  async isAvailable(): Promise<boolean> {
    return this.initialized && this.launcher !== null;
  }

  async listVoices(): Promise<Voice[]> {
    return PRESET_VOICES.map((id) => ({
      id: `pocket-${id}`,
      name: `Pocket ${id}`,
      language: 'multi', // every preset works in every supported language
      provider: 'pocket' as const,
      providerId: id,
      quality: 'high',
      sampleRate: SAMPLE_RATE,
      isDefault: id === 'alba',
    }));
  }

  private async detectLauncher(): Promise<PocketLauncher | null> {
    for (const c of pocketLauncherCandidates(this.config.binaryPath)) {
      if (await this.checkCommand(c.command, [...c.argsPrefix, '--help'])) return c;
    }
    return null;
  }

  private checkCommand(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (v: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(v);
      };
      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn(command, args, { stdio: 'ignore' });
      } catch {
        done(false);
        return;
      }
      proc.on('close', (code) => done(code === 0));
      proc.on('error', () => done(false));
      timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* noop */
        }
        done(false);
      }, 8000);
    });
  }

  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    if (!this.launcher) {
      throw new Error(
        'pocket-tts launcher not found. Install with: pip install pocket-tts (or install uv for `uvx pocket-tts`).'
      );
    }
    const language = resolvePocketLanguage(
      options?.language ?? this.config.language,
      this.config.highQuality ?? false
    );
    const voice = this.resolveVoice(options?.voice);
    const args = [
      ...this.launcher.argsPrefix,
      ...buildGenerateArgs({
        text,
        language,
        ...(voice ? { voice } : {}),
        ...(this.config.configPath ? { configPath: this.config.configPath } : {}),
      }),
    ];

    const workDir = mkdtempSync(join(tmpdir(), 'pocket-tts-'));
    try {
      await this.runGenerate(this.launcher.command, args, workDir);
      const outPath = join(workDir, 'tts_output.wav');
      if (!existsSync(outPath)) {
        throw new Error('pocket-tts did not produce tts_output.wav');
      }
      const audio = readFileSync(outPath);
      return {
        audio,
        format: 'wav',
        durationMs: wavDurationMs(audio),
        sampleRate: SAMPLE_RATE,
        channels: 1,
        bitsPerSample: 16,
        provider: 'pocket',
        voice: voice ?? 'default',
      };
    } finally {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }

  /** Resolve an incoming voice: a `pocket-`prefixed id, a preset name, or a clone path. */
  private resolveVoice(voice?: string): string | undefined {
    const v = voice ?? this.config.voice;
    if (!v) return undefined;
    if (isVoiceSamplePath(v)) return v; // clone from an audio sample
    return v.startsWith('pocket-') ? v.slice('pocket-'.length) : v;
  }

  private runGenerate(command: string, args: string[], cwd: string): Promise<void> {
    const timeoutMs = this.config.timeoutMs ?? 180000; // first run downloads the model
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* noop */
        }
        reject(new Error(`pocket-tts generate timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      proc.stderr?.on('data', (d) => {
        stderr += d.toString();
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else
          reject(new Error(`pocket-tts generate exited with code ${code}: ${stderr.slice(-500)}`));
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.launcher = null;
  }
}

export default PocketTTSProvider;
