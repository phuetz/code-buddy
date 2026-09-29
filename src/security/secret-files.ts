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
import { isPathInside, isSamePath } from './path-comparison.js';

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
function isUniversalSecretBasename(base: string): boolean {
  const lower = base.toLowerCase();
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

/**
 * Broader rules applied only inside a home credential root: anything named
 * like an auth/token/credential/secret store, env files, key material and the
 * paired-device registry.
 */
function isCredentialRootSecretBasename(base: string): boolean {
  const lower = base.toLowerCase();
  if (isUniversalSecretBasename(lower)) return true;
  if (/(^|[-_.])(auth|oauth|credentials?|tokens?|secrets?|passwords?|login-pending)([-_.]|$)/.test(lower)) {
    return true;
  }
  if (/\.(pem|ppk)$/.test(lower)) return true;
  if (lower === 'devices.json' || lower === 'hosts.yml' || lower === 'credentials.db' || /\.(db|sqlite|sqlite3)$/.test(lower)) return true;
  return false;
}

export interface SecretPathContext {
  /** Allows platform path rules to be tested on another host. */
  platform?: NodeJS.Platform;
}

function pathFor(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path;
}

type PathOps = ReturnType<typeof pathFor>;

function homeDirs(platform: NodeJS.Platform): string[] {
  const paths = pathFor(platform);
  // Windows shells may use HOME while Node uses USERPROFILE. Both locations can
  // hold credentials, so every reader must protect both through this policy.
  const candidates = [os.homedir(), ...(platform === 'win32' ? [process.env.HOME, process.env.USERPROFILE] : [])];
  return Array.from(new Set(candidates
    .filter((candidate): candidate is string => !!candidate && paths.isAbsolute(candidate))
    .map((candidate) => paths.resolve(candidate))));
}

/** Lexical + canonical forms of the credential roots. */
export function getHomeCredentialRoots(context: SecretPathContext = {}): string[] {
  const platform = context.platform ?? process.platform;
  const paths = pathFor(platform);
  const roots = new Set<string>();
  for (const home of homeDirs(platform)) {
    for (const rel of [...HOME_CREDENTIAL_ROOTS, ...HOME_PRIVATE_ROOTS]) {
      const lexical = paths.join(home, rel);
      roots.add(lexical);
      const canonical = canonicalize(lexical, paths, platform);
      if (canonical) roots.add(canonical);
    }
  }
  return Array.from(roots);
}

/** realpath through the nearest existing ancestor (null when nothing resolves). */
function canonicalize(p: string, paths: PathOps, platform: NodeJS.Platform): string | null {
  // A simulated platform has no matching filesystem; lexical checks still run.
  if (platform !== process.platform) return null;
  let ancestor = p;
  while (!fs.existsSync(ancestor)) {
    const parent = paths.dirname(ancestor);
    if (parent === ancestor) return null;
    ancestor = parent;
  }
  try {
    const real = fs.realpathSync(ancestor);
    const suffix = paths.relative(ancestor, p);
    return suffix ? paths.resolve(real, suffix) : real;
  } catch {
    return null;
  }
}

function classify(absPath: string, roots: readonly string[], platform: NodeJS.Platform): string | null {
  const paths = pathFor(platform);
  const base = paths.basename(absPath);
  if (platform !== 'win32' &&
    (isSamePath(absPath, '/etc/shadow', platform) || isSamePath(absPath, '/etc/gshadow', platform))) {
    return 'system password database';
  }
  if (isUniversalSecretBasename(base)) return `secret file name (${base})`;
  for (const home of homeDirs(platform)) {
    for (const rel of HOME_PRIVATE_ROOTS) {
      const root = paths.join(home, rel);
      if (isPathInside(absPath, root, platform) ||
        isPathInside(absPath, canonicalize(root, paths, platform) ?? root, platform)) {
        return `private home directory (${rel})`;
      }
    }
    for (const rel of HOME_PRIVATE_FILES) {
      if (isSamePath(absPath, paths.join(home, rel), platform)) return `private home file (${rel})`;
    }
  }
  for (const root of roots) {
    if (isPathInside(absPath, root, platform) && !isSamePath(absPath, root, platform)) {
      // path.relative is case-sensitive even when simulating darwin on Linux.
      const relative = paths.normalize(absPath).slice(paths.normalize(root).length + 1);
      if (paths.basename(root).toLowerCase() === '.codebuddy' &&
        /^(sessions|peer-sessions)[\\/]/i.test(relative)) {
        return `private Code Buddy session under ${root}`;
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
export function classifySecretPath(filePath: string, baseDir?: string, context: SecretPathContext = {}): SecretFileVerdict {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.includes('\0')) {
    return { secret: false };
  }
  const platform = context.platform ?? process.platform;
  const paths = pathFor(platform);
  const lexical = baseDir ? paths.resolve(baseDir, filePath) : paths.resolve(filePath);
  const roots = getHomeCredentialRoots(context);
  const lexicalReason = classify(lexical, roots, platform);
  if (lexicalReason) return { secret: true, matchedPath: lexical, reason: lexicalReason };
  const canonical = canonicalize(lexical, paths, platform);
  if (canonical && canonical !== lexical) {
    const canonicalReason = classify(canonical, roots, platform);
    if (canonicalReason) {
      return { secret: true, matchedPath: canonical, reason: `${canonicalReason} (via symlink)` };
    }
  }
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
  options: { baseDir?: string; env?: NodeJS.ProcessEnv } & SecretPathContext = {},
): SecretFileVerdict {
  const verdict = classifySecretPath(filePath, options.baseDir, options);
  if (!verdict.secret) return verdict;
  if (access === 'read') {
    return isSecretFileReadAllowedByOperator(options.env) ? { secret: false } : verdict;
  }
  const platform = options.platform ?? process.platform;
  const roots = getHomeCredentialRoots(options);
  const matched = verdict.matchedPath ?? '';
  const inCredentialRoot = roots.some((root) => isPathInside(matched, root, platform));
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
  '!*.pem',
  '!devices.json',
  '!hosts.yml',
];
