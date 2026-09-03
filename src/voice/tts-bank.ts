/**
 * Precomputed fixed-phrase bank for the resident voice.
 *
 * The project contributes `.codebuddy/tts-bank.txt`; the default corpus also
 * includes existing arrival openers and conversational cues. Dynamic phrases
 * are rejected before synthesis so stale dates, times, names or counters can
 * never be frozen into a reusable audio asset.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { resolveUserName } from '../companion/user-name.js';
import { ARRIVAL_TRIGGERS, templatePool } from '../sensory/arrival-opener.js';
import { getTtsCache } from '../sensory/tts-cache.js';
import { getDefaultVoicePrewarmPhrases } from '../sensory/voice-loop.js';
import {
  resolveElevenLabsCacheVoice,
  synthesizeElevenLabsWav,
  synthesizeKyutaiWav,
} from './local-tts.js';
import { resolveKyutaiCacheVoice } from './kyutai-local-voice.js';

export type TtsBankProvider = 'local' | 'elevenlabs';

export interface RejectedTtsBankPhrase {
  text: string;
  reason: string;
  source: 'project' | 'builtin';
}

export interface TtsBankCorpus {
  phrases: string[];
  rejected: RejectedTtsBankPhrase[];
}

interface TtsBankCache {
  has(text: string, voice?: string): boolean;
  store(text: string, voice: string | undefined, srcWav: string): void;
}

export interface TtsBankOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  provider?: TtsBankProvider;
  cache?: TtsBankCache;
  /** Test/embedder seam; omitted means the real existing corpus. */
  builtinPhrases?: string[];
}

export interface TtsBankBuildOptions extends TtsBankOptions {
  synthesize?: (
    text: string,
    wavPath: string,
    provider: TtsBankProvider,
  ) => Promise<boolean>;
}

export interface TtsBankBuildResult {
  provider: TtsBankProvider;
  expected: number;
  attempted: number;
  built: number;
  present: number;
  failed: number;
  rejected: RejectedTtsBankPhrase[];
}

export interface TtsBankListEntry {
  text: string;
  present: boolean;
}

export interface TtsBankListResult {
  provider: TtsBankProvider;
  voice: string;
  entries: TtsBankListEntry[];
  rejected: RejectedTtsBankPhrase[];
}

export interface TtsBankVerifyResult {
  provider: TtsBankProvider;
  expected: number;
  present: number;
  missing: string[];
  rejected: RejectedTtsBankPhrase[];
}

let bankWorkSequence = 0;

export function validateFixedTtsBankPhrase(
  input: string,
): { valid: true } | { valid: false; reason: string } {
  const phrase = input.trim();
  if (!phrase) return { valid: false, reason: 'empty' };
  if (/\{\{[^}]+\}\}|\$\{[^}]+\}|%\([^)]+\)s/iu.test(phrase)) {
    return { valid: false, reason: 'placeholder' };
  }
  if (/\d/u.test(phrase)) return { valid: false, reason: 'number' };
  if (
    /\b(?:aujourd['’]hui|demain|hier|date|heure|heures|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b/iu.test(
      phrase,
    )
  ) {
    return { valid: false, reason: 'date-or-time' };
  }
  return { valid: true };
}

