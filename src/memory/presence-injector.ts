/**
 * Presence Injector — Code Buddy core consumer of Cowork presence events.
 *
 * Reads the cross-process `~/.codebuddy/presence/current.json` file that
 * Cowork's `presence-bridge` writes whenever the camera detects (or
 * loses) someone. Surfaces the result as a `<presence>` block in the
 * agent's system prompt so the LLM can adapt its greeting register
 * naturally — "Bonjour Patrice" vs "Bonjour mon chéri" vs "Bonjour
 * (visage non reconnu)".
 *
 * Why file-based and not IPC: Cowork's main process and the Code Buddy
 * core agent run in *different Node processes*. A file is the simplest
 * cross-process channel that works across spawn modes (in-process /
 * subprocess / detached) and across hosts (the file can sit on a shared
 * mount when we move parts of the agent to GPU_NODE). IPC sockets would
 * require coupling the agent to Electron or to a specific transport.
 *
 * Stale file handling: if `updatedAt` is older than `STALE_AFTER_MS`,
 * we treat the presence as unknown — better to greet generically than
 * to claim "Patrice est là" when the webcam was last seen 30 minutes
 * ago.
 *
 * @module src/memory/presence-injector
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';

const PRESENCE_FILE = path.join(os.homedir(), '.codebuddy', 'presence', 'current.json');

/**
 * After this much time without an update from Cowork, we ignore the
 * file. 5 min is generous (a brief away should still match the lingering
 * presence) but short enough that yesterday's session doesn't leak in.
 */
const STALE_AFTER_MS = 5 * 60 * 1000;

/** Mirror of the Cowork-side type — kept narrow to avoid coupling. */
interface PresenceFileShape {
  updatedAt: number;
  match: {
    personId: string;
    name: string;
    aliases: string[];
    confidence: number;
    matchedAt: number;
  } | null;
  lastEventType: 'detected' | 'unknown' | 'left' | 'enrolled' | null;
}

export interface PresenceContext {
  /** True when somebody is (or was very recently) in front of the camera. */
  hasMatch: boolean;
  /** Display name for the matched person, undefined if unknown. */
  name?: string;
  /** Available register variants the LLM can pick from. */
  aliases?: string[];
  /** Cosine confidence, 0..1. Higher = more certain. */
  confidence?: number;
  /** True when Cowork detected somebody but didn't match any enrolled identity. */
  hasUnknownFace: boolean;
  /** Age of the presence info in ms — useful for the prompt to mention "il y a X minutes". */
  ageMs: number;
}

const EMPTY_CONTEXT: PresenceContext = {
  hasMatch: false,
  hasUnknownFace: false,
  ageMs: Infinity,
};

/**
 * Read the current presence state. Never throws — returns an empty
 * context on any error, including missing file (presence simply not
 * configured yet) and stale file (last seen too long ago).
 */
export async function readPresenceContext(): Promise<PresenceContext> {
  try {
    const raw = await fs.readFile(PRESENCE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as PresenceFileShape;
    const ageMs = Date.now() - parsed.updatedAt;

    if (ageMs > STALE_AFTER_MS) {
      return EMPTY_CONTEXT;
    }

    if (parsed.lastEventType === 'unknown') {
      return { hasMatch: false, hasUnknownFace: true, ageMs };
    }

    if (parsed.match) {
      return {
        hasMatch: true,
        name: parsed.match.name,
        aliases: parsed.match.aliases,
        confidence: parsed.match.confidence,
        hasUnknownFace: false,
        ageMs,
      };
    }

    return EMPTY_CONTEXT;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== 'ENOENT') {
      logger.warn?.(`[PresenceInjector] read failed: ${(err as Error).message}`);
    }
    return EMPTY_CONTEXT;
  }
}

/**
 * Format a `<presence>` block for the system prompt. Returns the empty
 * string when there's nothing useful to inject — caller can splice the
 * result unconditionally.
 *
 * The block is intentionally terse: the LLM has the conversational
 * register learned from history; we just give it the *fact* of who is
 * present, not a directive to use one alias over another. Trust the
 * model to pick the right tone — that's the whole point of letting it
 * see the alias list rather than hardcoding the greeting.
 */
export function formatPresenceBlock(ctx: PresenceContext): string {
  if (!ctx.hasMatch && !ctx.hasUnknownFace) return '';

  if (ctx.hasUnknownFace) {
    return [
      '<presence>',
      '  Une personne non reconnue est devant la caméra.',
      `  (Détection il y a ${formatAge(ctx.ageMs)}; pas de profil dans le presence-store.)`,
      '</presence>',
    ].join('\n');
  }

  const aliases = (ctx.aliases ?? []).join(', ');
  const aliasLine = aliases ? `  alias possibles: ${aliases}\n` : '';
  const conf = ctx.confidence !== undefined ? ` (confidence ${(ctx.confidence * 100).toFixed(0)}%)` : '';
  return [
    '<presence>',
    `  ${ctx.name} est devant la caméra${conf}.`,
    aliasLine + `  vu il y a ${formatAge(ctx.ageMs)}.`,
    '  Tu peux personnaliser ton ton et ton greeting en conséquence — choisis',
    '  le registre que la conversation suggère, sans surjouer.',
    '</presence>',
  ].join('\n');
}

function formatAge(ms: number): string {
  if (ms < 5_000) return 'à l\'instant';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} min`;
  return `${Math.round(ms / (60 * 60_000))} h`;
}

/**
 * Convenience wrapper: read + format in one call. The lifecycle hook
 * uses this so the injection site is one line.
 */
export async function injectPresenceBlock(): Promise<string> {
  const ctx = await readPresenceContext();
  return formatPresenceBlock(ctx);
}
