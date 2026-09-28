/**
 * A shell that can see a tracked secret can also read its Git object without
 * spelling `git` or the secret path in its command line. Until a child view
 * without those bytes is available on every platform, do not launch that
 * shell. Serve a deliberately small set of useful commands in this parent
 * process with constructed argv instead.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolResult } from '../types/index.js';
import { checkSecretFileAccess, isSecretFileReadAllowedByOperator } from './secret-files.js';
import { isPublicNpmrcContent, isPublicWorkspaceNpmrc } from './public-project-npmrc.js';
import { redactTrackedGitOutput } from './tracked-git-output-redactor.js';

const MAX_DIRECTORIES = 100_000;
const MAX_GIT_OUTPUT = 16 * 1024 * 1024;
const DENIED = 'Command blocked: credential/secret workspace and Git objects cannot be exposed to a child shell';
// Only positive decisions are cached. A new nested repository or secret file
// must be noticed on the next call; removal stays conservatively protected.
const protectedRoots = new Map<string, { dev: number; ino: number }>();

/** Arbitrary child processes cannot receive the unfiltered workspace view. */
export function protectedWorkspaceProcessRefusal(cwd: string): ToolResult | null {
  return hasProtectedGitWorkspace(cwd) ? { success: false, error: DENIED } : null;
}

function cleanGitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith('GIT_')) delete env[key];
  }
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['--no-pager', '-c', 'core.fsmonitor=false', ...args], {
    cwd, encoding: 'utf8', env: cleanGitEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000, maxBuffer: MAX_GIT_OUTPUT,
  });
}

function gitRoot(cwd: string): string | null {
  try { return git(cwd, ['rev-parse', '--show-toplevel']).trim(); }
  catch { return null; }
}

/** The working file, index and every reachable historical version must be public. */
function publicNpmrcInGit(root: string, name: string): boolean {
  const file = path.resolve(root, name);
  if (!isPublicWorkspaceNpmrc(file)) return false;
  const inspectBlob = (oid: string): boolean => {
    if (!/^[0-9a-f]{40,64}$/.test(oid) || /^0+$/.test(oid)) return false;
    const size = Number(git(root, ['cat-file', '-s', oid]).trim());
    return Number.isSafeInteger(size) && size <= 16_384 &&
      isPublicNpmrcContent(git(root, ['cat-file', 'blob', oid]), true);
  };
  const index = git(root, ['ls-files', '--stage', '-z', '--', name]);
  for (const entry of index.split('\0').filter(Boolean)) {
    const match = entry.match(/^100(?:644|755) ([0-9a-f]{40,64}) 0\t([\s\S]+)$/);
    if (!match || match[2] !== name || !inspectBlob(match[1]!)) return false;
  }
  const raw = git(root, [
    'log', '--all', '--reflog', '--root', '-m', '--no-renames', '--raw', '--no-abbrev', '-z',
    '--format=', '--', name,
  ]);
  const changePattern = /:[0-7]{6} [0-7]{6} [0-9a-f]{40,64} ([0-9a-f]{40,64}) [A-Z][0-9]*\0([^\0]*)\0/g;
  for (const match of raw.matchAll(changePattern)) {
    if (match[2] !== name) return false;
    if (!/^0+$/.test(match[1]!) && !inspectBlob(match[1]!)) return false;
  }
  return raw.replace(changePattern, '').replace(/[\0\r\n]/g, '') === '';
}

function secretInRepo(root: string): boolean {
  try {
    const names = git(root, ['ls-files', '-z']) +
      git(root, ['log', '--all', '--reflog', '--name-only', '-z', '--format=']);
    const publicNpmrc = new Map<string, boolean>();
    return names.split('\0').some((name) => {
      if (!name || !checkSecretFileAccess(path.resolve(root, name), 'read').secret) return false;
      if (path.basename(name).toLowerCase() !== '.npmrc') return true;
      if (!publicNpmrc.has(name)) publicNpmrc.set(name, publicNpmrcInGit(root, name));
      return !publicNpmrc.get(name);
    });
  } catch {
    // A partial inventory cannot justify spawning a shell.
    return true;
  }
}

/** Discover nested repositories, including those in a parent workspace. */
export function hasProtectedGitWorkspace(cwd: string): boolean {
  if (isSecretFileReadAllowedByOperator()) return false;
  const resolved = path.resolve(cwd);
  const cached = protectedRoots.get(resolved);
  if (cached) {
    try {
      const stat = fs.statSync(resolved);
      if (cached.dev === stat.dev && cached.ino === stat.ino) return true;
    } catch { return true; }
    protectedRoots.delete(resolved);
  }
  const protect = (): true => {
    try {
      const stat = fs.statSync(resolved);
      protectedRoots.set(resolved, { dev: stat.dev, ino: stat.ino });
    } catch { /* The caller still gets a refusal. */ }
    return true;
  };
  if (checkSecretFileAccess(resolved, 'read').secret) return protect();
  const root = gitRoot(resolved) ?? resolved;
  const pending = [root];
  const seen = new Set<string>();
  let count = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    let real: string;
    try { real = fs.realpathSync(directory); }
    catch { return protect(); }
    if (seen.has(real)) continue;
    seen.add(real);
    if (++count > MAX_DIRECTORIES) return protect();
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(real, { withFileTypes: true }); }
    catch { return protect(); }
    if (entries.some((entry) => {
      if (entry.name === '.git') return false;
      const candidate = path.join(real, entry.name);
      return checkSecretFileAccess(candidate, 'read').secret && !isPublicWorkspaceNpmrc(candidate);
    })) return protect();
    if (entries.some((entry) => entry.name === '.git') && secretInRepo(real)) return protect();
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const candidate = path.join(real, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isSymbolicLink()) {
        try { if (fs.statSync(candidate).isDirectory()) pending.push(candidate); }
        catch { /* Broken links cannot expose a repository. */ }
      }
    }
  }
  return false;
}

