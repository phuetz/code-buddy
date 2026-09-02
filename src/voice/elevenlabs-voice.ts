/**
 * ElevenLabs synthesis for Lisa's resident voice, guarded by a persistent
 * robot-only monthly character budget.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { logger } from '../utils/logger.js';
import {
  DEFAULT_ELEVENLABS_MODEL,
  requestElevenLabsSpeech,
  requestElevenLabsSpeechStream,
} from '../talk-mode/providers/elevenlabs-client.js';

export const DEFAULT_ELEVENLABS_MONTHLY_CAP = 200_000;
export const DEFAULT_ELEVENLABS_TIMEOUT_MS = 6_000;
export const ELEVENLABS_VOICE_OUTPUT_FORMAT = 'pcm_24000';

interface ElevenLabsVoiceUsage {
  version: 1;
  month: string;
  characters: number;
  warned: boolean;
  updatedAt: string;
}

interface BudgetReservation {
  commit: () => void;
  release: () => void;
}

interface LedgerLock {
  release: () => void;
}

export interface ElevenLabsVoiceSynthesisOptions {
  now?: () => Date;
  fetchImpl?: typeof fetch;
  usagePath?: string;
}

/**
 * Réglages de rendu ElevenLabs de la voix du robot, depuis l'environnement
 * (voix plus douce, plus stable, plus lente…). Aucune variable ⇒ `undefined`
 * ⇒ le corps de requête reste identique à avant (byte-identical).
 */
export function resolveElevenLabsVoiceSettings(
  env: NodeJS.ProcessEnv = process.env,
): { stability?: number; similarityBoost?: number; style?: number; useSpeakerBoost?: boolean; speed?: number } | undefined {
  const num = (key: string, min: number, max: number): number | undefined => {
    const raw = env[key]?.trim();
    if (!raw) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined;
  };
  const boolRaw = env.CODEBUDDY_ELEVENLABS_SPEAKER_BOOST?.trim().toLowerCase();
  const useSpeakerBoost = boolRaw === undefined || boolRaw === '' ? undefined : boolRaw !== 'false' && boolRaw !== '0';
  const settings = {
    stability: num('CODEBUDDY_ELEVENLABS_STABILITY', 0, 1),
    similarityBoost: num('CODEBUDDY_ELEVENLABS_SIMILARITY', 0, 1),
    style: num('CODEBUDDY_ELEVENLABS_STYLE', 0, 1),
    useSpeakerBoost,
    speed: num('CODEBUDDY_ELEVENLABS_SPEED', 0.7, 1.2),
  };
  const defined = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined));
  return Object.keys(defined).length > 0 ? defined : undefined;
}

/** Signature courte des réglages, pour que le cache TTS distingue deux rendus. */
export function elevenLabsVoiceSettingsSignature(env: NodeJS.ProcessEnv = process.env): string {
  const s = resolveElevenLabsVoiceSettings(env);
  if (!s) return '';
  return Object.entries(s).map(([k, v]) => `${k}=${v}`).join(',');
}

const inFlightCharacters = new Map<string, number>();
const warnedMonths = new Set<string>();
const unwritableLedgers = new Set<string>();
let usageWriteSequence = 0;
const STALE_LEDGER_LOCK_MS = 30_000;

function currentMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

function usagePath(
  env: NodeJS.ProcessEnv,
  override: string | undefined
): string {
  if (override) return override;
  const codeBuddyHome =
    env.CODEBUDDY_HOME?.trim() ||
    env.GROK_HOME?.trim() ||
    join(homedir(), '.codebuddy');
  return join(codeBuddyHome, 'elevenlabs-voice-usage.json');
}

function blankUsage(month: string, now: Date): ElevenLabsVoiceUsage {
  return {
    version: 1,
    month,
    characters: 0,
    warned: false,
    updatedAt: now.toISOString(),
  };
}

