import { spawn } from 'child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'fs/promises';
import path from 'path';

import { checkSecretFileAccess, formatSecretRefusal, getHomeCredentialRoots } from '../security/secret-files.js';
import { commandExists } from '../utils/command-exists.js';

export type TextToSpeechProvider = 'auto' | 'system' | 'edge-tts' | 'espeak' | 'say' | 'audioreader' | 'piper';

export interface TextToSpeechOptions {
  rootDir?: string;
  now?: () => Date;
  createId?: () => string;
  runtime?: {
    platform?: NodeJS.Platform;
    spawn?: typeof spawn;
  };
}

export interface TextToSpeechInput {
  text: string;
  outputPath?: string;
  provider?: TextToSpeechProvider;
  voice?: string;
  language?: string;
  format?: 'wav' | 'mp3' | 'aiff';
  rate?: number;
  volume?: number;
  timeoutMs?: number;
}

export interface TextToSpeechResult {
  kind: 'text_to_speech_result';
  ok: boolean;
  provider: Exclude<TextToSpeechProvider, 'auto'>;
  outputPath: string;
  mediaPath: string;
  format: 'wav' | 'mp3' | 'aiff';
  textLength: number;
  generatedAt: string;
  sizeBytes: number;
  voice?: string;
  language?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TEXT_LENGTH = 4_000;
const SUPPORTED_OUTPUTS = new Set(['wav', 'mp3', 'aiff']);

/** Resolve the Piper voice model: an explicit `voice` (path to .onnx) wins, else
 *  the configured env (`CODEBUDDY_TTS_PIPER_MODEL` / `CODEBUDDY_TTS_VOICE`). Piper
 *  has no default voice — without a model there is nothing to synthesize. */
function resolvePiperModel(voice?: string): string | undefined {
  const candidate = voice ?? process.env.CODEBUDDY_TTS_PIPER_MODEL ?? process.env.CODEBUDDY_TTS_VOICE;
  return candidate && candidate.trim() ? candidate.trim() : undefined;
}

/**
 * The Piper binary. Defaults to `piper` (PATH lookup) but honours
 * CODEBUDDY_PIPER_BIN / COWORK_PIPER_BIN — the same convention as
 * src/voice/local-tts.ts — so it works when piper is installed outside the
 * process PATH (e.g. /usr/local/bin under a systemd service whose PATH is
 * trimmed to /usr/bin:/bin). Without this the sensory greeting/voice fail
 * silently with `spawn piper ENOENT`.
 */
function resolvePiperBin(): string {
  return process.env.CODEBUDDY_PIPER_BIN || process.env.COWORK_PIPER_BIN || 'piper';
}

export async function synthesizeTextToSpeech(
  input: TextToSpeechInput,
  options: TextToSpeechOptions = {},
): Promise<TextToSpeechResult> {
  const text = sanitizeSpeechText(input.text);
  if (!text) {
    throw new Error('text is required');
  }

  const provider = await resolveProvider(input.provider ?? 'auto', options);
  const format = resolveOutputFormat(input.format, provider, input.outputPath);
  validateProviderFormat(provider, format);
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const rootReal = await fs.realpath(rootDir);
  const mediaLocation = path.join(rootReal, '.codebuddy', 'tts');
  if (getHomeCredentialRoots().some((root) => isInside(mediaLocation, root))) {
    throw new Error('TTS output cannot be placed in a home credential directory');
  }
  const mediaDir = await ensureTtsMediaDirectory(rootDir, rootReal);
  const outputPath = resolveOutputPath(rootDir, mediaDir, input.outputPath, format, options);
  const verdict = checkSecretFileAccess(outputPath, 'write');
  if (verdict.secret) throw new Error(formatSecretRefusal(outputPath, verdict));
  // A TTS result is a new asset, never a replacement for an existing file.
  try {
    await fs.lstat(outputPath);
    throw new Error('TTS output already exists');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const providerOutput = path.join(mediaDir, `.tts-${randomUUID()}.${format}`);

  const command = buildProviderCommand(provider, {
    ...input,
    text,
    outputPath: providerOutput,
    format,
  }, options);

  try {
    if (command.kind === 'node') {
      await command.run();
    } else {
      await runCommand(command.command, command.args, {
        env: command.env,
        stdin: command.stdin,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        spawnImpl: options.runtime?.spawn ?? spawn,
      });
    }

    const produced = await fs.lstat(providerOutput);
    if (!produced.isFile() || produced.isSymbolicLink() || produced.size <= 0) {
      throw new Error(`TTS provider ${provider} produced no regular audio file`);
    }
    // COPYFILE_EXCL refuses a target created between validation and publish.
    // The provider never opens the requested final path.
    await fs.copyFile(providerOutput, outputPath, fsConstants.COPYFILE_EXCL);
  } finally {
    await fs.rm(providerOutput, { force: true });
  }
  const stat = await fs.stat(outputPath);

  const result: TextToSpeechResult = {
    kind: 'text_to_speech_result',
    ok: true,
    provider,
    outputPath,
    mediaPath: `MEDIA:${outputPath}`,
    format,
    textLength: text.length,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    sizeBytes: stat.size,
    ...(input.voice ? { voice: input.voice } : {}),
    ...(input.language ? { language: input.language } : {}),
  };
  return result;
}

export async function listAvailableTextToSpeechProviders(options: TextToSpeechOptions = {}): Promise<string[]> {
  const platform = options.runtime?.platform ?? process.platform;
  const providers: string[] = [];
  if (platform === 'win32' && await commandExists('powershell.exe', { platform })) {
    providers.push('system');
  }
  if (platform === 'darwin' && await commandExists('say', { platform })) {
    providers.push('say');
  }
  if (await commandExists('edge-tts', { platform })) {
    providers.push('edge-tts');
  }
  if (await commandExists('espeak', { platform })) {
    providers.push('espeak');
  }
  if (resolvePiperModel() && await commandExists(resolvePiperBin(), { platform })) {
    providers.push('piper');
  }
  return providers;
}

function sanitizeSpeechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/---+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DEFAULT_MAX_TEXT_LENGTH);
}

