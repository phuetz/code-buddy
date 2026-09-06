/**
 * Short, bounded companion memory for the mobile PWA.
 *
 * The WebSocket companion turn used to hand an EMPTY history to the model on
 * every message: the selfie arrived, then « Encore une ? » was answered as if
 * nothing had been said. This module holds the last turns per connection and,
 * opt-out, across a reconnection (a phone drops its socket constantly).
 *
 * Two invariants:
 *   - image bytes NEVER enter the history (only a `kind: 'selfie'` marker);
 *   - the file name is a hash of the JWT user id, so no identity is written in
 *     clear and a traversal-shaped id cannot escape the directory.
 *
 * MEM1: state goes through `utils/atomic-write`.
 *
 * @module companion/mobile-history
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';
import { logger } from '../utils/logger.js';
import type { CompanionHistoryTurn } from './companion-turn.js';

/** user+assistant entries kept, all surfaces. */
export const MOBILE_HISTORY_MAX_TURNS = 20;
/** A single stored turn is capped so a pasted wall of text cannot grow the file. */
export const MOBILE_HISTORY_TURN_CHAR_CAP = 2000;

function sanitizeTurn(turn: CompanionHistoryTurn): CompanionHistoryTurn | null {
  if (turn.role !== 'user' && turn.role !== 'assistant') return null;
  if (typeof turn.content !== 'string') return null;
  const content = turn.content.trim().slice(0, MOBILE_HISTORY_TURN_CHAR_CAP);
  if (!content) return null;
  return turn.kind === 'selfie'
    ? { role: turn.role, content, kind: 'selfie' }
    : { role: turn.role, content };
}

/** Append turns, dropping empties, keeping the last {@link MOBILE_HISTORY_MAX_TURNS}. */
export function appendCompanionHistory(
  history: readonly CompanionHistoryTurn[],
  turns: readonly CompanionHistoryTurn[],
): CompanionHistoryTurn[] {
  const appended = turns
    .map(sanitizeTurn)
    .filter((turn): turn is CompanionHistoryTurn => turn !== null);
  return [...history, ...appended].slice(-MOBILE_HISTORY_MAX_TURNS);
}

/** Opt-out: persistence is ON unless `CODEBUDDY_MOBILE_HISTORY=false`. */
export function isMobileHistoryPersistenceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.CODEBUDDY_MOBILE_HISTORY ?? '').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

export function resolveMobileHistoryDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEBUDDY_MOBILE_HISTORY_DIR?.trim();
  if (configured) return configured;
  return path.join(os.homedir(), '.codebuddy', 'companion', 'mobile-history');
}

/**
 * The file backing one identity, or null when there is no usable id. The id is
 * hashed: it never lands in the file name, and `../..` cannot escape the dir.
 */
export function resolveMobileHistoryFile(
  userId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const id = (userId ?? '').trim();
  if (!id) return null;
  const digest = createHash('sha256').update(id).digest('hex').slice(0, 32);
  return path.join(resolveMobileHistoryDir(env), `${digest}.json`);
}

function isStoredHistory(value: unknown): value is { turns: CompanionHistoryTurn[] } {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Array.isArray((value as { turns?: unknown }).turns),
  );
}

export function loadMobileCompanionHistory(
  userId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): CompanionHistoryTurn[] {
  if (!isMobileHistoryPersistenceEnabled(env)) return [];
  const file = resolveMobileHistoryFile(userId, env);
  if (!file) return [];
  try {
    const stored = readJsonAtomicSync<{ turns: CompanionHistoryTurn[] } | null>(file, null, {
      mode: 0o600,
      isValid: (value): value is { turns: CompanionHistoryTurn[] } => isStoredHistory(value),
    });
    if (!stored) return [];
    return appendCompanionHistory([], stored.turns);
  } catch {
    return [];
  }
}

export function saveMobileCompanionHistory(
  userId: string | undefined,
  history: readonly CompanionHistoryTurn[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isMobileHistoryPersistenceEnabled(env)) return;
  const file = resolveMobileHistoryFile(userId, env);
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeJsonAtomicSync(
      file,
      { turns: appendCompanionHistory([], history) },
      { mode: 0o600 },
    );
  } catch (err) {
    logger.warn('[mobile-history] could not persist the companion history', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