function parseUsage(path: string): ElevenLabsVoiceUsage | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ElevenLabsVoiceUsage>;
    if (
      parsed.version !== 1 ||
      typeof parsed.month !== 'string' ||
      typeof parsed.characters !== 'number' ||
      !Number.isInteger(parsed.characters) ||
      parsed.characters < 0 ||
      typeof parsed.warned !== 'boolean' ||
      typeof parsed.updatedAt !== 'string'
    ) {
      return null;
    }
    return parsed as ElevenLabsVoiceUsage;
  } catch {
    return null;
  }
}

function writeUsage(path: string, usage: ElevenLabsVoiceUsage): boolean {
  const temporary = `${path}.${process.pid}.${++usageWriteSequence}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(temporary, `${JSON.stringify(usage, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporary, path);
    return true;
  } catch {
    try {
      rmSync(temporary, { force: true });
    } catch {
      /* best-effort cleanup */
    }
    return false;
  }
}

/**
 * Cross-process fail-fast lock. A concurrent robot process falls back locally
 * instead of waiting or risking two requests spending the same remaining cap.
 */
function acquireLedgerLock(path: string, now: Date): LedgerLock | null {
  const lockPath = `${path}.lock`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  } catch {
    return null;
  }

  const open = (): number | null => {
    try {
      return openSync(lockPath, 'wx', 0o600);
    } catch {
      return null;
    }
  };
  let descriptor = open();
  if (descriptor === null) {
    try {
      if (now.getTime() - statSync(lockPath).mtimeMs > STALE_LEDGER_LOCK_MS) {
        rmSync(lockPath, { force: true });
        descriptor = open();
      }
    } catch {
      return null;
    }
  }
  if (descriptor === null) return null;

  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      try {
        closeSync(descriptor);
      } catch {
        /* already closed */
      }
      try {
        rmSync(lockPath, { force: true });
      } catch {
        /* a stale lock will be reclaimed later */
      }
    },
  };
}

/**
 * Load the current month and persist a reset on month rollover. A corrupt or
 * unwritable ledger fails closed for ElevenLabs (local speech remains available).
 */
function loadCurrentUsage(path: string, now: Date): ElevenLabsVoiceUsage | null {
  const month = currentMonth(now);
  if (!existsSync(path)) {
    const fresh = blankUsage(month, now);
    return writeUsage(path, fresh) ? fresh : null;
  }
  const usage = parseUsage(path);
  if (!usage) return null;
  if (usage.month === month) return usage;
  const reset = blankUsage(month, now);
  return writeUsage(path, reset) ? reset : null;
}

export function resolveElevenLabsMonthlyCap(env: NodeJS.ProcessEnv): number {
  const raw = env.CODEBUDDY_ELEVENLABS_MONTHLY_CAP?.trim();
  if (!raw) return DEFAULT_ELEVENLABS_MONTHLY_CAP;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : DEFAULT_ELEVENLABS_MONTHLY_CAP;
}

function warnCapOnce(
  path: string,
  usage: ElevenLabsVoiceUsage,
  now: Date
): void {
  const warningKey = `${path}:${usage.month}`;
  if (usage.warned || warnedMonths.has(warningKey)) return;
  warnedMonths.add(warningKey);
  usage.warned = true;
  usage.updatedAt = now.toISOString();
  writeUsage(path, usage);
  logger.warn(
    `[elevenlabs-voice] plafond mensuel atteint pour ${usage.month}; repli sur la voix locale`
  );
}

const LEDGER_LOCK_RETRY_MS = 25;

/**
 * Run `fn` under the ledger lock, retrying briefly while another writer holds
 * it. The critical sections below are a read + a write of a tiny JSON file
 * (milliseconds), so a short wait replaces the old fail-fast refusal.
 */
async function withLedgerLock<T>(
  path: string,
  now: Date,
  attempts: number,
  fn: () => T
): Promise<{ ok: true; value: T } | { ok: false }> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const lock = acquireLedgerLock(path, now);
    if (lock) {
      try {
        return { ok: true, value: fn() };
      } finally {
        lock.release();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, LEDGER_LOCK_RETRY_MS));
  }
  return { ok: false };
}

