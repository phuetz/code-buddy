/**
 * Session-end flush (WS3-T1 — Mémoire & continuité du run).
 *
 * When a session ends, persist what the next run needs to not start from
 * zero:
 *  1. a short HANDOFF file (`.codebuddy/HANDOFF.md`) — last goal, last
 *     state, files touched, open risks — written synchronously so it also
 *     works from process `exit` handlers;
 *  2. reusable lesson candidates via the existing review-gated
 *     auto-proposer (PENDING only — a human approves them into lessons.md,
 *     which the per-turn `<lessons_context>` injection then re-injects on
 *     future runs).
 *
 * Guard-rails: trivial sessions are skipped (no LLM call, no file), and
 * everything written here passes the privacy lint first (PII/secret spans
 * are redacted from the handoff; tainted lesson candidates are dropped by
 * the proposer itself).
 *
 * @module agent/session-end-flush
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CodeBuddyClient } from '../codebuddy/client.js';
import { isFeatureEnabled } from '../config/feature-flags.js';
import { redactSecrets } from '../fleet/privacy-lint.js';
import { logger } from '../utils/logger.js';
import type { ChatEntry } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface SessionEndFlushInput {
  chatHistory: ChatEntry[];
  workDir?: string;
  /** Reuse the session's LLM client for the lesson proposal (no re-auth). */
  client?: CodeBuddyClient;
  sessionId?: string;
  /** Session start (ms epoch) — used for the duration line of the handoff. */
  startedAt?: number;
}

export interface SessionEndFlushResult {
  /** Lesson candidates enqueued for review (`buddy lessons` to approve). */
  proposedLessons: number;
  /** Absolute path of the handoff file, when one was (re)written. */
  handoffPath?: string;
  openRisks: string[];
  skipped?: 'disabled' | 'trivial';
}

// ============================================================================
// Gates & heuristics
// ============================================================================

/** Below this many assistant turns the session is too trivial to flush. */
const MIN_ASSISTANT_TURNS = 2;

/** Handoff is only worth writing past this transcript size (chars) … */
const HANDOFF_MIN_TRANSCRIPT_CHARS = 8_000;
/** … unless open risks were detected, which always deserve a handoff. */

const RISK_PATTERN = /\b(error|failed|failure|exception|denied|timeout|timed out|blocked|fatal|refused)\b/i;
const MAX_RISKS = 5;
const SNIPPET_MAX = 240;

function meaningfulTurns(history: ChatEntry[]): { assistant: number; tools: number } {
  let assistant = 0;
  let tools = 0;
  for (const e of history) {
    if (e.type === 'assistant' && e.content.trim()) assistant++;
    else if (e.type === 'tool_result') tools++;
  }
  return { assistant, tools };
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > SNIPPET_MAX ? `${line.slice(0, SNIPPET_MAX)}…` : line;
}

/**
 * Heuristic open-risk extraction: error-ish tool results, deduped per tool,
 * newest kept. No LLM involved — deterministic and free.
 */
export function extractOpenRisks(history: ChatEntry[]): string[] {
  const byKey = new Map<string, string>();
  for (const e of history) {
    if (e.type !== 'tool_result') continue;
    if (!RISK_PATTERN.test(e.content)) continue;
    const tool = e.toolCall?.function?.name || 'tool';
    byKey.set(tool, `\`${tool}\`: ${firstLine(redactSecrets(e.content))}`);
  }
  return [...byKey.values()].slice(-MAX_RISKS);
}

/** Files touched through write-ish tool calls, for the handoff. */
export function extractTouchedFiles(history: ChatEntry[]): string[] {
  const WRITE_TOOLS = new Set([
    'str_replace', 'str_replace_editor', 'create_file', 'write_file',
    'apply_patch', 'edit_file', 'text_editor',
  ]);
  const files = new Set<string>();
  for (const e of history) {
    const calls = e.toolCalls ?? (e.toolCall ? [e.toolCall] : []);
    for (const call of calls) {
      if (!call?.function?.name || !WRITE_TOOLS.has(call.function.name)) continue;
      try {
        const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        const p = args.path ?? args.file_path ?? args.filePath;
        if (typeof p === 'string' && p.trim()) files.add(p.trim());
      } catch { /* unparseable args — skip */ }
    }
  }
  return [...files].slice(0, 20);
}

// ============================================================================
// Handoff (sync — usable from process exit handlers)
// ============================================================================

let handoffWrittenFor: ChatEntry[] | null = null;

export interface HandoffOptions {
  sessionId?: string;
  startedAt?: number;
  /** Force a write even below the size threshold (used by tests). */
  force?: boolean;
}

/**
 * Write `.codebuddy/HANDOFF.md` synchronously. Returns the path when
 * written, undefined when the session didn't warrant one. Idempotent per
 * history array so the async flush and a process-exit fallback don't both
 * write.
 */
