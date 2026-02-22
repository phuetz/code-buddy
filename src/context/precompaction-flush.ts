/**
 * Pre-compaction Memory Flush — OpenClaw-inspired NO_REPLY pattern
 *
 * Before the context manager compacts (summarises/drops) old messages,
 * this module runs a silent background LLM turn that asks the model to
 * extract and save important facts to MEMORY.md.
 *
 * The `NO_REPLY` sentinel at the start of the response suppresses
 * user-facing delivery, preventing notification spam. Only the extracted
 * facts are written to disk; the LLM output is never shown to the user.
 *
 * This prevents the information loss that normally occurs when old turns
 * are summarised away or dropped from the context window.
 *
 * Ref: OpenClaw session management compaction docs
 * https://docs.openclaw.ai/reference/session-management-compaction
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface FlushMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface FlushResult {
  /** Whether any facts were extracted and saved */
  flushed: boolean;
  /** Number of fact lines saved */
  factsCount: number;
  /** Path written to (or null if nothing written) */
  writtenTo: string | null;
  /** Whether the LLM returned NO_REPLY sentinel */
  suppressed: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const NO_REPLY_SENTINEL = 'NO_REPLY';
const ACK_MAX_CHARS = 300;

const FLUSH_SYSTEM_PROMPT = `You are a memory archivist. Your ONLY job is to extract
important, durable facts from a conversation that is about to be compressed.

OUTPUT FORMAT:
- Start with exactly "${NO_REPLY_SENTINEL}" on the first line if there is nothing worth saving.
- Otherwise output a compact Markdown bullet list of facts to remember. Each bullet should be
  a self-contained statement under 120 chars. No meta-commentary. No repetition.

SAVE if: decisions made, user preferences stated, key file paths, API contracts,
architectural choices, project goals, error patterns discovered, credentials
configuration (NOT the secret values), important URLs.

SKIP if: small talk, debugging tangents, transient data, already-known facts.`;

// ============================================================================
// PrecompactionFlusher
// ============================================================================

export class PrecompactionFlusher {
  /** Run a silent flush before context compaction. */
  async flush(
    messages: FlushMessage[],
    /** Simple chat function: (messages) → string */
    chatFn: (msgs: FlushMessage[]) => Promise<string>,
    workDir: string = process.cwd()
  ): Promise<FlushResult> {
    if (messages.length < 4) {
      // Not enough history to bother flushing
      return { flushed: false, factsCount: 0, writtenTo: null, suppressed: false };
    }

    // Build a compact snapshot of the conversation to flush
    const snapshot = this.buildSnapshot(messages);

    const flushMessages: FlushMessage[] = [
      { role: 'system', content: FLUSH_SYSTEM_PROMPT },
      { role: 'user', content: `Conversation to analyse:\n\n${snapshot}` },
    ];

    let response: string;
    try {
      response = await chatFn(flushMessages);
    } catch (err) {
      logger.debug('PrecompactionFlusher: LLM call failed', { err });
      return { flushed: false, factsCount: 0, writtenTo: null, suppressed: false };
    }

    const trimmed = response.trim();

    // Detect NO_REPLY sentinel
    if (
      trimmed.startsWith(NO_REPLY_SENTINEL) &&
      trimmed.length - NO_REPLY_SENTINEL.length <= ACK_MAX_CHARS
    ) {
      return { flushed: false, factsCount: 0, writtenTo: null, suppressed: true };
    }

    // Strip NO_REPLY prefix if present with additional content
    const content = trimmed.startsWith(NO_REPLY_SENTINEL)
      ? trimmed.slice(NO_REPLY_SENTINEL.length).trim()
      : trimmed;

    if (!content) {
      return { flushed: false, factsCount: 0, writtenTo: null, suppressed: true };
    }

    // Save facts to MEMORY.md
    const writtenTo = await this.saveFacts(content, workDir);
    const factsCount = content.split('\n').filter(l => l.startsWith('-')).length;

    return { flushed: true, factsCount, writtenTo, suppressed: false };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private buildSnapshot(messages: FlushMessage[]): string {
    // Take last 60 messages at most, stripping tool call internals
    const slice = messages.slice(-60);
    return slice
      .filter(m => m.role !== 'system')
      .map(m => {
        const prefix = m.role === 'user' ? 'User' : 'Assistant';
        const body = typeof m.content === 'string'
          ? m.content.slice(0, 800)
          : '[non-text content]';
        return `**${prefix}:** ${body}`;
      })
      .join('\n\n---\n\n');
  }

  private async saveFacts(content: string, workDir: string): Promise<string | null> {
    const memoryPath = path.join(workDir, 'MEMORY.md');
    const datestamp = new Date().toISOString().split('T')[0];
    const header = `\n\n## Facts extracted ${datestamp} (pre-compaction flush)\n\n`;
    const block = header + content + '\n';

    try {
      fs.appendFileSync(memoryPath, block, 'utf-8');
      logger.debug('PrecompactionFlusher: facts saved', { memoryPath });
      return memoryPath;
    } catch (err) {
      // Try global fallback
      const globalPath = path.join(
        process.env.HOME ?? process.env.USERPROFILE ?? '~',
        '.codebuddy',
        'MEMORY.md'
      );
      try {
        fs.mkdirSync(path.dirname(globalPath), { recursive: true });
        fs.appendFileSync(globalPath, block, 'utf-8');
        return globalPath;
      } catch {
        logger.warn('PrecompactionFlusher: could not write facts to any location');
        return null;
      }
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: PrecompactionFlusher | null = null;

export function getPrecompactionFlusher(): PrecompactionFlusher {
  if (!_instance) _instance = new PrecompactionFlusher();
  return _instance;
}
