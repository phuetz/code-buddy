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
import { createHash } from 'crypto';
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

export interface RecoverableToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Build one lossless textual observation from the two-channel ToolResult shape.
 * Several tools return useful stdout together with an error; choosing only one
 * channel made the supposedly recoverable copy incomplete.
 */
export function formatToolResultForRecovery(result: RecoverableToolResult | undefined): string {
  if (!result) return 'Error';
  const output = result.output ?? '';
  const error = result.error ?? '';
  if (output && error) {
    return `[tool output]\n${output}\n\n[tool error]\n${error}`;
  }
  if (output) return output;
  if (error) return error;
  return result.success ? 'Success' : 'Error';
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
    const captured = m[1];
    if (captured === undefined) continue;
    const raw = captured.trim().replace(/['"`:]/g, '');
    if (raw.length > 3) ids.add(raw);
  }

  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;)]+$/, ''); // strip trailing punctuation
    ids.add(url);
  }

  for (const m of text.matchAll(TOOL_CALL_ID_RE)) {
    const captured = m[1];
    if (captured !== undefined) ids.add(captured);
  }

  return [...ids];
}

// ============================================================================
// RestorableCompressor
// ============================================================================

export class RestorableCompressor {
  /** canonical workspace + opaque session scope + identifier → original content */
  private store = new Map<string, string>();
  /** Absolute recovery path -> content; the path includes an opaque session directory. */
  private toolResultMemory = new Map<string, string>();
  /** Maximum store entries before auto-eviction */
  private static readonly MAX_STORE_ENTRIES = 500;

  /**
   * Enforce the MAX_STORE_ENTRIES cap by FIFO-evicting ~20% of the oldest
   * entries when the store grows past the limit. Called from every code path
   * that adds to the store so the in-memory map cannot grow unbounded in
   * long sessions (previously only writeToolResult() enforced the cap, so
   * compress() could leak entries indefinitely in sessions without disk-
   * backed tool results).
   */
  private ensureCapacity(): void {
    if (this.store.size <= RestorableCompressor.MAX_STORE_ENTRIES) return;
    const evictCount = Math.floor(RestorableCompressor.MAX_STORE_ENTRIES * 0.2);
    const keysToEvict = [...this.store.keys()].slice(0, evictCount);
    for (const key of keysToEvict) {
      this.store.delete(key);
    }
    while (this.toolResultMemory.size > RestorableCompressor.MAX_STORE_ENTRIES) {
      const oldest = this.toolResultMemory.keys().next().value;
      if (oldest === undefined) break;
      this.toolResultMemory.delete(oldest);
    }
  }

  /** Capture an exact final-payload snapshot in this workspace and session. */
  capture(identifier: string, content: string, workDir = process.cwd(), sessionId?: string): void {
    this.store.set(this.scopedStoreKey(identifier, workDir, sessionId), content);
    this.ensureCapacity();
  }