/** Shell quoting only; expansions, substitutions and operators are rejected. */
function literalArguments(command: string): string[] | null {
  const args: string[] = [];
  let word = '';
  let quote: "'" | '"' | null = null;
  let active = false;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    if (char === '\\' && quote !== "'") {
      const next = command[++i];
      if (next === undefined || next === '\n') return null;
      word += next;
      active = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '$' || char === '`') return null;
      else word += char;
      active = true;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; active = true; continue; }
    if (/\s/.test(char)) {
      if (active) { args.push(word); word = ''; active = false; }
      continue;
    }
    if (/[|;&<>$`(){}]/.test(char)) return null;
    word += char;
    active = true;
  }
  if (quote) return null;
  if (active) args.push(word);
  return args;
}

function inside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

function publicGitDiff(cwd: string, args: string[]): string | null {
  const cached = args[0] === '--cached';
  const rest = cached ? args.slice(1) : args;
  if (rest.length > 0 && rest[0] !== '--') return null;
  const pathspecs = rest.length > 0 ? rest.slice(1) : [];
  if (pathspecs.some((name) => !name || name.startsWith(':') || path.isAbsolute(name) ||
    name.split(/[\\/]/).includes('..'))) return null;
  const names = git(cwd, [
    'diff', '--no-ext-diff', '--no-textconv', ...(cached ? ['--cached'] : []), '--name-status', '-z',
    '--', ...pathspecs,
  ]);
  const root = gitRoot(cwd);
  if (!root) return null;
  const fields = names.split('\0').filter(Boolean);
  const publicPaths: string[] = [];
  for (let offset = 0; offset < fields.length;) {
    const status = fields[offset++] ?? '';
    const from = fields[offset++];
    const to = /^[RC]/.test(status) ? fields[offset++] : undefined;
    if (!from || /^[RC]/.test(status) && !to) return null;
    if ([from, to].filter((item): item is string => Boolean(item)).some((name) =>
      checkSecretFileAccess(path.resolve(root, name), 'read').secret)) continue;
    publicPaths.push(to ?? from);
  }
  if (publicPaths.length === 0) return '';
  return git(cwd, ['diff', '--no-ext-diff', '--no-textconv', ...(cached ? ['--cached'] : []), '--', ...publicPaths]);
}

/** Null means the ordinary shell path remains available; otherwise no child shell may spawn. */
export function runProtectedWorkspaceCommand(command: string, cwd: string): ToolResult | null {
  if (!hasProtectedGitWorkspace(cwd)) return null;
  const args = literalArguments(command);
  if (!args) return { success: false, error: DENIED };
  try {
    const [program, action, ...rest] = args;
    let output: string | null = null;
    if (program === 'git') {
      if (action === 'status' && rest.every((arg) => ['--short', '--branch'].includes(arg)))
        output = git(cwd, ['status', ...rest]);
      else if (action === 'branch' && rest.length === 0) output = git(cwd, ['branch', '--list']);
      else if (action === 'log' && rest.join(' ') === '-1 --oneline') output = git(cwd, ['log', '-1', '--oneline']);
      else if (action === 'rev-parse' && rest.length === 1 && /^(?:HEAD|HEAD:[^:]+)$/.test(rest[0]!))
        output = git(cwd, ['rev-parse', '--verify', rest[0]!]);
      else if (action === 'ls-tree' && rest.length === 1 && rest[0] === 'HEAD')
        output = git(cwd, ['ls-tree', 'HEAD']);
      else if (action === 'cat-file' && rest.length === 2 && ['-t', '-s'].includes(rest[0]!) &&
        /^(?:[0-9a-f]{40,64}|HEAD:[^:]+)$/.test(rest[1]!))
        output = git(cwd, ['cat-file', rest[0]!, rest[1]!]);
      else if (action === 'diff') output = publicGitDiff(cwd, rest);
      else if (action === 'show' && rest.length === 1 && /^HEAD:[^:]+$/.test(rest[0]!)) {
        const file = rest[0]!.slice('HEAD:'.length);
        const root = gitRoot(cwd);
        if (root && inside(path.resolve(root, file), root) &&
          !checkSecretFileAccess(path.resolve(root, file), 'read').secret)
          output = git(cwd, ['show', `HEAD:${file}`]);
      }
    } else if (program === 'cat' && action && rest.length === 0) {
      const workspace = fs.realpathSync(gitRoot(cwd) ?? cwd);
      const target = fs.realpathSync(path.resolve(cwd, action));
      if (inside(target, workspace) && !checkSecretFileAccess(target, 'read').secret &&
        fs.statSync(target).isFile()) output = fs.readFileSync(target, 'utf8');
    } else if (program === 'pwd' && action === undefined) output = `${cwd}\n`;
    if (output === null) return { success: false, error: DENIED };
    return { success: true, output: redactTrackedGitOutput(output, cwd, command) };
  } catch {
    return { success: false, error: DENIED };
  }
}
