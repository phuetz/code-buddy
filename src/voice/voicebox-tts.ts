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

/** Languages advertised by Voicebox's current seven-engine API. */
export const VOICEBOX_LANGUAGES = [
  'zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it', 'he', 'ar',
  'da', 'el', 'fi', 'hi', 'ms', 'nl', 'no', 'pl', 'sv', 'sw', 'tr',
] as const;
export type VoiceboxLanguage = (typeof VOICEBOX_LANGUAGES)[number];

export interface VoiceboxProfile {
  id: string;
  name: string;
  description?: string | null;
  language?: string;
  default_engine?: string | null;
  voice_type?: string;
  preset_engine?: string | null;
  preset_voice_id?: string | null;
  design_prompt?: string | null;
  sample_count?: number;
  generation_count?: number;
}

export interface VoiceboxProfileSample {
  id: string;
  profile_id: string;
  audio_path: string;
  reference_text: string;
}

export interface VoiceboxHealth {
  status: string;
  model_loaded: boolean;
  model_downloaded?: boolean | null;
  model_size?: string | null;
  gpu_available: boolean;
  gpu_type?: string | null;
  vram_used_mb?: number | null;
  backend_type?: string | null;
  backend_variant?: string | null;
}

export interface VoiceboxModelStatus {
  model_name: string;
  display_name: string;
  downloaded: boolean;
  downloading?: boolean;
  loaded?: boolean;
  size_mb?: number | null;
}

export interface VoiceboxStudioProbe extends VoiceboxProbe {
  health?: VoiceboxHealth;
  models: VoiceboxModelStatus[];
  presetVoices: VoiceboxPresetVoice[];
  languages: readonly VoiceboxLanguage[];
}

export interface VoiceboxCloneInput {
  name: string;
  description?: string;
  language: VoiceboxLanguage;
  referenceText: string;
  filename: string;
  audio: Uint8Array;
  /** Explicit proof that the operator is authorized to clone this voice. */
  consent: boolean;
  defaultEngine?: VoiceboxEngine;
}

export type VoiceboxPresetEngine = 'kokoro' | 'qwen_custom_voice';

export interface VoiceboxPresetVoice {
  voice_id: string;
  name: string;
  gender: string;
  language: string;
  engine: VoiceboxPresetEngine;
}

export interface VoiceboxPresetProfileInput {
  name: string;
  description?: string;
  language: VoiceboxLanguage;
  engine: VoiceboxPresetEngine;
  voiceId: string;
}

export type VoiceboxModelAction = 'download' | 'cancel' | 'unload' | 'delete';

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
  /** Per-turn acoustic direction; merged with the configured base instruction. */
  instruct?: string;
  /** Reuse the gain measured from the first segment of the current turn. */
  frozenFactor?: number;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:17493';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const PROFILE_CACHE_TTL_MS = 5 * 60_000;
const MAX_PROFILE_AUDIO_BYTES = 50 * 1024 * 1024;
const ALLOWED_PROFILE_AUDIO_EXTENSIONS = new Set([
  '.wav', '.mp3', '.m4a', '.ogg', '.flac', '.aac', '.webm', '.opus',
]);
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

function isVoiceboxProfileSample(value: unknown): value is VoiceboxProfileSample {
  if (!value || typeof value !== 'object') return false;
  const sample = value as Partial<VoiceboxProfileSample>;
  return typeof sample.id === 'string' &&
    typeof sample.profile_id === 'string' &&
    typeof sample.audio_path === 'string' &&
    typeof sample.reference_text === 'string';
}

function isVoiceboxHealth(value: unknown): value is VoiceboxHealth {
  if (!value || typeof value !== 'object') return false;
  const health = value as Partial<VoiceboxHealth>;
  return typeof health.status === 'string' &&
    typeof health.model_loaded === 'boolean' &&
    typeof health.gpu_available === 'boolean';
}

function isVoiceboxModelStatus(value: unknown): value is VoiceboxModelStatus {
  if (!value || typeof value !== 'object') return false;
  const model = value as Partial<VoiceboxModelStatus>;
  return typeof model.model_name === 'string' &&
    typeof model.display_name === 'string' &&
    typeof model.downloaded === 'boolean';
}