  /**
   * Compress a slice of messages that are about to be dropped.
   *
   * For each message, identifiers are extracted and the full content is
   * stored. The message content is replaced with a compact stub listing
   * the available identifiers.
   */
  compress(
    messages: CompressibleMessage[],
    workDir = process.cwd(),
    sessionId?: string,
  ): CompressionResult {
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
        const key = this.scopedStoreKey(id, workDir, sessionId);
        if (!this.store.has(key)) {
          this.store.set(key, content);
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

    // Prevent unbounded growth of the in-memory store.
    this.ensureCapacity();

    return {
      messages: compressed,
      identifiers: [...new Set(allIdentifiers)],
      tokensSaved,
    };
  }

  /**
   * Restore the original content for an identifier.
   *
   * Only content already captured in the same canonical workspace is eligible.
   * Uncached URLs return a hint to use web_fetch; uncached file paths are never
   * read here and must go through the normal guarded file tools.
   */
  restore(identifier: string, workDir = process.cwd(), sessionId?: string): RestoreResult {
    // 1. Check the workspace-and-session-scoped disk/memory store first.
    // Provider call IDs are not guaranteed globally unique across concurrent
    // Cowork/channel sessions in the same project.
    const diskContent = this.readToolResultFromDisk(identifier, workDir, sessionId);
    if (diskContent !== null) {
      return { found: true, content: diskContent, identifier };
    }

    // 2. Check the identifier store used by message compaction, scoped to the
    // exact same canonical workspace and opaque session. Never fall back to a
    // workspace-only or another session's entry when a provider reuses a call ID.
    const stored = this.store.get(this.scopedStoreKey(identifier, workDir, sessionId));
    if (stored) {
      return { found: true, content: stored, identifier };
    }

    // 3. URL hint. File paths are intentionally NOT read from disk here:
    // restore_context may only recover content that was previously captured in
    // this workspace. Fresh file reads must go through view_file, which owns
    // workspace/trust/symlink enforcement.
    if (identifier.startsWith('http')) {
      return {
        found: false,
        content: `URL content not cached. Use web_fetch("${identifier}") to retrieve it.`,
        identifier,
      };
    }

    return {
      found: false,
      content:
        `Identifier "${identifier}" not found in the active session restoration store. ` +
        'Only content previously captured in this workspace and session can be restored.',
      identifier,
    };
  }

  /**
   * Persist a tool result under
   * `.codebuddy/tool-results/session-<sha256>/<callId>.txt`.
   * This gives the restore_context tool a reliable disk-backed source and enables
   * the compact/full dual-representation pattern (Manus AI #19).
   *
   * @param callId  - Tool call ID (e.g. call_abc123 or toolu_xyz)
   * @param content - Full tool output
   * @param workDir - Working directory (defaults to process.cwd())
   * @param sessionId - Untrusted conversation/session identifier. It is hashed
   *                    before being used on disk and never appears in a path.
   */
  writeToolResult(
    callId: string,
    content: string,
    workDir = process.cwd(),
    sessionId?: string,
  ): void {
    if (!callId) return;
    // HTTP requests without an explicit session ID intentionally have no
    // continuity. Persisting their unique api:request scopes would create one
    // recovery directory per request with no legitimate future reader.
    if (sessionId?.startsWith('api:request:')) return;
    try {
      const workspaceRoot = this.resolveWorkspaceRoot(workDir);
      const dir = this.resolveRecoveryDirectory(workspaceRoot, true, sessionId);
      if (!dir) return;
      // Existing directories may have inherited a permissive umask.
      // Recovery files can contain source code, credentials printed by a tool,
      // or personal data, so keep them private on POSIX systems.
      if (!this.hardenRecoveryTree(workspaceRoot, dir)) return;

      const safeCallId = this.safeCallIdFilename(callId);
      const filePath = path.join(dir, `${safeCallId}.txt`);
      const opened = this.openVerifiedRecoveryFile(
        workspaceRoot,
        dir,
        filePath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT,
        0o600
      );
      if (!opened) return;
      let written = false;
      try {
        if (process.platform !== 'win32') fs.fchmodSync(opened.descriptor, 0o600);
        // Truncate only after O_NOFOLLOW + regular-file + inode + confinement
        // checks. All writes stay attached to the verified descriptor even if
        // the pathname is swapped immediately afterwards.
        fs.ftruncateSync(opened.descriptor, 0);
        fs.writeFileSync(opened.descriptor, content, { encoding: 'utf-8' });
        fs.fsyncSync(opened.descriptor);
        const after = fs.fstatSync(opened.descriptor);
        written =
          after.isFile() &&
          after.nlink === 1 &&
          after.dev === opened.initialStat.dev &&
          after.ino === opened.initialStat.ino;
      } finally {
        fs.closeSync(opened.descriptor);
      }
      if (!written) return;
      this.toolResultMemory.set(opened.canonicalPath, content);
      // Also store in memory for fast access; enforce capacity to prevent
      // memory leak in long sessions (shared helper with compress()).
      this.store.set(this.scopedStoreKey(callId, workspaceRoot, sessionId), content);
      this.ensureCapacity();
    } catch (err) {
      // Non-critical: disk write failure should not break tool execution
      logger.debug('RestorableCompressor: failed to write tool result to disk', { callId, err });
    }
  }

  /** Read a tool result from the current session's opaque disk directory. */
  private readToolResultFromDisk(
    callId: string,
    workDir = process.cwd(),
    sessionId?: string,
  ): string | null {
    try {
      const workspaceRoot = this.resolveWorkspaceRoot(workDir);
      const dir = this.resolveRecoveryDirectory(workspaceRoot, false, sessionId);
      if (!dir) return null;
      const filePath = path.join(dir, `${this.safeCallIdFilename(callId)}.txt`);
      const opened = this.openVerifiedRecoveryFile(
        workspaceRoot,
        dir,
        filePath,
        fs.constants.O_RDONLY
      );
      if (!opened) return null;
      const cached = this.toolResultMemory.get(opened.canonicalPath);
      if (cached !== undefined) {
        fs.closeSync(opened.descriptor);
        return cached;
      }
      let content: string;
      let unchanged = false;
      try {
        content = fs.readFileSync(opened.descriptor, 'utf-8');
        const after = fs.fstatSync(opened.descriptor);
        unchanged =
          after.isFile() &&
          after.nlink === 1 &&
          after.dev === opened.initialStat.dev &&
          after.ino === opened.initialStat.ino &&
          after.size === opened.initialStat.size &&
          after.mtimeMs === opened.initialStat.mtimeMs &&
          after.ctimeMs === opened.initialStat.ctimeMs;
      } finally {
        fs.closeSync(opened.descriptor);
      }
      if (!unchanged) return null;
      this.store.set(this.scopedStoreKey(callId, workspaceRoot, sessionId), content);
      this.toolResultMemory.set(opened.canonicalPath, content);
      this.ensureCapacity();
      return content;
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Open a recovery file without following symlinks, then bind the pathname,
   * canonical location and opened inode before any read, truncate, or write.
   */
  private openVerifiedRecoveryFile(
    workspaceRoot: string,
    recoveryDirectory: string,
    filePath: string,
    flags: number,
    mode?: number
  ): { descriptor: number; canonicalPath: string; initialStat: fs.Stats } | null {
    let descriptor: number | null = null;
    try {
      descriptor = fs.openSync(
        filePath,
        flags |
          (fs.constants.O_NOFOLLOW ?? 0) |
          (fs.constants.O_NONBLOCK ?? 0),
        mode
      );
      const opened = fs.fstatSync(descriptor);
      const canonicalPath = fs.realpathSync(filePath);
      const current = fs.statSync(canonicalPath);
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        !current.isFile() ||
        current.dev !== opened.dev ||
        current.ino !== opened.ino ||
        path.dirname(canonicalPath) !== recoveryDirectory ||
        !this.isWithinWorkspace(workspaceRoot, canonicalPath)
      ) {
        fs.closeSync(descriptor);
        return null;
      }
      return { descriptor, canonicalPath, initialStat: opened };
    } catch {
      if (descriptor !== null) fs.closeSync(descriptor);
      return null;
    }
  }

  /** Apply private POSIX permissions through a verified directory descriptor. */
  private hardenRecoveryDirectory(workspaceRoot: string, directory: string): boolean {
    if (process.platform === 'win32') return true;
    let descriptor: number | null = null;
    try {
      descriptor = fs.openSync(
        directory,
        fs.constants.O_RDONLY |
          (fs.constants.O_DIRECTORY ?? 0) |
          (fs.constants.O_NOFOLLOW ?? 0) |
          (fs.constants.O_NONBLOCK ?? 0)
      );
      const opened = fs.fstatSync(descriptor);
      const canonicalDirectory = fs.realpathSync(directory);
      const current = fs.statSync(canonicalDirectory);
      if (
        !opened.isDirectory() ||
        !current.isDirectory() ||
        opened.dev !== current.dev ||
        opened.ino !== current.ino ||
        canonicalDirectory !== directory ||
        !this.isWithinWorkspace(workspaceRoot, canonicalDirectory)
      ) {
        return false;
      }
      fs.fchmodSync(descriptor, 0o700);
      return true;
    } catch {
      return false;
    } finally {
      if (descriptor !== null) fs.closeSync(descriptor);
    }
  }

  /** Keep every directory in the private recovery path non-world-readable. */
  private hardenRecoveryTree(workspaceRoot: string, sessionDirectory: string): boolean {
    if (process.platform === 'win32') return true;
    const directories = [
      path.join(workspaceRoot, '.codebuddy'),
      path.join(workspaceRoot, '.codebuddy', 'tool-results'),
      sessionDirectory,
    ];
    return directories.every((directory) =>
      this.hardenRecoveryDirectory(workspaceRoot, directory)
    );
  }

  /**
   * Tool-call IDs normally contain only ASCII letters, digits, `_` and `-`.
   * Providers are external inputs nevertheless: hash anything outside that
   * narrow grammar so an ID can never escape `.codebuddy/tool-results`.
   */
  private safeCallIdFilename(callId: string): string {
    if (/^[a-zA-Z0-9_-]{1,200}$/.test(callId)) return callId;
    return `call_${createHash('sha256').update(callId).digest('hex')}`;
  }

  /** Canonicalize workspace aliases so symlinked and lexical paths share a scope. */
  private resolveWorkspaceRoot(workDir: string): string {
    const resolved = path.resolve(workDir);
    try {
      const canonical = fs.realpathSync(resolved);
      return fs.statSync(canonical).isDirectory() ? canonical : resolved;
    } catch {
      return resolved;
    }
  }

  /**
   * Resolve the private recovery directory without following workspace-owned
   * symlinks. This keeps both reads and writes beneath the canonical root.
   */
  private resolveRecoveryDirectory(
    workspaceRoot: string,
    create: boolean,
    sessionId?: string,
  ): string | null {
    const directories = [
      path.join(workspaceRoot, '.codebuddy'),
      path.join(workspaceRoot, '.codebuddy', 'tool-results'),
      path.join(
        workspaceRoot,
        '.codebuddy',
        'tool-results',
        this.safeSessionDirectoryName(sessionId),
      ),
    ];

    for (const directory of directories) {
      if (!fs.existsSync(directory)) {
        if (!create) return null;
        fs.mkdirSync(directory, { mode: 0o700 });
      }
      const stats = fs.lstatSync(directory);
      if (stats.isSymbolicLink() || !stats.isDirectory()) return null;
    }

    const recoveryDirectory = directories[directories.length - 1];
    if (!recoveryDirectory) return null;
    const canonicalDirectory = fs.realpathSync(recoveryDirectory);
    return this.isWithinWorkspace(workspaceRoot, canonicalDirectory)
      ? canonicalDirectory
      : null;
  }

  /**
   * Session IDs originate in HTTP clients, channels and desktop hosts. Hash the
   * complete untrusted value with a domain separator so it cannot traverse
   * directories or leak user identifiers through filenames. The explicit
   * sessionless scope is distinct from every non-empty supplied identifier.
   */
  private sessionScopeKey(sessionId?: string): string {
    const hash = createHash('sha256');
    hash.update('codebuddy-restorable-session-v1\0');
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      hash.update('id\0');
      hash.update(sessionId);
    } else {
      hash.update('sessionless');
    }
    return hash.digest('hex');
  }

  private safeSessionDirectoryName(sessionId?: string): string {
    return `session-${this.sessionScopeKey(sessionId)}`;
  }

  private isWithinWorkspace(workspaceRoot: string, candidate: string): boolean {
    const relative = path.relative(workspaceRoot, candidate);
    return relative === '' || (
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    );
  }

  private scopedStoreKey(identifier: string, workDir: string, sessionId?: string): string {
    return (
      `${this.resolveWorkspaceRoot(workDir)}\u0000` +
      `${this.sessionScopeKey(sessionId)}\u0000${identifier}`
    );
  }

  private identifierFromScopedKey(key: string): string {
    const separator = key.lastIndexOf('\u0000');
    return separator >= 0 ? key.slice(separator + 1) : key;
  }

  /** List all stored identifiers */
  listIdentifiers(workDir?: string): string[] {
    const prefix = workDir ? `${this.resolveWorkspaceRoot(workDir)}\u0000` : null;
    const keys = prefix
      ? [...this.store.keys()].filter((key) => key.startsWith(prefix))
      : [...this.store.keys()];
    return [...new Set(keys.map((key) => this.identifierFromScopedKey(key)))];
  }

  /** Total number of bytes stored */
  storeSize(workDir?: string): number {
    let total = 0;
    const prefix = workDir ? `${this.resolveWorkspaceRoot(workDir)}\u0000` : null;
    for (const [key, value] of this.store) {
      if (!prefix || key.startsWith(prefix)) total += value.length;
    }
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
