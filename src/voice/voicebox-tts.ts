/**
 * Voicebox HTTP adapter for expressive, local text-to-speech.
 *
 * Voicebox is deliberately only a voice renderer here. Code Buddy remains the
 * conversational brain and `personality` is always forced to false so a voice
 * profile can never rewrite Lisa's carefully planned answer.
 */
import { writeFile } from 'node:fs/promises';
import { logger } from '../utils/logger.js';
import { normalizePcm16Wav } from './tts-volume.js';

export const VOICEBOX_ENGINES = [
  'qwen',
  'qwen_custom_voice',
  'luxtts',
  'chatterbox',
  'chatterbox_turbo',
  'tada',
  'kokoro',
] as const;
export type VoiceboxEngine = (typeof VOICEBOX_ENGINES)[number];

export const VOICEBOX_MODEL_SIZES = ['0.6B', '1.7B', '1B', '3B'] as const;
export type VoiceboxModelSize = (typeof VOICEBOX_MODEL_SIZES)[number];

export interface VoiceboxProfile {
  id: string;
  name: string;
  language?: string;
  default_engine?: string | null;
  voice_type?: string;
}

export interface VoiceboxConfig {
  baseUrl: string;
  profile: string;
  engine: VoiceboxEngine;
  language: string;
  modelSize: VoiceboxModelSize;
  instruct?: string;
  seed: number;
  clientId: string;
  timeoutMs: number;
  maxAudioBytes: number;
}

export interface VoiceboxProbe {
  available: boolean;
  baseUrl: string;
  configuredProfile?: string;
  resolvedProfile?: VoiceboxProfile;
  profiles: VoiceboxProfile[];
  engine: VoiceboxEngine;
  error?: string;
  /** Actionable remediation for a reachable machine whose loopback-only API is hidden remotely. */
  hint?: string;
}

export interface VoiceboxRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:17493';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const PROFILE_CACHE_TTL_MS = 5 * 60_000;
const profileCache = new Map<string, { profile: VoiceboxProfile; expiresAt: number }>();
const profileLookups = new Map<string, Promise<VoiceboxProfile | null>>();

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function oneOf<T extends string>(raw: string | undefined, values: readonly T[], fallback: T): T {
  const normalized = raw?.trim().toLowerCase();
  return values.find((value) => value.toLowerCase() === normalized) ?? fallback;
}

/** Resolve and validate a Voicebox origin without retaining credentials or URL fragments. */
export function resolveVoiceboxBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.CODEBUDDY_VOICEBOX_URL?.trim() || DEFAULT_BASE_URL;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return DEFAULT_BASE_URL;
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export function resolveVoiceboxConfig(
  env: NodeJS.ProcessEnv = process.env,
  timeoutOverride?: number
): VoiceboxConfig {
  const instruct = env.CODEBUDDY_VOICEBOX_INSTRUCT?.trim().slice(0, 500);
  return {
    baseUrl: resolveVoiceboxBaseUrl(env),
    profile: env.CODEBUDDY_VOICEBOX_PROFILE?.trim() || '',
    engine: oneOf(env.CODEBUDDY_VOICEBOX_ENGINE, VOICEBOX_ENGINES, 'qwen'),
    language: env.CODEBUDDY_VOICEBOX_LANGUAGE?.trim().toLowerCase() || 'fr',
    modelSize: oneOf(env.CODEBUDDY_VOICEBOX_MODEL_SIZE, VOICEBOX_MODEL_SIZES, '1.7B'),
    ...(instruct ? { instruct } : {}),
    seed: boundedInteger(env.CODEBUDDY_VOICEBOX_SEED, 42, 0, 2_147_483_647),
    clientId: env.CODEBUDDY_VOICEBOX_CLIENT_ID?.trim().slice(0, 100) || 'code-buddy',
    timeoutMs: timeoutOverride ?? boundedInteger(
      env.CODEBUDDY_VOICEBOX_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      1_000,
      600_000
    ),
    maxAudioBytes: boundedInteger(
      env.CODEBUDDY_VOICEBOX_MAX_AUDIO_BYTES,
      DEFAULT_MAX_AUDIO_BYTES,
      1024,
      512 * 1024 * 1024
    ),
  };
}

function requestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function isVoiceboxProfile(value: unknown): value is VoiceboxProfile {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { id?: unknown; name?: unknown };
  return typeof candidate.id === 'string' && typeof candidate.name === 'string';
}

function isLoopbackVoicebox(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  } catch {
    return true;
  }
}

/** Keep remote failures actionable without assuming that the backend itself is broken. */
export function voiceboxReachabilityHint(baseUrl: string): string | undefined {
  if (isLoopbackVoicebox(baseUrl)) return undefined;
  return (
    'Voicebox binds to 127.0.0.1 by default. On the renderer host, verify ' +
    'http://127.0.0.1:17493/health, then expose it only inside the trusted tailnet ' +
    'with `tailscale serve --bg --tcp=17493 tcp://127.0.0.1:17493` (or use an SSH tunnel).'
  );
}

