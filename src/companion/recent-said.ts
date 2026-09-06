/**
 * Shared « what she already said » ring — voice + Telegram.
 * Opt-in with CODEBUDDY_COMPANION_PERSONA=copine (default off ⇒ no file, no skip).
 * Persisted at ~/.codebuddy/companion/recent-said.json via atomic-write, 7-day window.
 *
 * @module companion/recent-said
 */

import { homedir } from 'os';
import { join } from 'path';
import { isCopinePersona } from './personas/index.js';
import { openerKey } from './reply-augment.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

export type SaidChannel = 'voice' | 'telegram';

export interface RecentSaidEntry {
  opener: string;
  text: string;
  channel: SaidChannel;
  at: number;
}

export const RECENT_SAID_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RING_CAP = 32;

function defaultPath(): string {
  return (
    process.env.CODEBUDDY_COMPANION_RECENT_SAID_FILE ||
    join(homedir(), '.codebuddy', 'companion', 'recent-said.json')
  );
}

function isEntry(value: unknown): value is RecentSaidEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.opener === 'string' &&
    typeof rec.text === 'string' &&
    (rec.channel === 'voice' || rec.channel === 'telegram') &&
    typeof rec.at === 'number'
  );
}

export function pruneRecentSaid(entries: readonly RecentSaidEntry[], now: number): RecentSaidEntry[] {
  const floor = now - RECENT_SAID_WINDOW_MS;
  return entries.filter((entry) => entry.at >= floor).slice(-RING_CAP);
}

export function loadRecentSaid(statePath = defaultPath()): RecentSaidEntry[] {
  const data = readJsonAtomicSync<{ entries?: unknown } | unknown[] | null>(statePath, null, {
    mode: 0o600,
    isValid: (value): value is { entries?: unknown } | unknown[] =>
      Boolean(value && (Array.isArray(value) || typeof value === 'object')),
  });
  if (!data) return [];
  const raw = Array.isArray(data) ? data : Array.isArray(data.entries) ? data.entries : [];
  return raw.filter(isEntry);
}

export function saveRecentSaid(entries: readonly RecentSaidEntry[], statePath = defaultPath()): boolean {
  try {
    writeJsonAtomicSync(statePath, { entries }, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Record a spoken or Telegram line. No-op when the copine persona is off. Never throws. */
export function rememberSaid(
  text: string,
  channel: SaidChannel,
  now: number = Date.now(),
  statePath = defaultPath(),
  env: NodeJS.ProcessEnv = process.env,
): RecentSaidEntry[] {
  try {
    if (!isCopinePersona(env)) return [];
    const opener = openerKey(text);
    if (!opener) return loadRecentSaid(statePath);
    const next = pruneRecentSaid(
      [
        ...loadRecentSaid(statePath).filter((entry) => entry.opener !== opener),
        { opener, text, channel, at: now },
      ],
      now,
    );
    saveRecentSaid(next, statePath);
    return next;
  } catch {
    return [];
  }
}

export function recentOpeners(
  now: number = Date.now(),
  statePath = defaultPath(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  try {
    if (!isCopinePersona(env)) return [];
    return pruneRecentSaid(loadRecentSaid(statePath), now).map((entry) => entry.opener);
  } catch {
    return [];
  }
}

export function hasSaidOpener(
  opener: string,
  now: number = Date.now(),
  statePath = defaultPath(),
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!opener) return false;
  return recentOpeners(now, statePath, env).includes(opener);
}

/** Pick a line from `pool` whose opener is not in the shared ring. */
export function pickUnsaidLine(
  pool: readonly string[],
  opts: { rng?: () => number; now?: number; statePath?: string; env?: NodeJS.ProcessEnv; avoid?: string } = {},
): string {
  if (pool.length === 0) return '';
  const rng = opts.rng ?? Math.random;
  const now = opts.now ?? Date.now();
  const used = new Set(recentOpeners(now, opts.statePath, opts.env));
  const fresh = pool.filter((line) => !used.has(openerKey(line)) && line !== opts.avoid);
  const choices = fresh.length > 0 ? fresh : pool.filter((line) => line !== opts.avoid);
  const list = choices.length > 0 ? choices : pool;
  const idx = Math.min(list.length - 1, Math.floor(rng() * list.length));
  return list[idx] ?? '';
}
