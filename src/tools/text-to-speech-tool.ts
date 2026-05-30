import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

import { commandExists } from '../utils/command-exists.js';

export type TextToSpeechProvider = 'auto' | 'system' | 'edge-tts' | 'espeak' | 'say' | 'kokoro' | 'audioreader';

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
  const outputPath = resolveOutputPath(rootDir, input.outputPath, format, options);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const command = buildProviderCommand(provider, {
    ...input,
    text,
    outputPath,
    format,
  }, options);

  if (command.kind === 'node') {
    await command.run();
  } else {
    await runCommand(command.command, command.args, {
      env: command.env,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      spawnImpl: options.runtime?.spawn ?? spawn,
    });
  }

  const stat = await fs.stat(outputPath);
  if (stat.size <= 0) {
    throw new Error(`TTS provider ${provider} produced empty output at ${outputPath}`);
  }

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
  if (await commandExists('edge-tts', { platform })) {
    return 'edge-tts';
  }
  if (await commandExists('espeak', { platform })) {
    return 'espeak';
  }
  throw new Error('No local TTS provider available. Install edge-tts/espeak, use macOS say, Windows PowerShell SAPI, or choose kokoro/audioreader when configured.');
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
  return 'wav';
}

function validateProviderFormat(provider: Exclude<TextToSpeechProvider, 'auto'>, format: TextToSpeechResult['format']): void {
  const supported: Record<Exclude<TextToSpeechProvider, 'auto'>, TextToSpeechResult['format'][]> = {
    system: ['wav'],
    'edge-tts': ['mp3'],
    espeak: ['wav'],
    say: ['aiff'],
    kokoro: ['wav'],
    audioreader: ['wav'],
  };
  if (!supported[provider].includes(format)) {
    throw new Error(`Provider ${provider} supports ${supported[provider].join(', ')} output, not ${format}`);
  }
}

function resolveOutputPath(
  rootDir: string,
  outputPath: string | undefined,
  format: TextToSpeechResult['format'],
  options: TextToSpeechOptions,
): string {
  if (outputPath) {
    if (hasTraversal(outputPath)) {
      throw new Error(`output_path contains '..' traversal component: ${outputPath}`);
    }
    return path.isAbsolute(outputPath) ? path.resolve(outputPath) : path.resolve(rootDir, outputPath);
  }
  const id = sanitizeId(options.createId?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return path.join(rootDir, '.codebuddy', 'tts', `tts-${id}.${format}`);
}

function hasTraversal(candidate: string): boolean {
  return candidate.split(/[\\/]+/).some(part => part === '..');
}

function buildProviderCommand(
  provider: Exclude<TextToSpeechProvider, 'auto'>,
  input: TextToSpeechInput & { text: string; outputPath: string; format: TextToSpeechResult['format'] },
  options: TextToSpeechOptions,
): { kind: 'spawn'; command: string; args: string[]; env?: NodeJS.ProcessEnv } | { kind: 'node'; run: () => Promise<void> } {
  switch (provider) {
    case 'system':
      return buildWindowsSystemCommand(input, options);
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
    case 'kokoro':
      return {
        kind: 'node',
        run: async () => {
          const { kokoroTtsService } = await import('../utils/kokoro-tts.js');
          const buffer = await kokoroTtsService.generateSpeech(input.text, input.voice ?? 'af_bella');
          await fs.writeFile(input.outputPath, buffer);
        },
      };
    case 'audioreader':
      return {
        kind: 'node',
        run: async () => {
          const response = await fetch('http://localhost:8000/v1/audio/speech', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'kokoro',
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
    timeoutMs: number;
    spawnImpl: typeof spawn;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = options.spawnImpl(command, args, {
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