/**
 * Reserve `characters` against the monthly cap. The ledger lock is held ONLY
 * while the counter is read and written — never across the network request.
 * Until 2026-09-02 the lock lived for the whole HTTP head (up to 6 s): any
 * overlapping synthesis in the same process (the next sentence's look-ahead, a
 * Telegram voice note, a reminder) was refused as "compteur occupé" in
 * `debug`, surfaced upstream as "budget, clé ou réseau", and the phrase fell
 * to the local engine — or to silence. In-flight characters are tracked
 * in-process so concurrent reservations still add up against the cap.
 */
async function reserveBudget(
  characters: number,
  cap: number,
  path: string,
  now: Date
): Promise<BudgetReservation | null> {
  let refusal: string | null = null;
  let reservationKey = '';
  const reserved = await withLedgerLock(path, now, 8, () => {
    const usage = loadCurrentUsage(path, now);
    if (!usage) {
      refusal = 'compteur indisponible';
      return false;
    }
    reservationKey = `${path}:${usage.month}`;
    if (unwritableLedgers.has(reservationKey)) {
      refusal = 'compteur non inscriptible';
      return false;
    }
    const inFlight = inFlightCharacters.get(reservationKey) ?? 0;
    if (usage.characters + inFlight + characters > cap) {
      warnCapOnce(path, usage, now);
      refusal = 'plafond mensuel';
      return false;
    }
    // Confirm the ledger is writable before spending any credit. This writes the
    // same count, so failed HTTP syntheses are still never charged locally.
    usage.updatedAt = now.toISOString();
    if (!writeUsage(path, usage)) {
      unwritableLedgers.add(reservationKey);
      refusal = 'compteur non inscriptible';
      return false;
    }
    inFlightCharacters.set(reservationKey, inFlight + characters);
    return true;
  });
  if (!reserved.ok) {
    logger.warn('[elevenlabs-voice] compteur verrouillé par un autre processus; repli sur la voix locale');
    return null;
  }
  if (!reserved.value) {
    if (refusal !== 'plafond mensuel') {
      logger.warn(`[elevenlabs-voice] ${refusal}; repli sur la voix locale`);
    }
    return null;
  }

  let settled = false;
  const releaseInFlight = (): void => {
    const remaining = Math.max(
      0,
      (inFlightCharacters.get(reservationKey) ?? characters) - characters
    );
    if (remaining === 0) inFlightCharacters.delete(reservationKey);
    else inFlightCharacters.set(reservationKey, remaining);
  };

  return {
    release: () => {
      if (settled) return;
      settled = true;
      releaseInFlight();
    },
    commit: () => {
      if (settled) return;
      settled = true;
      releaseInFlight();
      // ElevenLabs billed these characters the moment the head arrived: the
      // ledger must record them even if another writer is briefly busy.
      void withLedgerLock(path, now, 40, () => {
        const latest = loadCurrentUsage(path, now);
        if (!latest) return;
        latest.characters += characters;
        latest.updatedAt = now.toISOString();
        if (!writeUsage(path, latest)) {
          unwritableLedgers.add(`${path}:${latest.month}`);
          logger.warn('[elevenlabs-voice] écriture du compteur impossible');
        }
      }).then((result) => {
        if (!result.ok) {
          logger.warn(`[elevenlabs-voice] compteur occupé trop longtemps: ${characters} caractères facturés non consignés`);
        }
      });
    },
  };
}

/**
 * Synthesize raw signed 16-bit little-endian mono PCM at 24 kHz. Returns null
 * for every failure so callers can immediately use Pocket/Piper.
 */