function projectBankPhrases(cwd: string): string[] {
  const path = join(cwd, '.codebuddy', 'tts-bank.txt');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function interpolateBuiltinPhrase(text: string, env: NodeJS.ProcessEnv): string {
  return text.replace(/\{\{name\}\}/gu, resolveUserName(env)).replace(/\s{2,}/gu, ' ').trim();
}

export function getBuiltinTtsBankPhrases(env: NodeJS.ProcessEnv = process.env): string[] {
  const arrivals = ARRIVAL_TRIGGERS.flatMap((trigger) => templatePool(trigger));
  return [...getDefaultVoicePrewarmPhrases(), ...arrivals]
    .map((phrase) => interpolateBuiltinPhrase(phrase, env));
}

export function loadTtsBankCorpus(options: TtsBankOptions = {}): TtsBankCorpus {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const sources: Array<{ text: string; source: 'project' | 'builtin' }> = [
    ...projectBankPhrases(cwd).map((text) => ({ text, source: 'project' as const })),
    ...(options.builtinPhrases ?? getBuiltinTtsBankPhrases(env)).map((text) => ({
      text: interpolateBuiltinPhrase(text, env),
      source: 'builtin' as const,
    })),
  ];
  const phrases: string[] = [];
  const rejected: RejectedTtsBankPhrase[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const text = source.text.trim();
    if (seen.has(text)) continue;
    seen.add(text);
    const validation = validateFixedTtsBankPhrase(text);
    if (!validation.valid) {
      rejected.push({ text, reason: validation.reason, source: source.source });
      continue;
    }
    phrases.push(text);
  }
  return { phrases, rejected };
}

export function resolveTtsBankVoice(
  provider: TtsBankProvider,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return provider === 'local'
    ? resolveKyutaiCacheVoice(env)
    : resolveElevenLabsCacheVoice(env);
}

function cacheOf(cache: TtsBankCache | undefined): TtsBankCache {
  return cache ?? getTtsCache();
}

function listWith(
  options: TtsBankOptions,
): { provider: TtsBankProvider; voice: string; cache: TtsBankCache; corpus: TtsBankCorpus } {
  const provider = options.provider ?? 'local';
  const env = options.env ?? process.env;
  return {
    provider,
    voice: resolveTtsBankVoice(provider, env),
    cache: cacheOf(options.cache),
    corpus: loadTtsBankCorpus(options),
  };
}

export function listTtsBank(options: TtsBankOptions = {}): TtsBankListResult {
  const { provider, voice, cache, corpus } = listWith(options);
  return {
    provider,
    voice,
    entries: corpus.phrases.map((text) => ({ text, present: cache.has(text, voice) })),
    rejected: corpus.rejected,
  };
}

export function verifyTtsBank(options: TtsBankOptions = {}): TtsBankVerifyResult {
  const listed = listTtsBank(options);
  const missing = listed.entries.filter((entry) => !entry.present).map((entry) => entry.text);
  return {
    provider: listed.provider,
    expected: listed.entries.length,
    present: listed.entries.length - missing.length,
    missing,
    rejected: listed.rejected,
  };
}

async function defaultSynthesize(
  text: string,
  wavPath: string,
  provider: TtsBankProvider,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  return provider === 'local'
    ? synthesizeKyutaiWav(text, wavPath, env)
    : synthesizeElevenLabsWav(text, wavPath, env);
}

export async function buildTtsBank(
  options: TtsBankBuildOptions = {},
): Promise<TtsBankBuildResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const { provider, voice, cache, corpus } = listWith({ ...options, cwd, env });
  const missing = corpus.phrases.filter((text) => !cache.has(text, voice));
  const present = corpus.phrases.length - missing.length;
  const workDir = join(cwd, '.codebuddy', '.tts-bank-work');
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  let built = 0;
  let failed = 0;
  try {
    for (const text of missing) {
      const wavPath = join(workDir, `${process.pid}-${++bankWorkSequence}.wav`);
      try {
        const ok = options.synthesize
          ? await options.synthesize(text, wavPath, provider)
          : await defaultSynthesize(text, wavPath, provider, env);
        if (!ok || !existsSync(wavPath)) {
          failed += 1;
          continue;
        }
        cache.store(text, voice, wavPath);
        if (cache.has(text, voice)) built += 1;
        else failed += 1;
      } catch {
        failed += 1;
      } finally {
        rmSync(wavPath, { force: true });
      }
    }
  } finally {
    try {
      rmdirSync(workDir);
    } catch {
      /* concurrent build or failed cleanup: leave only the project-local work directory */
    }
  }
  return {
    provider,
    expected: corpus.phrases.length,
    attempted: missing.length,
    built,
    present,
    failed,
    rejected: corpus.rejected,
  };
}