async function resolveProvider(
  provider: TextToSpeechProvider,
  options: TextToSpeechOptions,
): Promise<Exclude<TextToSpeechProvider, 'auto'>> {
  if (provider !== 'auto') {
    return provider;
  }

  const platform = options.runtime?.platform ?? process.platform;
  if (platform === 'win32' && await commandExists('powershell.exe', { platform })) {
    return 'system';
  }
  if (platform === 'darwin' && await commandExists('say', { platform })) {
    return 'say';
  }
  // Prefer Piper (real neural voice) ONLY when a model is explicitly configured —
  // otherwise leave the existing order untouched so current Linux callers don't
  // silently switch voice (a piper binary alone is not enough: it has no default voice).
  if (resolvePiperModel() && await commandExists(resolvePiperBin(), { platform })) {
    return 'piper';
  }
  if (await commandExists('edge-tts', { platform })) {
    return 'edge-tts';
  }
  if (await commandExists('espeak', { platform })) {
    return 'espeak';
  }
  throw new Error('No local TTS provider available. Install edge-tts/espeak/piper, use macOS say, Windows PowerShell SAPI, or choose audioreader when configured.');
}

function resolveOutputFormat(
  requested: TextToSpeechInput['format'],
  provider: Exclude<TextToSpeechProvider, 'auto'>,
  outputPath?: string,
): TextToSpeechResult['format'] {
  if (outputPath) {
    const ext = path.extname(outputPath).toLowerCase().replace('.', '');
    if (SUPPORTED_OUTPUTS.has(ext)) {
      return ext as TextToSpeechResult['format'];
    }
  }
  if (requested) {
    return requested;
  }
  if (provider === 'edge-tts') {
    return 'mp3';
  }
  if (provider === 'say') {
    return 'aiff';
  }
  // system / espeak / audioreader / piper all emit WAV.
  return 'wav';
}