export async function synthesizeElevenLabsPcm24k(
  text: string,
  voiceId: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  options: ElevenLabsVoiceSynthesisOptions = {}
): Promise<Buffer | null> {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    logger.debug('[elevenlabs-voice] clé absente; repli sur la voix locale');
    return null;
  }

  const now = options.now?.() ?? new Date();
  const path = usagePath(env, options.usagePath);
  const reservation = await reserveBudget(
    text.length,
    resolveElevenLabsMonthlyCap(env),
    path,
    now
  );
  if (!reservation) return null;

  try {
    const response = await requestElevenLabsSpeech({
      apiKey,
      voiceId,
      text,
      modelId: env.CODEBUDDY_ELEVENLABS_MODEL?.trim() || DEFAULT_ELEVENLABS_MODEL,
      outputFormat: ELEVENLABS_VOICE_OUTPUT_FORMAT,
      ...(resolveElevenLabsVoiceSettings(env) ? { voiceSettings: resolveElevenLabsVoiceSettings(env) } : {}),
      signal,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    reservation.commit();
    return response.audio;
  } catch (error) {
    reservation.release();
    logger.debug(
      `[elevenlabs-voice] synthèse indisponible; repli local (${error instanceof Error ? error.name : 'erreur'})`
    );
    return null;
  }
}

/**
 * Open the native ElevenLabs chunked PCM stream (`/stream?output_format=pcm_24000`).
 *
 * Resolves as soon as the response headers arrive, so the caller can pipe the
 * first PCM frames to a player while ElevenLabs is still synthesizing — the
 * fluidity counterpart of {@link synthesizeElevenLabsPcm24k}, under the SAME
 * monthly character budget. Returns `null` for every failure (no key, cap
 * reached, busy ledger, HTTP error, timeout) so callers immediately use the
 * local engines instead.
 *
 * Budget semantics: the reservation is COMMITTED once the request is accepted
 * (HTTP 200) because ElevenLabs bills the characters at generation start — a
 * barge-in that cancels the body mid-way was still charged upstream, so the
 * local ledger must reflect it. `timeoutMs` bounds the wait for the response
 * HEAD only; the caller's `signal` keeps governing the body for its lifetime.
 */
export async function openElevenLabsPcm24kStream(
  text: string,
  voiceId: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal | undefined,
  options: ElevenLabsVoiceSynthesisOptions & { timeoutMs?: number } = {}
): Promise<ReadableStream<Uint8Array> | null> {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    logger.debug('[elevenlabs-voice] clé absente; repli sur la voix locale');
    return null;
  }
  if (signal?.aborted) return null;

  const now = options.now?.() ?? new Date();
  const path = usagePath(env, options.usagePath);
  const reservation = await reserveBudget(
    text.length,
    resolveElevenLabsMonthlyCap(env),
    path,
    now
  );
  if (!reservation) return null;

  // The head timeout must abort a hung connection, but must NOT abort the body
  // after headers arrived — so it lives on a dedicated controller that also
  // relays the caller's barge-in signal for the whole stream lifetime.
  const controller = new AbortController();
  const onCallerAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timeoutMs = options.timeoutMs ?? DEFAULT_ELEVENLABS_TIMEOUT_MS;
  const headTimer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await requestElevenLabsSpeechStream({
      apiKey,
      voiceId,
      text,
      modelId: env.CODEBUDDY_ELEVENLABS_MODEL?.trim() || DEFAULT_ELEVENLABS_MODEL,
      outputFormat: ELEVENLABS_VOICE_OUTPUT_FORMAT,
      ...(resolveElevenLabsVoiceSettings(env) ? { voiceSettings: resolveElevenLabsVoiceSettings(env) } : {}),
      signal: controller.signal,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    reservation.commit();
    return response.body;
  } catch (error) {
    signal?.removeEventListener('abort', onCallerAbort);
    reservation.release();
    // The exact cause (HTTP status, head timeout, transport) is what an
    // operator needs to act on; hiding it in `debug` left the robot mute with
    // a generic "budget, clé ou réseau" upstream (2026-09-02). A barge-in is
    // not a failure and stays quiet.
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (signal?.aborted) {
      logger.debug(`[elevenlabs-voice] flux interrompu par l'appelant (${detail})`);
    } else {
      logger.warn(`[elevenlabs-voice] flux indisponible — ${detail}; repli local`);
    }
    return null;
  } finally {
    clearTimeout(headTimer);
  }
}

/** Test seam for process-global reservations/warning de-duplication. */
export function resetElevenLabsVoiceState(): void {
  inFlightCharacters.clear();
  warnedMonths.clear();
  unwritableLedgers.clear();
  usageWriteSequence = 0;
}
