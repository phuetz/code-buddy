/**
 * Secret-file guard — the deny list that wins over every allow list.
 *
 * Code Buddy's own home directories (`~/.codebuddy`, `~/.grok`, …) are
 * whitelisted for the agent's file tools so that it can read its settings,
 * skills and sessions. Those same directories hold credentials: the ChatGPT
 * OAuth session (`codex-auth.json`), provider logins (`xai-auth.json`,
 * `gemini-auth.json`, `nous_auth.json`), MCP OAuth tokens (`mcp-tokens.json`),
 * paired-device records (`devices.json`), operator env files (`server.env`,
 * `media.env`, …) and private keys (`skill-signing/key.pem`,
 * `companion/migration.key`, `life/meals.key`). A prompt-injected document
 * could otherwise ask the agent to read one of them and echo it back.
 *
 * This module is the single source of truth for "is this path a secret?".
 * It is consulted by workspace isolation (view_file, str_replace, create,
 * multi_edit, apply_patch — through the VFS), by the search tools, by the
 * peer tool bridge and by the bash validator. It is deliberately NOT a
 * substring scan: every decision is taken on the resolved path, and on its
 * symlink-resolved form when the file (or one of its parents) exists.
 *
 * What is NOT a secret (and stays readable): settings.json, mcp.json,
 * provider-health.json, memory files, skills, tokenizer.json, keybindings.json,
 * authored-tools.json, trusted-keys.json (public keys), `.env.example`.
 *
 * Explicit human opt-in: `CODEBUDDY_ALLOW_SECRET_FILE_READ=true` in the
 * environment of the Code Buddy process (the model cannot set it — a bash
 * child cannot change its parent's environment).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type SecretFileAccess = 'read' | 'write';

export interface SecretFileVerdict {
  secret: boolean;
  /** Absolute path that matched (lexical or symlink-resolved). */
  matchedPath?: string;
  reason?: string;
}

/**
 * Home-relative directories that hold credentials of Code Buddy or of a
 * sibling CLI. Inside them the credential name rules are broad (any
 * `*auth*.json`, `*token*`, `*.pem`, …).
 */
const HOME_CREDENTIAL_ROOTS: readonly string[] = [
  '.codebuddy',
  '.grok',
  '.codex',
  '.claude',
  '.gemini',
  '.config',
];

/** Historical isolation denials, also required for tools that bypass the VFS. */
const HOME_PRIVATE_ROOTS: readonly string[] = ['.ssh', '.gnupg', '.aws', '.kube'];
const HOME_PRIVATE_FILES: readonly string[] = ['.docker/config.json', '.config/gcloud/credentials.db'];

/**
 * Basenames that are secrets wherever they live (workspace included).
 * `.env.example` / `.sample` / `.template` / `.dist` / `.defaults` are
 * committed templates and stay readable.
 */
export function isUniversalSecretBasename(base: string): boolean {
  const lower = underlyingStoreBasename(base);
  if (lower === '.env') return true;
  if (lower.startsWith('.env.')) {
    return !/^\.env\.(example|sample|template|dist|defaults?|schema)$/.test(lower);
  }
  if (lower.endsWith('.env')) return true;
  if (/^(secrets?|credentials?|tokens?|passwords?)\.(csv|tsv|json|db|sqlite|sqlite3)$/.test(lower)) return true;
  if (
    lower === 'codex-auth.json' ||
    lower === 'xai-auth.json' ||
    lower === 'gemini-auth.json' ||
    lower === 'nous_auth.json' ||
    lower === 'mcp-tokens.json' ||
    lower === 'auth-profiles.json' ||
    lower === '.credentials.json' ||
    lower === 'credentials.enc' ||
    lower === '.git-credentials' ||
    lower === '.netrc' ||
    lower === '.npmrc' ||
    lower === '.pypirc'
  ) {
    return true;
  }
  if (/^id_(rsa|dsa|ecdsa|ed25519)(_sk)?$/.test(lower)) return true;
  if (/\.(key|p12|pfx|keystore|jks)$/.test(lower)) return true;
  return false;
}

