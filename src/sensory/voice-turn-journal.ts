/**
 * Voice-turn journal — every completed spoken turn leaves a trace.
 *
 * Until 24/09/2026 nothing Lisa heard and answered reached the audit trail or any log a human could
 * reread: a turn that ran an agent (and could act on the machine) was indistinguishable, after the
 * fact, from small talk. Charter principle 1 (honesty first) needs the opposite — whatever the robot
 * does on its own must be traceable before anything else is made autonomous.
 *
 * Two sinks, both best-effort and never-throwing:
 *   - a local append-only JSONL (`~/.codebuddy/lisa/voice-turns.jsonl`, mode 0600, rotated past
 *     5 MB) holding the exchange itself, for Lisa's owner only;
 *   - the security audit log, WITHOUT the words: route and sizes only, since the audit may be
 *     shipped or shared.
 * `CODEBUDDY_VOICE_TURN_LOG=false` disables the local file (the audit entry stays).
 *
 * @module sensory/voice-turn-journal
 */

import { appendFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { auditLogger } from '../security/audit-logger.js';
import { logger } from '../utils/logger.js';

/** Which path produced the spoken reply. `agent` is the one that may act on the machine. */
export type VoiceTurnRoute = 'shortcut' | 'selfie' | 'photo' | 'conversation' | 'agent';

export interface VoiceTurnRecord {
  heard: string;
  reply: string;
  route: VoiceTurnRoute;
}

const MAX_BYTES = 5 * 1024 * 1024;

export function voiceTurnLogPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.CODEBUDDY_VOICE_TURN_LOG?.trim();
  if (configured && ['false', '0', 'off', 'no'].includes(configured.toLowerCase())) return null;
  if (configured && path.isAbsolute(configured)) return configured;
  return path.join(homedir(), '.codebuddy', 'lisa', 'voice-turns.jsonl');
}

/**
 * Record one completed voice turn. A turn cut short by barge-in before completion is not a
 * completed turn and is not recorded here. Never throws.
 */
export function recordVoiceTurn(turn: VoiceTurnRecord, now: Date = new Date()): void {
  try {
    auditLogger.log({
      action: 'voice_turn',
      decision: 'allow',
      source: 'voice',
      target: turn.route,
      details: `heard=${turn.heard.length} chars, reply=${turn.reply.length} chars`,
    });
  } catch {
    /* the audit trail is best-effort here; the local journal still runs */
  }
  const file = voiceTurnLogPath();
  if (!file) return;
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (existsSync(file)) {
      // Tighten BEFORE writing: a pre-existing, looser file must not receive one more line first.
      chmodSync(file, 0o600);
      if (statSync(file).size > MAX_BYTES) {
        // Windows refuses to rename over an existing file; drop the previous generation first so
        // rotation cannot fail silently and let the journal grow without bound.
        rmSync(`${file}.1`, { force: true });
        renameSync(file, `${file}.1`);
      }
    }
    const line = JSON.stringify({
      ts: now.toISOString(),
      route: turn.route,
      heard: turn.heard,
      reply: turn.reply,
    });
    appendFileSync(file, `${line}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch (err) {
    logger.debug(`[voice-turn] journal write skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}