export async function listVoiceboxProfiles(
  env: NodeJS.ProcessEnv = process.env,
  options: VoiceboxRequestOptions = {}
): Promise<VoiceboxProfile[]> {
  const config = resolveVoiceboxConfig(env, options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(new URL('/profiles', config.baseUrl), {
    headers: { 'X-Voicebox-Client-Id': config.clientId },
    signal: requestSignal(Math.min(config.timeoutMs, 15_000), options.signal),
  });
  if (!response.ok) throw new Error(`Voicebox profiles HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('Voicebox returned an invalid profile list');
  return payload.filter(isVoiceboxProfile);
}

function profileKey(config: VoiceboxConfig): string {
  return `${config.baseUrl}|${config.profile.toLocaleLowerCase('fr')}`;
}

async function resolveProfile(
  env: NodeJS.ProcessEnv,
  config: VoiceboxConfig,
  options: VoiceboxRequestOptions
): Promise<VoiceboxProfile | null> {
  if (!config.profile) return null;
  const key = profileKey(config);
  const cached = profileCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;

  const existing = profileLookups.get(key);
  if (existing) return existing;
  const lookup = (async (): Promise<VoiceboxProfile | null> => {
    const profiles = await listVoiceboxProfiles(env, options);
    const wanted = config.profile.toLocaleLowerCase('fr');
    const resolved = profiles.find(
      (profile) => profile.id === config.profile || profile.name.toLocaleLowerCase('fr') === wanted
    ) ?? null;
    if (resolved) {
      profileCache.set(key, { profile: resolved, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });
    }
    return resolved;
  })();
  profileLookups.set(key, lookup);
  try {
    return await lookup;
  } finally {
    if (profileLookups.get(key) === lookup) profileLookups.delete(key);
  }
}

/**
 * Open Voicebox's direct WAV response. Voicebox currently finishes CUDA
 * generation before yielding its HTTP body, but consuming the body as a stream
 * still avoids an additional Code Buddy-side buffering delay during playback.
 */
export async function openVoiceboxAudioStream(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  options: VoiceboxRequestOptions = {}
): Promise<ReadableStream<Uint8Array> | null> {
  const clean = text.trim().slice(0, 50_000);
  if (!clean) return null;
  const config = resolveVoiceboxConfig(env, options.timeoutMs);
  if (!config.profile) return null;
  try {
    const profile = await resolveProfile(env, config, options);
    if (!profile) {
      logger.warn(`[voicebox-tts] configured profile '${config.profile}' was not found`);
      return null;
    }
    const body = {
      profile_id: profile.id,
      text: clean,
      language: config.language,
      seed: config.seed,
      model_size: config.modelSize,
      ...(config.instruct ? { instruct: config.instruct } : {}),
      engine: config.engine,
      // Code Buddy owns persona and discourse. Never let the renderer rewrite it.
      personality: false,
      max_chunk_chars: 800,
      crossfade_ms: 50,
      normalize: true,
    };
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(new URL('/generate/stream', config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Voicebox-Client-Id': config.clientId,
      },
      body: JSON.stringify(body),
      signal: requestSignal(config.timeoutMs, options.signal),
    });
    if (!response.ok || !response.body) {
      logger.debug(`[voicebox-tts] synthesis failed with HTTP ${response.status}`);
      return null;
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType.includes('json') || contentType.includes('text/html')) return null;
    return response.body;
  } catch (error) {
    if (!options.signal?.aborted) {
      logger.debug(
        `[voicebox-tts] request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return null;
  }
}

/** Buffer one bounded Voicebox response into a normalized, private WAV file. */
export async function synthesizeVoiceboxWav(
  text: string,
  wavPath: string,
  env: NodeJS.ProcessEnv = process.env,
  options: VoiceboxRequestOptions = {}
): Promise<boolean> {
  const config = resolveVoiceboxConfig(env, options.timeoutMs);
  const stream = await openVoiceboxAudioStream(text, env, options);
  if (!stream) return false;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > config.maxAudioBytes) {
        await reader.cancel('Voicebox audio exceeded configured size limit');
        return false;
      }
      chunks.push(value);
    }
    if (total <= 44) return false;
    const audio = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
    await writeFile(wavPath, normalizePcm16Wav(audio, env), { mode: 0o600 });
    return true;
  } catch (error) {
    if (!options.signal?.aborted) {
      logger.debug(
        `[voicebox-tts] audio read failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return false;
  } finally {
    reader.releaseLock();
  }
}

/** Read-only endpoint/profile diagnostic used by `buddy assistant voicebox`. */
export async function probeVoicebox(
  env: NodeJS.ProcessEnv = process.env,
  options: VoiceboxRequestOptions = {}
): Promise<VoiceboxProbe> {
  const config = resolveVoiceboxConfig(env, options.timeoutMs);
  try {
    const profiles = await listVoiceboxProfiles(env, options);
    const wanted = config.profile.toLocaleLowerCase('fr');
    const resolvedProfile = config.profile
      ? profiles.find(
          (profile) => profile.id === config.profile ||
            profile.name.toLocaleLowerCase('fr') === wanted
        )
      : undefined;
    return {
      available: config.profile ? Boolean(resolvedProfile) : true,
      baseUrl: config.baseUrl,
      ...(config.profile ? { configuredProfile: config.profile } : {}),
      ...(resolvedProfile ? { resolvedProfile } : {}),
      profiles,
      engine: config.engine,
      ...(
        config.profile && !resolvedProfile
          ? { error: `Configured profile '${config.profile}' was not found` }
          : {}
      ),
    };
  } catch (error) {
    const hint = voiceboxReachabilityHint(config.baseUrl);
    return {
      available: false,
      baseUrl: config.baseUrl,
      ...(config.profile ? { configuredProfile: config.profile } : {}),
      profiles: [],
      engine: config.engine,
      error: error instanceof Error ? error.message : String(error),
      ...(hint ? { hint } : {}),
    };
  }
}

/** Test/process teardown seam. */
export function resetVoiceboxProfileCache(): void {
  profileCache.clear();
  profileLookups.clear();
}
