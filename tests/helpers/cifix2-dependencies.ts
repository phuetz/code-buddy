import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

export interface DependencyProbe {
  available: boolean;
  reason: string;
}

const reportedReasons = new Set<string>();

function reportUnavailable(name: string, reason: string): void {
  const message = `[CIFIX2] ${name} unavailable; test guarded: ${reason}`;
  if (!reportedReasons.has(message)) {
    reportedReasons.add(message);
    process.stderr.write(`${message}\n`);
  }
}

function executableExists(candidate: string): boolean {
  if (path.isAbsolute(candidate)) return existsSync(candidate);
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return pathEntries.some((entry) => existsSync(path.join(entry, candidate)));
}

/** True when Playwright's Chromium executable is installed for this test process. */
export function chromiumExecutableExists(): boolean {
  try {
    const executable = chromium.executablePath();
    if (existsSync(executable)) return true;
    reportUnavailable('Chromium', `executable missing at ${executable}; install with npx playwright install chromium`);
  } catch (error) {
    reportUnavailable(
      'Chromium',
      `Playwright could not resolve its executable (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return false;
}

export interface PiperProbeOptions {
  piperBin?: string;
  piperModel?: string;
  audioPlayerBin?: string;
}

/** Check the complete local Piper path used by the real reminder journey. */
export function hasPiper(options: PiperProbeOptions = {}): DependencyProbe {
  const piperBin = options.piperBin ?? process.env.CODEBUDDY_PIPER_BIN ?? process.env.COWORK_PIPER_BIN ?? 'piper';
  const piperModel = options.piperModel ?? process.env.CODEBUDDY_TTS_PIPER_MODEL ?? process.env.CODEBUDDY_TTS_VOICE;
  const audioPlayerBin = options.audioPlayerBin ?? 'aplay';
  const missing: string[] = [];

  if (!executableExists(piperBin)) missing.push(`Piper executable ${piperBin} is missing`);
  if (!piperModel) missing.push('Piper voice model is not configured');
  else if (!existsSync(piperModel)) missing.push(`Piper voice model is missing at ${piperModel}`);
  if (!executableExists(audioPlayerBin)) missing.push(`audio player ${audioPlayerBin} is missing`);

  if (missing.length === 0) return { available: true, reason: 'Piper, its voice model, and the audio player are present' };
  const reason = missing.join('; ');
  reportUnavailable('Piper', reason);
  return { available: false, reason };
}

/** Synchronously probe the local Ollama model list so Vitest can use describe.skipIf. */
export function hasOllamaModel(model = process.env.CODEBUDDY_PEER_MODEL ?? 'qwen2.5:1.5b-instruct'): DependencyProbe {
  const host = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
  let tagsUrl: string;
  try {
    tagsUrl = new URL('/api/tags', host).toString();
  } catch {
    const reason = `Ollama host ${host} is not a valid URL`;
    reportUnavailable('Ollama', reason);
    return { available: false, reason };
  }

  try {
    const raw = execFileSync(
      'curl',
      ['--silent', '--show-error', '--fail', '--max-time', '2', tagsUrl],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const body = JSON.parse(raw) as { models?: Array<{ name?: unknown }> };
    if ((body.models ?? []).some((entry) => typeof entry.name === 'string' && entry.name.startsWith(model))) {
      return { available: true, reason: `Ollama model ${model} is available at ${host}` };
    }
    const reason = `Ollama is reachable at ${host}, but model ${model} is not installed`;
    reportUnavailable('Ollama', reason);
    return { available: false, reason };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
    const reason = `Ollama model ${model} is unavailable at ${host} (${detail})`;
    reportUnavailable('Ollama', reason);
    return { available: false, reason };
  }
}
