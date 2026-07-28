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

function reserveBudget(
  characters: number,
  cap: number,
  path: string,
  now: Date
): BudgetReservation | null {
  const lock = acquireLedgerLock(path, now);
  if (!lock) {
    logger.debug('[elevenlabs-voice] compteur occupé; repli sur la voix locale');
    return null;
  }
  const usage = loadCurrentUsage(path, now);
  if (!usage) {
    lock.release();
    logger.debug('[elevenlabs-voice] compteur indisponible; repli sur la voix locale');
    return null;
  }
  const reservationKey = `${path}:${usage.month}`;
  if (unwritableLedgers.has(reservationKey)) {
    lock.release();
    return null;
  }
  const inFlight = inFlightCharacters.get(reservationKey) ?? 0;
  if (usage.characters + inFlight + characters > cap) {
    warnCapOnce(path, usage, now);
    lock.release();
    return null;
  }
  // Confirm the ledger is writable before spending any credit. This writes the
  // same count, so failed HTTP syntheses are still never charged locally.
  usage.updatedAt = now.toISOString();
  if (!writeUsage(path, usage)) {
    unwritableLedgers.add(reservationKey);
    lock.release();
    logger.debug('[elevenlabs-voice] compteur non inscriptible; repli sur la voix locale');
    return null;
  }

  inFlightCharacters.set(reservationKey, inFlight + characters);
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
      lock.release();
    },
    commit: () => {
      if (settled) return;
      settled = true;
      releaseInFlight();
      try {
        const latest = loadCurrentUsage(path, now);
        if (!latest) return;
        latest.characters += characters;
        latest.updatedAt = now.toISOString();
        if (!writeUsage(path, latest)) {
          unwritableLedgers.add(`${path}:${latest.month}`);
          logger.debug('[elevenlabs-voice] écriture du compteur impossible');
        }
      } finally {
        lock.release();
      }
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
  const reservation = reserveBudget(
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

/** Test seam for process-global reservations/warning de-duplication. */
export function resetElevenLabsVoiceState(): void {
  inFlightCharacters.clear();
  warnedMonths.clear();
  unwritableLedgers.clear();
  usageWriteSequence = 0;
}
