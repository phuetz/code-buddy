/**
 * Last-resort shell output guard for literal values in Git-tracked secret files.
 * The cache holds fingerprints only. Source bytes are read transiently and are
 * never logged or returned to the caller.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifySecretPath, isUniversalSecretBasename } from './secret-files.js';
import type { ToolResult } from '../types/index.js';

const REPLACEMENT = '[REDACTED]';
const WITHHELD = '[Shell output withheld: tracked secret inventory incomplete]';
const MAX_FILE_BYTES = 256 * 1024;
const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const BASE = 257;

function git(cwd: string, args: string[], maxBuffer = MAX_HISTORY_BYTES): Buffer {
  return execFileSync('git', args, {
    cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000, maxBuffer,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function rollingHash(bytes: Buffer): number {
  let hash = 0;
  for (const byte of bytes) hash = (Math.imul(hash, BASE) + byte) >>> 0;
  return hash;
}

class Fingerprints {
  private byLength = new Map<number, Map<number, Set<string>>>();

  clone(): Fingerprints {
    const result = new Fingerprints();
    for (const [length, hashes] of this.byLength) {
      result.byLength.set(length, new Map(
        [...hashes].map(([rolling, digests]) => [rolling, new Set(digests)]),
      ));
    }
    return result;
  }

  add(value: string): void {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length === 0) return;
    const rolling = rollingHash(bytes);
    let hashes = this.byLength.get(bytes.length);
    if (!hashes) {
      hashes = new Map();
      this.byLength.set(bytes.length, hashes);
    }
    let digests = hashes.get(rolling);
    if (!digests) {
      digests = new Set();
      hashes.set(rolling, digests);
    }
    digests.add(digest(bytes));
    bytes.fill(0);
  }

  redact(value: string): string {
    if (this.byLength.size === 0 || !value) return value;
    const bytes = Buffer.from(value, 'utf8');
    const spans: Array<[number, number]> = [];
    for (const [length, hashes] of this.byLength) {
      if (length > bytes.length) continue;
      let power = 1;
      for (let i = 1; i < length; i += 1) power = Math.imul(power, BASE) >>> 0;
      let rolling = rollingHash(bytes.subarray(0, length));
      for (let start = 0; start <= bytes.length - length; start += 1) {
        const matches = hashes.get(rolling);
        if (matches?.has(digest(bytes.subarray(start, start + length)))) {
          spans.push([start, start + length]);
        }
        if (start + length < bytes.length) {
          rolling = (rolling - Math.imul(bytes[start]!, power)) >>> 0;
          rolling = (Math.imul(rolling, BASE) + bytes[start + length]!) >>> 0;
        }
      }
    }
    if (spans.length === 0) return value;
    spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const parts: Buffer[] = [];
    let cursor = 0;
    for (const [start, end] of spans) {
      if (start < cursor) {
        if (end > cursor) cursor = end;
        continue;
      }
      parts.push(bytes.subarray(cursor, start), Buffer.from(REPLACEMENT));
      cursor = end;
    }
    parts.push(bytes.subarray(cursor));
    return Buffer.concat(parts).toString('utf8');
  }
}

function isPublicValue(key: string, value: string): boolean {
  if (/(?:KEY|TOKEN|SECRET|PASS|PWD|AUTH|CREDENTIAL|PRIVATE)/i.test(key)) return false;
  return /^(?:world|test|example|dummy|localhost|true|false)$/i.test(value) ||
    (key.toLowerCase() === 'registry' && value === 'https://registry.npmjs.org/');
}

function collectJson(value: unknown, found: Set<string>, key = ''): void {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value);
    if (!isPublicValue(key, text)) found.add(text);
  } else if (Array.isArray(value)) value.forEach((item) => collectJson(item, found, key));
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([property, item]) => collectJson(item, found, property));
  }
}

function addFileValues(index: Fingerprints, buffer: Buffer): void {
  const content = buffer.toString('utf8');
  if (content.includes('\uFFFD')) throw new Error('non-text tracked secret');
  const values = new Set<string>();
  let structured = false;
  try {
    collectJson(JSON.parse(content), values);
    structured = true;
  } catch { /* Other secret formats. */ }
  for (const line of content.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry || entry.startsWith('#') || entry.startsWith(';')) continue;
    if (structured) continue;
    const assignment = entry.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*[=:]\s*(.*)$/);
    if (assignment) {
      structured = true;
      let value = assignment[2]!.trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, '').trim();
      if (value && !isPublicValue(assignment[1]!, value)) values.add(value);
    } else if (!entry.startsWith('-----')) {
      values.add(entry);
    }
  }
  // Unstructured key material may have no assignment or JSON property.
  if (!structured && content.trim()) values.add(content.trim());
  for (const value of values) index.add(value);
  buffer.fill(0);
}

function secretPath(root: string, relative: string): boolean {
  return classifySecretPath(path.resolve(root, relative)).secret;
}

function addGitBlob(index: Fingerprints, root: string, oid: string): void {
  const type = git(root, ['cat-file', '-t', oid], 64).toString('utf8').trim();
  if (type !== 'blob') return;
  const size = Number(git(root, ['cat-file', '-s', oid], 64).toString('utf8').trim());
  if (!Number.isSafeInteger(size) || size > MAX_FILE_BYTES) throw new Error('tracked secret too large');
  addFileValues(index, git(root, ['cat-file', 'blob', oid], MAX_FILE_BYTES + 1));
}