export function writeHandoffSync(
  history: ChatEntry[],
  workDir: string = process.cwd(),
  options: HandoffOptions = {},
): string | undefined {
  if (handoffWrittenFor === history) return undefined;

  const { assistant } = meaningfulTurns(history);
  if (assistant < MIN_ASSISTANT_TURNS) return undefined;

  const transcriptChars = history.reduce((n, e) => n + e.content.length, 0);
  const risks = extractOpenRisks(history);
  if (!options.force && transcriptChars < HANDOFF_MIN_TRANSCRIPT_CHARS && risks.length === 0) {
    return undefined;
  }

  const lastUser = [...history].reverse().find((e) => e.type === 'user' && e.content.trim());
  const lastAssistant = [...history].reverse().find((e) => e.type === 'assistant' && e.content.trim());
  const touched = extractTouchedFiles(history);
  const startedAt = options.startedAt;
  const durationMin = startedAt ? Math.round((Date.now() - startedAt) / 60_000) : undefined;

  const lines: string[] = [
    '# Session Handoff',
    '',
    `> Auto-generated at session end — latest session wins. Read this before resuming work.`,
    '',
    `- Date: ${new Date().toISOString()}`,
    ...(options.sessionId ? [`- Session: ${options.sessionId}`] : []),
    ...(durationMin !== undefined ? [`- Durée: ~${durationMin} min`] : []),
    `- Échanges: ${meaningfulTurns(history).assistant} réponses assistant, ${meaningfulTurns(history).tools} résultats d'outils`,
    '',
    '## Dernier objectif (utilisateur)',
    '',
    lastUser ? firstLine(redactSecrets(lastUser.content)) : '(aucun message utilisateur)',
    '',
    '## Dernier état (assistant)',
    '',
    lastAssistant ? redactSecrets(lastAssistant.content).trim().slice(0, 800) : '(aucune réponse)',
    '',
  ];

  if (touched.length > 0) {
    lines.push('## Fichiers touchés', '', ...touched.map((f) => `- \`${f}\``), '');
  }

  lines.push('## Risques ouverts', '');
  if (risks.length > 0) {
    lines.push(...risks.map((r) => `- ${r}`));
  } else {
    lines.push('- Aucun détecté.');
  }
  lines.push(
    '',
    '## Reprise',
    '',
    risks.length > 0
      ? '- Commencer par lever les risques ouverts ci-dessus.'
      : '- Continuer le dernier objectif, ou `buddy --continue` pour recharger la session.',
    '- Leçons en attente de revue : `buddy lessons` (candidats proposés en fin de session).',
    '',
  );

  const content = redactSecrets(lines.join('\n'));
  const dir = path.join(workDir, '.codebuddy');
  const target = path.join(dir, 'HANDOFF.md');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    handoffWrittenFor = history;
    return target;
  } catch (err) {
    logger.debug('[session-end-flush] handoff write failed', { err: String(err) });
    return undefined;
  }
}

// ============================================================================
// Full async flush (handoff + lesson proposal)
// ============================================================================

/**
 * Run the complete session-end flush. Safe to call from any exit path:
 * no-ops on trivial sessions, never throws.
 */
export async function runSessionEndFlush(
  input: SessionEndFlushInput,
): Promise<SessionEndFlushResult> {
  const empty: SessionEndFlushResult = { proposedLessons: 0, openRisks: [] };
  try {
    if (!isFeatureEnabled('SESSION_END_FLUSH')) {
      return { ...empty, skipped: 'disabled' };
    }
    const history = input.chatHistory ?? [];
    const { assistant } = meaningfulTurns(history);
    if (assistant < MIN_ASSISTANT_TURNS) {
      return { ...empty, skipped: 'trivial' };
    }

    const workDir = input.workDir ?? process.cwd();
    const openRisks = extractOpenRisks(history);
    const handoffPath = writeHandoffSync(history, workDir, {
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
    });

    // Lesson proposal last — it is the only step that may call an LLM, so a
    // killed process still leaves the handoff behind.
    let proposedLessons = 0;
    try {
      const { proposeLessonsFromSession } = await import('./lesson-auto-proposer.js');
      const proposed = await proposeLessonsFromSession(history, workDir, input.client);
      proposedLessons = proposed.length;
    } catch (err) {
      logger.debug('[session-end-flush] lesson proposal failed', { err: String(err) });
    }

    if (proposedLessons > 0 || handoffPath) {
      logger.info(
        `[session-end-flush] ${proposedLessons} lesson candidate(s) proposed` +
        (handoffPath ? `, handoff written to ${path.relative(workDir, handoffPath)}` : ''),
      );
    }

    return {
      proposedLessons,
      ...(handoffPath ? { handoffPath } : {}),
      openRisks,
    };
  } catch (err) {
    logger.debug('[session-end-flush] flush failed', { err: String(err) });
    return empty;
  }
}

/** Test hook: reset the per-history idempotence latch. */
export function resetSessionEndFlushState(): void {
  handoffWrittenFor = null;
}
