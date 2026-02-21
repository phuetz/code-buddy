/**
 * Restorable Compression — Manus AI context engineering pattern
 *
 * Instead of lossy summarisation (which discards content permanently),
 * this module extracts structural identifiers (file paths, URLs, tool
 * call IDs, line ranges) from messages that are about to be dropped,
 * then stores the original content indexed by those identifiers.
 *
 * The agent can later call `restore_context(identifier)` to re-fetch
 * the full content on demand, making context compression reversible.
 *
 * This is complementary to summarisation: a short summary of a long
 * file-read result is kept in the context, while the full content is
 * recoverable via its file path identifier.
 *
 * Ref: "Context Engineering for AI Agents: Lessons from Building Manus"
 * https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface CompressibleMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  name?: string;
}

export interface CompressionResult {
  /** Compressed messages (identifiers preserved, full content dropped) */
  messages: CompressibleMessage[];
  /** Identifiers that were extracted and stored */
  identifiers: string[];
  /** Number of tokens saved (estimated) */
  tokensSaved: number;
}

export interface RestoreResult {
  found: boolean;
  content: string;
  identifier: string;
}

// ============================================================================
// Identifier extractors
// ============================================================================

// File paths: absolute or relative, with extensions
const FILE_PATH_RE = /(?:^|\s|["'`(])(\/?(?:[\w.-]+\/)*[\w.-]+\.(?:ts|js|py|json|md|txt|yaml|yml|sh|go|rs|java|cpp|c|h|rb|php|swift|kt|cs|html|css|sql|env|toml|cfg|conf|xml)(?::\d+(?:-\d+)?)?)/g;

// URLs
const URL_RE = /https?:\/\/[^\s"'<>)]+/g;

// Tool call IDs (Anthropic/OpenAI style)
const TOOL_CALL_ID_RE = /\b(call_[a-zA-Z0-9]+|toolu_[a-zA-Z0-9]+)\b/g;

function extractIdentifiers(text: string): string[] {
  const ids = new Set<string>();

  for (const m of text.matchAll(FILE_PATH_RE)) {
    const raw = m[1].trim().replace(/['"`:]/g, '');
    if (raw.length > 3) ids.add(raw);
  }

  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;)]+$/, ''); // strip trailing punctuation
    ids.add(url);
  }

  for (const m of text.matchAll(TOOL_CALL_ID_RE)) {
    ids.add(m[1]);
  }

  return [...ids];
}

// ============================================================================
// RestorableCompressor
// ============================================================================

export class RestorableCompressor {
  /** identifier → original content */
  private store = new Map<string, string>();

  /**
   * Compress a slice of messages that are about to be dropped.
   *
   * For each message, identifiers are extracted and the full content is
   * stored. The message content is replaced with a compact stub listing
   * the available identifiers.
   */
  compress(messages: CompressibleMessage[]): CompressionResult {
    const compressed: CompressibleMessage[] = [];
    const allIdentifiers: string[] = [];
    let tokensSaved = 0;

    for (const msg of messages) {
      const content = msg.content ?? '';
      if (!content || content.length < 200) {
        // Short messages: keep as-is
        compressed.push(msg);
        continue;
      }

      const ids = extractIdentifiers(content);

      if (ids.length === 0) {
        // No identifiers to preserve — keep original
        compressed.push(msg);
        continue;
      }

      // Store original content indexed by each identifier
      for (const id of ids) {
        if (!this.store.has(id)) {
          this.store.set(id, content);
        }
      }

      allIdentifiers.push(...ids);
      tokensSaved += Math.floor(content.length / 4); // rough token estimate

      // Replace with a compact stub
      const stub = `[Content compressed — identifiers: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ` +${ids.length - 5} more` : ''}. Use restore_context(identifier) to retrieve.]`;

      compressed.push({ ...msg, content: stub });

      logger.debug('RestorableCompressor: compressed message', {
        identifiers: ids.length,
        originalLen: content.length,
        stubLen: stub.length,
      });
    }

    return {
      messages: compressed,
      identifiers: [...new Set(allIdentifiers)],
      tokensSaved,
    };
  }

  /**
   * Restore the original content for an identifier.
   *
   * For file path identifiers, attempts to read from disk as a fallback.
   * For URLs, returns a hint to use web_fetch.
   */
  restore(identifier: string): RestoreResult {
    // 1. Check in-memory store
    const stored = this.store.get(identifier);
    if (stored) {
      return { found: true, content: stored, identifier };
    }

    // 2. Tool call ID — check disk-backed store
    if (identifier.startsWith('call_') || identifier.startsWith('toulu_') || identifier.startsWith('toolu_')) {
      const diskContent = this.readToolResultFromDisk(identifier);
      if (diskContent) {
        return { found: true, content: diskContent, identifier };
      }
    }

    // 3. File path fallback — try reading from disk
    if (!identifier.startsWith('http') && !identifier.startsWith('call_') && !identifier.startsWith('toolu_')) {
      try {
        // Strip line range if present (file.ts:10-50 → file.ts)
        const filePath = identifier.split(':')[0];
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          this.store.set(identifier, content); // cache for future
          return { found: true, content, identifier };
        }
      } catch {
        // ignore
      }
    }

    // 3. URL hint
    if (identifier.startsWith('http')) {
      return {
        found: false,
        content: `URL content not cached. Use web_fetch("${identifier}") to retrieve it.`,
        identifier,
      };
    }

    return {
      found: false,
      content: `Identifier "${identifier}" not found in restoration store.`,
      identifier,
    };
  }

  /**
   * Persist a tool result to disk under `.codebuddy/tool-results/<callId>.txt`.
   * This gives the restore_context tool a reliable disk-backed source and enables
   * the compact/full dual-representation pattern (Manus AI #19).
   *
   * @param callId  - Tool call ID (e.g. call_abc123 or toolu_xyz)
   * @param content - Full tool output
   * @param workDir - Working directory (defaults to process.cwd())
   */
  writeToolResult(callId: string, content: string, workDir = process.cwd()): void {
    try {
      const dir = path.join(workDir, '.codebuddy', 'tool-results');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const filePath = path.join(dir, `${callId}.txt`);
      fs.writeFileSync(filePath, content, 'utf-8');
      // Also store in memory for fast access
      this.store.set(callId, content);
    } catch (err) {
      // Non-critical: disk write failure should not break tool execution
      logger.debug('RestorableCompressor: failed to write tool result to disk', { callId, err });
    }
  }

  /**
   * Read a tool result from disk (`.codebuddy/tool-results/<callId>.txt`).
   * Used by restore_context when the in-memory store has been evicted.
   */
  private readToolResultFromDisk(callId: string, workDir = process.cwd()): string | null {
    try {
      const filePath = path.join(workDir, '.codebuddy', 'tool-results', `${callId}.txt`);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        this.store.set(callId, content); // cache back into memory
        return content;
      }
    } catch {
      // ignore
    }
    return null;
  }

  /** List all stored identifiers */
  listIdentifiers(): string[] {
    return [...this.store.keys()];
  }

  /** Total number of bytes stored */
  storeSize(): number {
    let total = 0;
    for (const v of this.store.values()) total += v.length;
    return total;
  }

  /** Evict oldest entries if store exceeds maxBytes (default 10 MB) */
  evict(maxBytes = 10 * 1024 * 1024): void {
    while (this.storeSize() > maxBytes && this.store.size > 0) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      } else {
        break;
      }
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: RestorableCompressor | null = null;

export function getRestorableCompressor(): RestorableCompressor {
  if (!_instance) _instance = new RestorableCompressor();
  return _instance;
}

/** Reset singleton (for tests) */
export function resetRestorableCompressor(): void {
  _instance = null;
}