const historyCache = new Map<string, { stamp: string; index: Fingerprints }>();

function historicalFingerprints(root: string): Fingerprints {
  const refs = git(root, ['for-each-ref', '--format=%(refname):%(objectname)'], 4 * 1024 * 1024);
  let head: Buffer = Buffer.alloc(0);
  try { head = git(root, ['rev-parse', 'HEAD'], 128); } catch { /* Empty repository. */ }
  const reflog = git(root, ['reflog', '--all', '--format=%H'], 8 * 1024 * 1024);
  const stamp = digest(Buffer.concat([refs, head, reflog]));
  const cached = historyCache.get(root);
  if (cached?.stamp === stamp) return cached.index.clone();

  const index = new Fingerprints();
  const seen = new Set<string>();
  const home = path.resolve(os.homedir());
  const rootUnderHome = root === home || root.startsWith(home + path.sep);
  const objects = git(root, ['rev-list', '--objects', '--all', '--reflog']);
  for (const line of objects.toString('utf8').split('\n')) {
    const space = line.indexOf(' ');
    if (space < 0) continue;
    const oid = line.slice(0, space);
    const relative = line.slice(space + 1);
    // Outside HOME, the central classifier only grants universal secret
    // basenames. Skip other historical objects without 95k filesystem probes.
    if (!rootUnderHome && !isUniversalSecretBasename(path.basename(relative))) continue;
    if (!secretPath(root, relative) || seen.has(oid)) continue;
    seen.add(oid);
    addGitBlob(index, root, oid);
  }
  historyCache.set(root, { stamp, index: index.clone() });
  if (historyCache.size > 8) historyCache.delete(historyCache.keys().next().value!);
  return index;
}

function trackedSecretFingerprints(cwd: string): Fingerprints | null {
  let root: string;
  try { root = git(cwd, ['rev-parse', '--show-toplevel'], 4 * 1024).toString('utf8').trim(); }
  catch { return new Fingerprints(); } // Outside a Git worktree there is no tracked project secret.
  try {
    const index = historicalFingerprints(root);
    const entries = git(root, ['ls-files', '--stage', '-z'], 8 * 1024 * 1024);
    const home = path.resolve(os.homedir());
    const rootUnderHome = root === home || root.startsWith(home + path.sep);
    for (const entry of entries.toString('utf8').split('\0')) {
      if (!entry) continue;
      const match = entry.match(/^(\d+) ([0-9a-f]+) \d+\t([\s\S]+)$/);
      if (!match) continue;
      const relative = match[3]!;
      if (!rootUnderHome && match[1] !== '120000' &&
          !isUniversalSecretBasename(path.basename(relative))) continue;
      if (!secretPath(root, relative)) continue;
      addGitBlob(index, root, match[2]!);
      const file = path.resolve(root, relative);
      const stat = fs.lstatSync(file, { throwIfNoEntry: false });
      if (!stat) continue;
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('unsafe tracked secret file');
      addFileValues(index, fs.readFileSync(file));
    }
    return index;
  } catch {
    // Partial inventories cannot justify returning any command output.
    return null;
  }
}

function candidateDirectories(cwd: string, command: string): string[] {
  const directories = new Set([cwd]);
  // Probe literal directory arguments without depending on a list of shell
  // wrappers. This covers changed worktrees and GIT_DIR while the session
  // worktree remains the primary inventory.
  for (const match of command.matchAll(/"[^"]*"|'[^']*'|[^\s;|&<>]+/g)) {
    const token = match[0];
    const raw = token.slice(token.lastIndexOf('=') + 1).replace(/^(['"])(.*)\1$/, '$2');
    if (!raw || /[$*?{}()]/.test(raw)) continue;
    const candidate = path.resolve(cwd, raw);
    try {
      if (!fs.statSync(candidate).isDirectory()) continue;
    } catch { continue; }
    directories.add(path.basename(candidate) === '.git' ? path.dirname(candidate) : candidate);
    if (directories.size > 64) throw new Error('too many output inventory candidates');
  }
  return [...directories];
}

export function redactTrackedGitOutput(value: string, cwd: string, command = ''): string {
  if (!value) return value;
  if (Buffer.byteLength(value, 'utf8') > MAX_OUTPUT_BYTES) return WITHHELD;
  let visible = value;
  try {
    for (const directory of candidateDirectories(cwd, command)) {
      const index = trackedSecretFingerprints(directory);
      if (!index) return WITHHELD;
      visible = index.redact(visible);
    }
  } catch {
    return WITHHELD;
  }
  return visible;
}

export function redactTrackedGitResult(result: ToolResult, cwd: string, command = ''): ToolResult {
  if (!result.output && (!result.error ||
    /^(?:Command blocked:|Command blocked by execution policy:|Invalid input:|Command aborted by user)/.test(result.error))) {
    return result;
  }
  const output = typeof result.output === 'string' ? redactTrackedGitOutput(result.output, cwd, command) : result.output;
  const error = typeof result.error === 'string' ? redactTrackedGitOutput(result.error, cwd, command) : result.error;
  return { ...result, ...(output !== undefined ? { output } : {}), ...(error !== undefined ? { error } : {}) };
}

export function withheldTrackedGitOutput(): string { return WITHHELD; }
