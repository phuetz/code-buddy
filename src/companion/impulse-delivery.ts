/**
 * Deliver companion impulses across channels — the OpenClaw-style heartbeat gap.
 *
 * `buildCompanionImpulseBrief` already exists. Until this module, the brief
 * stayed on the CLI (`buddy companion impulses`). OpenClaw's advantage is that
 * the same kind of check arrives in chat without being asked.
 *
 * Opt-in: CODEBUDDY_COMPANION_IMPULSE_DELIVER=true
 * (also starts when CODEBUDDY_COMPANION_PROACTIVE=true).
 * Quiet hours respected. One high-priority impulse per cooldown.
 * Delivery: Telegram alert text + persisted companion channel history.
 *
 * @module companion/impulse-delivery
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';
import { logger } from '../utils/logger.js';
import {
  companionHistorySessionKey,
  rememberCompanionChannelTurn,
} from './channel-history.js';
import { buildCompanionImpulseBrief, type CompanionImpulse } from './impulses.js';
import { resolveHouseholdClock } from './household-time.js';

export const IMPULSE_DELIVER_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export interface ImpulseDeliveryState {
  lastSentAt?: number;
  lastImpulseId?: string;
}

export function isImpulseDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.CODEBUDDY_COMPANION_IMPULSE_DELIVER ?? '').trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off') return false;
  if (raw === 'true' || raw === '1' || raw === 'on') return true;
  return (env.CODEBUDDY_COMPANION_PROACTIVE ?? '').trim().toLowerCase() === 'true';
}

function statePath(env: NodeJS.ProcessEnv): string {
  return (
    env.CODEBUDDY_COMPANION_IMPULSE_DELIVER_STATE?.trim() ||
    join(homedir(), '.codebuddy', 'companion', 'impulse-delivery.json')
  );
}

function isQuietHour(hour: number, env: NodeJS.ProcessEnv): boolean {
  const spec = env.CODEBUDDY_COMPANION_QUIET || '22-8';
  const m = spec.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return false;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function loadImpulseDeliveryState(
  env: NodeJS.ProcessEnv = process.env,
): ImpulseDeliveryState {
  const stored = readJsonAtomicSync<ImpulseDeliveryState | null>(statePath(env), null, {
    mode: 0o600,
    isValid: (value): value is ImpulseDeliveryState =>
      Boolean(value && typeof value === 'object' && !Array.isArray(value)),
  });
  return stored ?? {};
}

export function saveImpulseDeliveryState(
  state: ImpulseDeliveryState,
  env: NodeJS.ProcessEnv = process.env,
): void {
  try {
    writeJsonAtomicSync(statePath(env), state, { mode: 0o600 });
  } catch (err) {
    logger.warn('[impulse-delivery] could not persist state', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function pickDeliverableImpulse(
  impulses: CompanionImpulse[],
  lastImpulseId?: string,
): CompanionImpulse | null {
  return (
    impulses.find((impulse) => impulse.priority === 'high' && impulse.id !== lastImpulseId) ??
    impulses.find((impulse) => impulse.id !== lastImpulseId) ??
    null
  );
}

export function formatImpulseForChannel(impulse: CompanionImpulse): string {
  return impulse.message.trim() || impulse.title.trim();
}

export interface ImpulseDeliveryDeps {
  now?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  send?: (text: string) => Promise<boolean>;
}

export async function runImpulseDeliveryTick(
  deps: ImpulseDeliveryDeps = {},
): Promise<CompanionImpulse | null> {
  const env = deps.env ?? process.env;
  if (!isImpulseDeliveryEnabled(env)) return null;

  const now = deps.now ?? Date.now();
  const hour = resolveHouseholdClock(new Date(now)).hour;
  if (isQuietHour(hour, env)) return null;

  const state = loadImpulseDeliveryState(env);
  const cooldown = Number(env.CODEBUDDY_COMPANION_IMPULSE_COOLDOWN_MS) || IMPULSE_DELIVER_COOLDOWN_MS;
  if (state.lastSentAt && now - state.lastSentAt < cooldown) return null;

  const brief = await buildCompanionImpulseBrief({
    cwd: deps.cwd,
    now: new Date(now),
    recordSuggestions: false,
  });
  const impulse = pickDeliverableImpulse(brief.impulses, state.lastImpulseId);
  if (!impulse) return null;

  const text = formatImpulseForChannel(impulse);
  if (!text) return null;

  const send =
    deps.send ??
    (async (line: string) => {
      try {
        const { sendTelegramAlert } = await import('../sensory/alert.js');
        return sendTelegramAlert(line);
      } catch {
        return false;
      }
    });

  const delivered = await send(text);
  rememberCompanionChannelTurn(
    companionHistorySessionKey({ env }),
    '[impulsion]',
    text,
    env,
    now,
  );
  saveImpulseDeliveryState({ lastSentAt: now, lastImpulseId: impulse.id }, env);

  logger.info('[impulse-delivery] reached out', {
    id: impulse.id,
    kind: impulse.kind,
    delivered,
  });
  return impulse;
}

export function wireImpulseDelivery(deps: ImpulseDeliveryDeps = {}): () => void {
  const env = deps.env ?? process.env;
  if (!isImpulseDeliveryEnabled(env)) return () => undefined;
  const tickMs = Number(env.CODEBUDDY_COMPANION_IMPULSE_TICK_MS) || 900_000;
  const timer = setInterval(() => {
    void runImpulseDeliveryTick(deps);
  }, tickMs);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info(`[impulse-delivery] armed (tick ${Math.round(tickMs / 1000)}s)`);
  return () => clearInterval(timer);
}
