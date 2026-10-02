/**
 * Pre-compaction Memory Flush — Enterprise-grade NO_REPLY pattern
 *
 * Before the context manager compacts (summarises/drops) old messages,
 * this module runs a silent background LLM turn that asks the model to
 * extract and save important facts to private, workspace-scoped profile memory.
 *
 * The `NO_REPLY` sentinel at the start of the response suppresses
 * user-facing delivery, preventing notification spam. Only the extracted
 * facts are written to disk; the LLM output is never shown to the user.
 *
 * This prevents the information loss that normally occurs when old turns
 * are summarised away or dropped from the context window.
 *
 * Ref: Native Engine session management compaction docs
 * https://docs.Native Engine.ai/reference/session-management-compaction
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { getCodeBuddyHome } from '../utils/codebuddy-home.js';

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

const FLUSH_SYSTEM_PROMPT_BASE = `You are a memory archivist. Your ONLY job is to extract
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
  /**
   * Build the full flush system prompt, including decision extraction
   * instructions when the DecisionMemory module is available.
   */
  private async buildFlushPrompt(): Promise<string> {
    try {
      const { getDecisionMemory } = await import('../memory/decision-memory.js');
      const decisionMemory = getDecisionMemory();
      const enhancement = decisionMemory.getDecisionPromptEnhancement();
      return FLUSH_SYSTEM_PROMPT_BASE + '\n\n' + enhancement;
    } catch {
      return FLUSH_SYSTEM_PROMPT_BASE;
    }
  }

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

    const systemPrompt = await this.buildFlushPrompt();

    const flushMessages: FlushMessage[] = [
      { role: 'system', content: systemPrompt },
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

    // Extract and persist decisions from the response (fire-and-forget)
    this.extractAndPersistDecisions(trimmed);

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

    // Automatic memory is profile state, never a source file in a public repo.
    const writtenTo = await this.saveFacts(content, workDir);
    const factsCount = content.split('\n').filter(l => l.startsWith('-')).length;

    return { flushed: writtenTo !== null, factsCount: writtenTo ? factsCount : 0, writtenTo, suppressed: false };
  }

  /**
   * Extract decision blocks from the LLM response and persist them.
   * Errors are swallowed to avoid disrupting the flush flow.
   */
  private async extractAndPersistDecisions(response: string): Promise<void> {
    try {
      const { getDecisionMemory } = await import('../memory/decision-memory.js');
      const decisionMemory = getDecisionMemory();
      const { decisions } = decisionMemory.extractDecisions(response);
      if (decisions.length > 0) {
        await decisionMemory.persistDecisions(decisions);
        logger.debug('PrecompactionFlusher: persisted decisions', { count: decisions.length });
      }
    } catch (err) {
      logger.debug('PrecompactionFlusher: decision extraction failed', { err });
    }
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
    const datestamp = new Date().toISOString().split('T')[0];
    const header = `\n\n## Facts extracted ${datestamp} (pre-compaction flush)\n\n`;
    const block = header + content + '\n';

    try {
      let canonicalWorkspace = path.resolve(workDir);
      try { canonicalWorkspace = fs.realpathSync(canonicalWorkspace); } catch { /* Workspace may not exist yet. */ }
      const workspaceId = createHash('sha256').update(canonicalWorkspace).digest('hex');
      const profile = path.resolve(getCodeBuddyHome());
      fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
      // The configured profile itself may be an operator-selected symlink.
      // Its memory descendants must be real directories, not repo-controlled redirects.
      let directory = fs.realpathSync(profile);
      for (const component of ['memory', 'precompaction', workspaceId]) {
        directory = path.join(directory, component);
        try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe memory directory');
        if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
      }
      const memoryPath = path.join(directory, 'MEMORY.md');
      try {
        if (fs.lstatSync(memoryPath).isSymbolicLink()) throw new Error('Unsafe memory link');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const descriptor = fs.openSync(memoryPath, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
      try {
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile() || stat.nlink !== 1) throw new Error('Unsafe memory file');
        if (process.platform !== 'win32') fs.fchmodSync(descriptor, 0o600);
        fs.writeFileSync(descriptor, block, 'utf-8');
      } finally { fs.closeSync(descriptor); }
      logger.debug('PrecompactionFlusher: facts saved', { memoryPath });
      return memoryPath;
    } catch (_err) {
      logger.warn('PrecompactionFlusher: could not write facts to the private profile');
      return null;
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