/** Backups and SQLite sidecars retain the bytes of the original store. */
function underlyingStoreBasename(base: string): string {
  let name = base.toLowerCase();
  while (true) {
    const original = name;
    name = name.replace(/\.(?:bak|old|orig|save|tmp|swp)$/, '');
    name = name.replace(/(\.(?:db|sqlite|sqlite3))-(?:wal|shm|journal)$/, '$1');
    if (name === original) return name;
  }
}

/**
 * Broader rules applied only inside a home credential root: anything named
 * like an auth/token/credential/secret store, env files, key material and the
 * paired-device registry.
 */
function isCredentialRootSecretBasename(base: string): boolean {
  const lower = underlyingStoreBasename(base);
  if (isUniversalSecretBasename(lower)) return true;
  if (/(^|[-_.])(auth|oauth|credentials?|tokens?|secrets?|passwords?|login-pending)([-_.]|$)/.test(lower)) {
    return true;
  }
  if (/\.(pem|ppk)$/.test(lower)) return true;
  if (lower === 'devices.json' || lower === 'hosts.yml' || lower === 'credentials.db' || /\.(db|sqlite|sqlite3)$/.test(lower)) return true;
  return false;
}

function homeDir(): string {
  // os.homedir() honours $HOME on POSIX — tests run under an isolated HOME.
  return path.resolve(os.homedir());
}

/** Lexical + canonical forms of the credential roots. */
export function getHomeCredentialRoots(): string[] {
  const home = homeDir();
  const roots = new Set<string>();
  for (const rel of [...HOME_CREDENTIAL_ROOTS, ...HOME_PRIVATE_ROOTS]) {
    const lexical = path.join(home, rel);
    roots.add(lexical);
    const canonical = canonicalize(lexical);
    if (canonical) roots.add(canonical);
  }
  return Array.from(roots);
}

function comparablePath(value: string): string {
  return process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value;
}

function isInside(candidate: string, root: string): boolean {
  const a = comparablePath(candidate);
  const b = comparablePath(root);
  return a === b || a.startsWith(b + path.sep);
}

/** realpath through the nearest existing ancestor (null when nothing resolves). */
function canonicalize(p: string): string | null {
  let ancestor = p;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return null;
    ancestor = parent;
  }
  try {
    const real = fs.realpathSync(ancestor);
    const suffix = path.relative(ancestor, p);
    return suffix ? path.resolve(real, suffix) : real;
  } catch {
    return null;
  }
}

function classify(absPath: string, roots: readonly string[]): string | null {
  const base = path.basename(absPath);
  if (absPath === '/etc/shadow' || absPath === '/etc/gshadow') return 'system password database';
  // Git objects can carry the bytes of a classified file under opaque hash
  // names. Guard the object store and its aliases through canonicalize() just
  // like the working-tree credential path.
  if (absPath.split(path.sep).some((component) => component.toLowerCase() === '.git'))
    return 'private Git metadata and object store';
  if (isUniversalSecretBasename(base)) return `secret file name (${base})`;
  const home = homeDir();
  for (const rel of HOME_PRIVATE_ROOTS) {
    const root = path.join(home, rel);
    if (isInside(absPath, root) || isInside(absPath, canonicalize(root) ?? root)) {
      return `private home directory (${rel})`;
    }
  }
  for (const rel of HOME_PRIVATE_FILES) {
    if (comparablePath(absPath) === comparablePath(path.join(home, rel))) return `private home file (${rel})`;
  }
  for (const root of roots) {
    if (isInside(absPath, root) && absPath !== root) {
      const relative = path.relative(root, absPath);
      if (path.basename(root).toLowerCase() === '.codebuddy' &&
        /^(sessions|peer-sessions|backups)(?:[\\/]|$)/i.test(relative)) {
        return `private Code Buddy session or backup under ${root}`;
      }
      // Any path component below the root may name a secret store
      // (e.g. `~/.config/gh/hosts.yml`, `~/.codebuddy/skill-signing/key.pem`).
      if (isCredentialRootSecretBasename(base)) {
        return `credential file under ${root}`;
      }
    }
  }
  return null;
}