function isVoiceboxPresetVoice(value: unknown): value is Omit<VoiceboxPresetVoice, 'engine'> {
  if (!value || typeof value !== 'object') return false;
  const voice = value as Partial<VoiceboxPresetVoice>;
  return typeof voice.voice_id === 'string' &&
    typeof voice.name === 'string' &&
    typeof voice.gender === 'string' &&
    typeof voice.language === 'string';
}

async function voiceboxError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { detail?: unknown; message?: unknown };
    const detail = typeof payload.detail === 'string'
      ? payload.detail
      : typeof payload.message === 'string'
        ? payload.message
        : '';
    if (detail) return detail.slice(0, 500);
  } catch {
    // The status code below remains actionable when the server body is not JSON.
  }
  return `HTTP ${response.status}`;
}

function voiceboxHeaders(config: VoiceboxConfig): Record<string, string> {
  return { 'X-Voicebox-Client-Id': config.clientId };
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

export async function listVoiceboxProfileSamples(
  profileId: string,
  env: NodeJS.ProcessEnv = process.env,
  options: VoiceboxRequestOptions = {}
): Promise<VoiceboxProfileSample[]> {
  const cleanId = profileId.trim();
  if (!cleanId) throw new Error('Voicebox profile id is required');
  const config = resolveVoiceboxConfig(env, options.timeoutMs);
  const response = await (options.fetchImpl ?? fetch)(
    new URL(`/profiles/${encodeURIComponent(cleanId)}/samples`, config.baseUrl),
    {
      headers: voiceboxHeaders(config),
      signal: requestSignal(Math.min(config.timeoutMs, 15_000), options.signal),
    }
  );
  if (!response.ok) throw new Error(`Voicebox samples: ${await voiceboxError(response)}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('Voicebox returned an invalid sample list');
  return payload.filter(isVoiceboxProfileSample);
}

/**
 * Create one cloned profile and attach its first reference sample atomically.
 * If the sample upload fails, the empty profile is removed best-effort so the
 * studio does not accumulate misleading half-created voices.
 */
export async function createVoiceboxClone(
  input: VoiceboxCloneInput,
  env: NodeJS.ProcessEnv = process.env,
  options: VoiceboxRequestOptions = {}
): Promise<{ profile: VoiceboxProfile; sample: VoiceboxProfileSample }> {
  if (!input.consent) {
    throw new Error('Explicit authorization is required before cloning a voice');
  }
  const name = input.name.trim();
  const description = input.description?.trim();
  const referenceText = input.referenceText.trim();
  const filename = input.filename.trim().replace(/[\\/]/gu, '_');
  if (!name || name.length > 100) throw new Error('Voice profile name must contain 1–100 characters');
  if (description && description.length > 500) throw new Error('Voice profile description is limited to 500 characters');
  if (!VOICEBOX_LANGUAGES.includes(input.language)) throw new Error('Unsupported Voicebox language');
  if (!referenceText || referenceText.length > 1_000) {
    throw new Error('Reference transcript must contain 1–1000 characters');
  }
  if (!(input.audio instanceof Uint8Array) || input.audio.byteLength === 0) {
    throw new Error('A non-empty reference audio sample is required');
  }
  if (input.audio.byteLength > MAX_PROFILE_AUDIO_BYTES) {
    throw new Error('Reference audio exceeds the 50 MiB Voicebox limit');
  }
  const suffix = filename.toLowerCase().match(/\.[a-z0-9]+$/u)?.[0] ?? '';
  if (!ALLOWED_PROFILE_AUDIO_EXTENSIONS.has(suffix)) {
    throw new Error('Reference audio must be WAV, MP3, M4A, OGG, FLAC, AAC, WebM, or Opus');
  }

  const config = resolveVoiceboxConfig(env, options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  const signal = requestSignal(config.timeoutMs, options.signal);
  const createResponse = await fetchImpl(new URL('/profiles', config.baseUrl), {
    method: 'POST',
    headers: {
      ...voiceboxHeaders(config),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      ...(description ? { description } : {}),
      language: input.language,
      voice_type: 'cloned',
      default_engine: input.defaultEngine ?? 'qwen',
    }),
    signal,
  });
  if (!createResponse.ok) {
    throw new Error(`Voicebox profile creation: ${await voiceboxError(createResponse)}`);
  }
  const created: unknown = await createResponse.json();
  if (!isVoiceboxProfile(created)) throw new Error('Voicebox returned an invalid created profile');

  try {
    const form = new FormData();
    const audioCopy = new Uint8Array(input.audio.byteLength);
    audioCopy.set(input.audio);
    form.append('file', new Blob([audioCopy.buffer]), filename);
    form.append('reference_text', referenceText);
    const sampleResponse = await fetchImpl(
      new URL(`/profiles/${encodeURIComponent(created.id)}/samples`, config.baseUrl),
      {
        method: 'POST',
        headers: voiceboxHeaders(config),
        body: form,
        signal,
      }
    );
    if (!sampleResponse.ok) {
      throw new Error(`Voicebox sample upload: ${await voiceboxError(sampleResponse)}`);
    }
    const sample: unknown = await sampleResponse.json();
    if (!isVoiceboxProfileSample(sample)) {
      throw new Error('Voicebox returned an invalid created sample');
    }
    resetVoiceboxProfileCache();
    return { profile: created, sample };
  } catch (error) {
    try {
      await fetchImpl(new URL(`/profiles/${encodeURIComponent(created.id)}`, config.baseUrl), {
        method: 'DELETE',
        headers: voiceboxHeaders(config),
        // Cleanup gets its own bounded signal: an aborted upload request must
        // not leave a half-created profile behind.
        signal: requestSignal(Math.min(config.timeoutMs, 10_000)),
      });
    } catch {
      // Preserve the original upload error; cleanup remains best-effort.
    }
    throw error;
  }
}

/** Create a profile backed by one of Voicebox's functional built-in speakers. */
export async function createVoiceboxPresetProfile(
  input: VoiceboxPresetProfileInput,
  env: NodeJS.ProcessEnv = process.env,
  options: VoiceboxRequestOptions = {}
): Promise<VoiceboxProfile> {
  const name = input.name.trim();
  const description = input.description?.trim();
  const voiceId = input.voiceId.trim();
  if (!name || name.length > 100) throw new Error('Voice profile name must contain 1–100 characters');
  if (description && description.length > 500) {
    throw new Error('Voice profile description is limited to 500 characters');
  }
  if (!VOICEBOX_LANGUAGES.includes(input.language)) throw new Error('Unsupported Voicebox language');
  if (!['kokoro', 'qwen_custom_voice'].includes(input.engine)) {
    throw new Error('Unsupported Voicebox preset engine');
  }
  if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(voiceId)) {
    throw new Error('Invalid Voicebox preset voice id');
  }

  const config = resolveVoiceboxConfig(env, options.timeoutMs);
  const response = await (options.fetchImpl ?? fetch)(new URL('/profiles', config.baseUrl), {
    method: 'POST',
    headers: {
      ...voiceboxHeaders(config),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      ...(description ? { description } : {}),
      language: input.language,
      voice_type: 'preset',
      preset_engine: input.engine,
      preset_voice_id: voiceId,
      default_engine: input.engine,
      // Deliberately omit `personality`: Code Buddy remains the conversational brain.
    }),
    signal: requestSignal(Math.min(config.timeoutMs, 30_000), options.signal),
  });
  if (!response.ok) {
    throw new Error(`Voicebox preset profile: ${await voiceboxError(response)}`);
  }
  const created: unknown = await response.json();
  if (!isVoiceboxProfile(created)) throw new Error('Voicebox returned an invalid preset profile');
  resetVoiceboxProfileCache();
  return created;
}

export async function listVoiceboxPresetVoices(
  engine: VoiceboxPresetEngine,
  env: NodeJS.ProcessEnv = process.env,
  options: VoiceboxRequestOptions = {}
): Promise<VoiceboxPresetVoice[]> {
  const config = resolveVoiceboxConfig(env, options.timeoutMs);
  const response = await (options.fetchImpl ?? fetch)(
    new URL(`/profiles/presets/${engine}`, config.baseUrl),
    {
      headers: voiceboxHeaders(config),
      signal: requestSignal(Math.min(config.timeoutMs, 15_000), options.signal),
    }
  );
  if (!response.ok) throw new Error(`Voicebox preset voices: ${await voiceboxError(response)}`);
  const payload: unknown = await response.json();
  const candidates = payload && typeof payload === 'object'
    ? (payload as { voices?: unknown }).voices
    : null;
  return Array.isArray(candidates)
    ? candidates.filter(isVoiceboxPresetVoice).map((voice) => ({ ...voice, engine }))
    : [];
}

/** Bounded model lifecycle operations used by the CLI and Cowork studio. */
export async function manageVoiceboxModel(
  modelName: string,
  action: VoiceboxModelAction,
  confirmed = false,
  env: NodeJS.ProcessEnv = process.env,
  options: VoiceboxRequestOptions = {}
): Promise<{ message: string }> {
  const cleanName = modelName.trim();
  if (!/^[a-zA-Z0-9._-]{1,100}$/u.test(cleanName)) {
    throw new Error('Invalid Voicebox model name');
  }
  if (action === 'delete' && !confirmed) {
    throw new Error('Model deletion requires explicit confirmation');
  }
  const config = resolveVoiceboxConfig(env, options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  const jsonAction = action === 'download' || action === 'cancel';
  const path = action === 'download'
    ? '/models/download'
    : action === 'cancel'
      ? '/models/download/cancel'
      : action === 'unload'
        ? `/models/${encodeURIComponent(cleanName)}/unload`
        : `/models/${encodeURIComponent(cleanName)}`;
  const response = await fetchImpl(new URL(path, config.baseUrl), {
    method: action === 'delete' ? 'DELETE' : 'POST',
    headers: {
      ...voiceboxHeaders(config),
      ...(jsonAction ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(jsonAction ? { body: JSON.stringify({ model_name: cleanName }) } : {}),
    signal: requestSignal(Math.min(config.timeoutMs, 30_000), options.signal),
  });
  if (!response.ok) throw new Error(`Voicebox model ${action}: ${await voiceboxError(response)}`);
  const payload: unknown = await response.json().catch(() => null);
  const message = payload && typeof payload === 'object' &&
    typeof (payload as { message?: unknown }).message === 'string'
    ? (payload as { message: string }).message
    : `Model ${cleanName}: ${action}`;
  return { message };
}

export async function deleteVoiceboxProfile(
  profileId: string,
  confirmed: boolean,
  env: NodeJS.ProcessEnv = process.env,
  options: VoiceboxRequestOptions = {}
): Promise<void> {
  const cleanId = profileId.trim();
  if (!confirmed) throw new Error('Voice profile deletion requires explicit confirmation');
  if (!cleanId) throw new Error('Voicebox profile id is required');
  const config = resolveVoiceboxConfig(env, options.timeoutMs);
  const response = await (options.fetchImpl ?? fetch)(
    new URL(`/profiles/${encodeURIComponent(cleanId)}`, config.baseUrl),
    {
      method: 'DELETE',
      headers: voiceboxHeaders(config),
      signal: requestSignal(Math.min(config.timeoutMs, 15_000), options.signal),
    }
  );
  if (!response.ok) throw new Error(`Voicebox profile deletion: ${await voiceboxError(response)}`);
  resetVoiceboxProfileCache();
}

/** Capability inventory for Cowork and CLI administration. */
export async function probeVoiceboxStudio(
  env: NodeJS.ProcessEnv = process.env,
  options: VoiceboxRequestOptions = {}
): Promise<VoiceboxStudioProbe> {
  const config = resolveVoiceboxConfig(env, options.timeoutMs);
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const [profilesResponse, healthResponse, modelsResponse, kokoroResponse, qwenPresetResponse] = await Promise.all([
      fetchImpl(new URL('/profiles', config.baseUrl), {
        headers: voiceboxHeaders(config),
        signal: requestSignal(Math.min(config.timeoutMs, 15_000), options.signal),
      }),
      fetchImpl(new URL('/health', config.baseUrl), {
        headers: voiceboxHeaders(config),
        signal: requestSignal(Math.min(config.timeoutMs, 15_000), options.signal),
      }),
      fetchImpl(new URL('/models/status', config.baseUrl), {
        headers: voiceboxHeaders(config),
        signal: requestSignal(Math.min(config.timeoutMs, 15_000), options.signal),
      }),
      fetchImpl(new URL('/profiles/presets/kokoro', config.baseUrl), {
        headers: voiceboxHeaders(config),
        signal: requestSignal(Math.min(config.timeoutMs, 15_000), options.signal),
      }),
      fetchImpl(new URL('/profiles/presets/qwen_custom_voice', config.baseUrl), {
        headers: voiceboxHeaders(config),
        signal: requestSignal(Math.min(config.timeoutMs, 15_000), options.signal),
      }),
    ]);
    if (!profilesResponse.ok) throw new Error(`profiles ${await voiceboxError(profilesResponse)}`);
    if (!healthResponse.ok) throw new Error(`health ${await voiceboxError(healthResponse)}`);
    const profilesPayload: unknown = await profilesResponse.json();
    const healthPayload: unknown = await healthResponse.json();
    const modelsPayload: unknown = modelsResponse.ok ? await modelsResponse.json() : null;
    const kokoroPayload: unknown = kokoroResponse.ok ? await kokoroResponse.json() : null;
    const qwenPresetPayload: unknown = qwenPresetResponse.ok ? await qwenPresetResponse.json() : null;
    if (!Array.isArray(profilesPayload)) throw new Error('invalid profile list');
    if (!isVoiceboxHealth(healthPayload)) throw new Error('invalid health response');
    const profiles = profilesPayload.filter(isVoiceboxProfile);
    const modelCandidates = modelsPayload && typeof modelsPayload === 'object'
      ? (modelsPayload as { models?: unknown }).models
      : null;
    const models = Array.isArray(modelCandidates)
      ? modelCandidates.filter(isVoiceboxModelStatus)
      : [];
    const presetVoices = ([
      ['kokoro', kokoroPayload],
      ['qwen_custom_voice', qwenPresetPayload],
    ] as const).flatMap(([engine, payload]) => {
      const voices = payload && typeof payload === 'object'
        ? (payload as { voices?: unknown }).voices
        : null;
      return Array.isArray(voices)
        ? voices.filter(isVoiceboxPresetVoice).map((voice) => ({ ...voice, engine }))
        : [];
    });
    const wanted = config.profile.toLocaleLowerCase('fr');
    const resolvedProfile = config.profile
      ? profiles.find((profile) => profile.id === config.profile ||
          profile.name.toLocaleLowerCase('fr') === wanted)
      : undefined;
    return {
      available: config.profile ? Boolean(resolvedProfile) : true,
      baseUrl: config.baseUrl,
      ...(config.profile ? { configuredProfile: config.profile } : {}),
      ...(resolvedProfile ? { resolvedProfile } : {}),
      profiles,
      models,
      presetVoices,
      health: healthPayload,
      languages: VOICEBOX_LANGUAGES,
      engine: config.engine,
      ...(config.profile && !resolvedProfile
        ? { error: `Configured profile '${config.profile}' was not found` }
        : {}),
    };
  } catch (error) {
    const hint = voiceboxReachabilityHint(config.baseUrl);
    return {
      available: false,
      baseUrl: config.baseUrl,
      ...(config.profile ? { configuredProfile: config.profile } : {}),
      profiles: [],
      models: [],
      presetVoices: [],
      languages: VOICEBOX_LANGUAGES,
      engine: config.engine,
      error: error instanceof Error ? error.message : String(error),
      ...(hint ? { hint } : {}),
    };
  }
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
    const perTurnInstruct = options.instruct?.trim();
    const instruct = [perTurnInstruct, config.instruct]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .slice(0, 500);
    const body = {
      profile_id: profile.id,
      text: clean,
      language: config.language,
      seed: config.seed,
      model_size: config.modelSize,
      ...(instruct ? { instruct } : {}),
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

/** Buffer one bounded Voicebox response for preview, playback, or persistence. */
export async function renderVoiceboxWavBytes(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  options: VoiceboxRequestOptions = {}
): Promise<Uint8Array | null> {
  const config = resolveVoiceboxConfig(env, options.timeoutMs);
  const stream = await openVoiceboxAudioStream(text, env, options);
  if (!stream) return null;
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
        return null;
      }
      chunks.push(value);
    }
    if (total <= 44) return null;
    const audio = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
    return normalizePcm16Wav(audio, env, options.frozenFactor);
  } catch (error) {
    if (!options.signal?.aborted) {
      logger.debug(
        `[voicebox-tts] audio read failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return null;
  } finally {
    reader.releaseLock();
  }
}

/** Buffer one bounded Voicebox response into a normalized, private WAV file. */
export async function synthesizeVoiceboxWav(
  text: string,
  wavPath: string,
  env: NodeJS.ProcessEnv = process.env,
  options: VoiceboxRequestOptions = {}
): Promise<boolean> {
  const audio = await renderVoiceboxWavBytes(text, env, options);
  if (!audio) return false;
  await writeFile(wavPath, audio, { mode: 0o600 });
  return true;
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