function validateProviderFormat(provider: Exclude<TextToSpeechProvider, 'auto'>, format: TextToSpeechResult['format']): void {
  const supported: Record<Exclude<TextToSpeechProvider, 'auto'>, TextToSpeechResult['format'][]> = {
    system: ['wav'],
    'edge-tts': ['mp3'],
    espeak: ['wav'],
    say: ['aiff'],
    audioreader: ['wav'],
    piper: ['wav'],
  };
  if (!supported[provider].includes(format)) {
    throw new Error(`Provider ${provider} supports ${supported[provider].join(', ')} output, not ${format}`);
  }
}

function resolveOutputPath(
  rootDir: string,
  mediaDir: string,
  outputPath: string | undefined,
  format: TextToSpeechResult['format'],
  options: TextToSpeechOptions,
): string {
  if (outputPath) {
    if (hasTraversal(outputPath)) {
      throw new Error(`output_path contains '..' traversal component: ${outputPath}`);
    }
    const requested = path.isAbsolute(outputPath)
      ? path.resolve(outputPath)
      : path.dirname(outputPath) === '.'
        ? path.join(rootDir, '.codebuddy', 'tts', outputPath)
        : path.resolve(rootDir, outputPath);
    const expected = path.join(rootDir, '.codebuddy', 'tts');
    if (!samePath(path.dirname(requested), expected) && !samePath(path.dirname(requested), mediaDir)) {
      throw new Error('output_path must be inside the workspace .codebuddy/tts directory');
    }
    if (path.extname(requested).toLowerCase() !== `.${format}`) {
      throw new Error(`output_path must end with .${format}`);
    }
    return path.join(mediaDir, path.basename(requested));
  }
  const id = sanitizeId(options.createId?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return path.join(mediaDir, `tts-${id}.${format}`);
}

function samePath(a: string, b: string): boolean {
  const first = path.resolve(a);
  const second = path.resolve(b);
  return process.platform === 'win32' || process.platform === 'darwin'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

async function ensureTtsMediaDirectory(rootDir: string, rootReal: string): Promise<string> {
  let cursor = rootDir;
  for (const segment of ['.codebuddy', 'tts']) {
    cursor = path.join(cursor, segment);
    try { await fs.mkdir(cursor, { mode: 0o700 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const metadata = await fs.lstat(cursor);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('TTS output directory contains a symbolic link');
    }
    const real = await fs.realpath(cursor);
    if (!isInside(real, rootReal)) throw new Error('TTS output directory escapes its workspace');
  }
  return fs.realpath(cursor);
}

function hasTraversal(candidate: string): boolean {
  return candidate.split(/[\\/]+/).some(part => part === '..');
}

function buildProviderCommand(
  provider: Exclude<TextToSpeechProvider, 'auto'>,
  input: TextToSpeechInput & { text: string; outputPath: string; format: TextToSpeechResult['format'] },
  options: TextToSpeechOptions,
): { kind: 'spawn'; command: string; args: string[]; env?: NodeJS.ProcessEnv; stdin?: string } | { kind: 'node'; run: () => Promise<void> } {
  switch (provider) {
    case 'system':
      return buildWindowsSystemCommand(input, options);
    case 'piper': {
      const model = resolvePiperModel(input.voice);
      if (!model) {
        throw new Error('Piper requires a voice model: set CODEBUDDY_TTS_PIPER_MODEL (or CODEBUDDY_TTS_VOICE / voice) to a .onnx path.');
      }
      return {
        kind: 'spawn',
        command: resolvePiperBin(),
        args: ['--model', model, '--output_file', input.outputPath],
        stdin: input.text, // Piper reads the utterance from stdin
      };
    }
    case 'edge-tts':
      return {
        kind: 'spawn',
        command: 'edge-tts',
        args: [
          ...(input.voice ? ['--voice', input.voice] : []),
          '--text', input.text,
          '--write-media', input.outputPath,
        ],
      };
    case 'espeak':
      return {
        kind: 'spawn',
        command: 'espeak',
        args: [
          ...(input.language ? ['-v', input.language.split('-')[0] ?? input.language] : []),
          '-w', input.outputPath,
          input.text,
        ],
      };
    case 'say':
      return {
        kind: 'spawn',
        command: 'say',
        args: [
          ...(input.voice ? ['-v', input.voice] : []),
          '-o', input.outputPath,
          input.text,
        ],
      };
    case 'audioreader':
      return {
        kind: 'node',
        run: async () => {
          const response = await fetch('http://localhost:8000/v1/audio/speech', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'audioreader',
              input: input.text,
              voice: input.voice ?? 'ff_siwis',
              speed: 1.0,
              response_format: input.format,
            }),
          });
          if (!response.ok) {
            throw new Error(`AudioReader TTS error: ${response.status} ${await response.text()}`);
          }
          await fs.writeFile(input.outputPath, Buffer.from(await response.arrayBuffer()));
        },
      };
  }
}

function buildWindowsSystemCommand(
  input: TextToSpeechInput & { text: string; outputPath: string },
  options: TextToSpeechOptions,
): { kind: 'spawn'; command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const command = options.runtime?.platform === 'win32' || process.platform === 'win32' ? 'powershell.exe' : 'powershell';
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Speech',
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "if ($env:CODEBUDDY_TTS_VOICE) { $synth.SelectVoice($env:CODEBUDDY_TTS_VOICE) }",
    "if ($env:CODEBUDDY_TTS_RATE) { $synth.Rate = [Math]::Max(-10, [Math]::Min(10, [int]$env:CODEBUDDY_TTS_RATE)) }",
    "if ($env:CODEBUDDY_TTS_VOLUME) { $synth.Volume = [Math]::Max(0, [Math]::Min(100, [int]$env:CODEBUDDY_TTS_VOLUME)) }",
    '$parent = Split-Path -Parent $env:CODEBUDDY_TTS_OUTPUT',
    'New-Item -ItemType Directory -Path $parent -Force | Out-Null',
    '$synth.SetOutputToWaveFile($env:CODEBUDDY_TTS_OUTPUT)',
    '$synth.Speak($env:CODEBUDDY_TTS_TEXT)',
    '$synth.Dispose()',
  ].join('; ');

  return {
    kind: 'spawn',
    command,
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    env: {
      ...process.env,
      CODEBUDDY_TTS_TEXT: input.text,
      CODEBUDDY_TTS_OUTPUT: input.outputPath,
      CODEBUDDY_TTS_VOICE: input.voice ?? '',
      CODEBUDDY_TTS_RATE: input.rate !== undefined ? String(input.rate) : '',
      CODEBUDDY_TTS_VOLUME: input.volume !== undefined ? String(input.volume) : '',
    },
  };
}

function runCommand(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    stdin?: string;
    timeoutMs: number;
    spawnImpl: typeof spawn;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = options.spawnImpl(command, args, {
      env: options.env,
      windowsHide: true,
      stdio: [options.stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    if (options.stdin !== undefined) {
      child.stdin?.on('error', () => {}); // ignore EPIPE if the process closes stdin early
      child.stdin?.end(options.stdin);
    }
    let stderr = '';
    let stdout = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`TTS provider timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    child.stdout?.on('data', data => {
      stdout += data.toString();
    });
    child.stderr?.on('data', data => {
      stderr += data.toString();
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`TTS provider exited with code ${code}: ${stderr || stdout}`.trim()));
      }
    });
  });
}

function sanitizeId(id: string): string {
  const sanitized = id.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || `${Date.now()}`;
}