/** True when a human explicitly allowed secret reads for this process. */
export function isSecretFileReadAllowedByOperator(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.CODEBUDDY_ALLOW_SECRET_FILE_READ ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/**
 * Classify a path. Checks the lexical path AND its symlink-resolved form, so a
 * workspace symlink `notes.txt -> ~/.codebuddy/codex-auth.json` is caught.
 */
export function classifySecretPath(filePath: string, baseDir?: string): SecretFileVerdict {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.includes('\0')) {
    return { secret: false };
  }
  const lexical = baseDir ? path.resolve(baseDir, filePath) : path.resolve(filePath);
  const roots = getHomeCredentialRoots();
  const lexicalReason = classify(lexical, roots);
  if (lexicalReason) return { secret: true, matchedPath: lexical, reason: lexicalReason };
  const canonical = canonicalize(lexical);
  if (canonical && canonical !== lexical) {
    const canonicalReason = classify(canonical, roots);
    if (canonicalReason) {
      return { secret: true, matchedPath: canonical, reason: `${canonicalReason} (via symlink)` };
    }
  }
  // A hard link has no canonical "target": every name resolves to itself.
  // Without an inode inventory of the entire disk, a public-looking alias
  // cannot be proven independent of a credential path. Refuse the alias
  // instead of allowing the same bytes under a second name.
  try {
    const stat = fs.statSync(lexical);
    if (stat.isFile() && stat.nlink > 1) {
      return { secret: true, matchedPath: lexical, reason: 'file has multiple hard links' };
    }
  } catch { /* nonexistent path: keep lexical classification */ }
  return { secret: false };
}

/**
 * Decide whether an agent tool may touch this path.
 *
 * - read: every secret is refused, unless the operator opted in.
 * - write: credential stores under the home credential roots are refused
 *   (token replacement); a project `.env` inside the workspace may be written
 *   (scaffolding) — the caller's workspace rules still apply.
 */
export function checkSecretFileAccess(
  filePath: string,
  access: SecretFileAccess,
  options: { baseDir?: string; env?: NodeJS.ProcessEnv } = {},
): SecretFileVerdict {
  const verdict = classifySecretPath(filePath, options.baseDir);
  if (!verdict.secret) return verdict;
  if (access === 'read') {
    return isSecretFileReadAllowedByOperator(options.env) ? { secret: false } : verdict;
  }
  const roots = getHomeCredentialRoots();
  const matched = verdict.matchedPath ?? '';
  if (verdict.reason === 'file has multiple hard links') return verdict;
  if (matched.split(path.sep).some((component) => component.toLowerCase() === '.git')) return verdict;
  const inCredentialRoot = roots.some((root) => isInside(matched, root));
  return inCredentialRoot ? verdict : { secret: false };
}

export function formatSecretRefusal(filePath: string, verdict: SecretFileVerdict): string {
  return (
    `Access to a credential/secret file is blocked: ${filePath}` +
    (verdict.reason ? ` (${verdict.reason})` : '') +
    '. Agent tools never read credentials without explicit operator consent ' +
    '(CODEBUDDY_ALLOW_SECRET_FILE_READ=true in the Code Buddy environment).'
  );
}

/**
 * ripgrep `--glob` exclusions mirroring the universal secret names, so a
 * recursive search never prints a secret line even when the tree contains one.
 */
export const SECRET_SEARCH_EXCLUDE_GLOBS: readonly string[] = [
  '!.env',
  '!.env.production',
  '!.env.local',
  '!.env.development',
  '!.env.test',
  '!*.env',
  '!codex-auth.json',
  '!xai-auth.json',
  '!gemini-auth.json',
  '!nous_auth.json',
  '!mcp-tokens.json',
  '!auth-profiles.json',
  '!.credentials.json',
  '!credentials.enc',
  '!.git-credentials',
  '!.netrc',
  '!.npmrc',
  '!.pypirc',
  '!id_rsa',
  '!id_dsa',
  '!id_ecdsa',
  '!id_ed25519',
  '!*.key',
  '!*.p12',
  '!*.pfx',
  '!devices.json',
  '!hosts.yml',
];
