/**
 * Shared helpers for `buddy dev plan|run|pr|fix-ci`.
 *
 * Pure enough to unit-test: persist PLAN.md, refuse an empty plan,
 * resume a run from that plan, conventional-commit named files,
 * fail-closed PR creation, and non-blocking stdin for fix-ci.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function emptyGitHooksDir(): string {
  const dir = path.join(os.tmpdir(), 'codebuddy-empty-git-hooks');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const DEV_PLAN_FILE = 'PLAN.md';



const CONVENTIONAL_SUBJECT = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)(\([^)]+\))?!?: .+/;

/** Strip middleware noise so an empty LLM reply cannot hide behind a guard hint. */
export function stripGuardNoise(text: string): string {
  return text
    .replace(/\[workflow-guard\][^\n]*/g, '')
    .replace(/\[verification-enforcement\][^\n]*/g, '')
    .replace(/\[tokens:[^\]]*\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A plan is meaningful when it is more than a greeting and lists steps
 * or files. Guard-only output is not a plan.
 */
export function isMeaningfulPlan(text: string): boolean {
  const cleaned = stripGuardNoise(text);
  if (cleaned.length < 40) return false;
  if (/^\s*(\d+[\.)]|[-*]\s+)/m.test(cleaned)) return true;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 12 && /\b[\w./-]+\.\w{1,8}\b/.test(cleaned)) return true;
  return false;
}

export function formatDevPlan(objective: string, body: string): string {
  return `# Plan\n\nObjective: ${objective.trim()}\n\n${stripGuardNoise(body)}\n`;
}

export function writeDevPlan(cwd: string, objective: string, body: string): string {
  const filePath = path.join(cwd, DEV_PLAN_FILE);
  fs.writeFileSync(filePath, formatDevPlan(objective, body), 'utf8');
  return filePath;
}

export function parseDevPlan(content: string): { objective: string; body: string } {
  const objectiveMatch = content.match(/^Objective:\s*(.+)$/m);
  const objective = objectiveMatch?.[1]?.trim() ?? '';
  const body = content.replace(/^# Plan\s*/m, '').replace(/^Objective:\s*.+\n*/m, '').trim();
  return { objective, body };
}

export function readDevPlan(cwd: string): { objective: string; body: string; path: string } | null {
  const candidates = [
    path.join(cwd, DEV_PLAN_FILE),
    path.join(cwd, '.codebuddy', DEV_PLAN_FILE),
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const parsed = parseDevPlan(fs.readFileSync(filePath, 'utf8'));
    if (!parsed.objective && !parsed.body) continue;
    return { ...parsed, path: filePath };
  }
  return null;
}

export function resolveRunObjective(
  cliObjective: string | undefined,
  cwd: string,
): { objective: string; source: 'cli' | 'plan' } {
  const trimmed = cliObjective?.trim();
  if (trimmed) return { objective: trimmed, source: 'cli' };
  const plan = readDevPlan(cwd);
  if (plan?.objective) return { objective: plan.objective, source: 'plan' };
  throw new Error(
    'No objective. Pass one to `buddy dev run "<objective>"` or run `buddy dev plan` first (writes PLAN.md).',
  );
}

export function workflowExitCode(status: 'completed' | 'failed' | 'cancelled' | string): number {
  return status === 'completed' ? 0 : 1;
}

export function isPlanOnlyPrompt(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /do not implement yet/.test(lower) ||
    /\bplan only\b/.test(lower) ||
    /start with plan only/.test(lower)
  );
}

export function isAutoCommitPath(relativePath: string): boolean {
  const n = relativePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (n === 'node_modules' || n.startsWith('node_modules/')) return false;
  if (n === '.codebuddy') return false;
  if (n.startsWith('.codebuddy/') && n !== '.codebuddy/PLAN.md') return false;
  return true;
}

export function buildConventionalCommitMessage(
  type: 'fix' | 'feat' | 'ci' | 'chore',
  objective: string,
): string {
  const subject = objective.replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
  const header = `${type}: ${subject}`.slice(0, 72);
  if (CONVENTIONAL_SUBJECT.test(header)) return header;
  return `${type}: update`;
}

export function isConventionalCommitMessage(message: string): boolean {
  const firstLine = message.split('\n')[0]?.trim() ?? '';
  return CONVENTIONAL_SUBJECT.test(firstLine);
}

function git(cwd: string, args: string[], allowFail = false): string {
  try {
    return execFileSync('git', ['-c', 'color.ui=never', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    if (allowFail) {
      const e = err as { stdout?: string; stderr?: string };
      return `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
    }
    throw err;
  }
}

export function parseGitStatusPorcelain(raw: string): string[] {
  const files: string[] = [];
  for (const line of raw.split('\n')) {
    const plain = line.replace(/\x1B\[[0-9;]*m/g, '');
    if (!plain.trim() || plain.startsWith('##')) continue;
    const renamed = plain.match(/^.{2} (.+) -> (.+)$/);
    const normal = plain.match(/^.{2} (.+)$/);
    const target = (renamed?.[2] ?? normal?.[1] ?? '').trim();
    const rel = target.replace(/^"|"$/g, '');
    if (rel && isAutoCommitPath(rel)) files.push(rel);
  }
  return files;
}

export function listNamedChanges(cwd: string): string[] {
  try {
    const raw = execFileSync('git', ['-c', 'color.ui=never', 'status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseGitStatusPorcelain(raw);
  } catch {
    return [];
  }
}

export function conventionalCommitNamedFiles(
  cwd: string,
  message: string,
): { committed: boolean; hash?: string; files: string[]; error?: string } {
  if (!isConventionalCommitMessage(message)) {
    return { committed: false, files: [], error: `Refusing non-conventional commit message: ${message}` };
  }
  const files = listNamedChanges(cwd);
  if (files.length === 0) return { committed: false, files: [] };
  try {
    execFileSync('git', ['add', '--', ...files], { cwd, stdio: 'pipe' });
    execFileSync(
      'git',
      ['-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${emptyGitHooksDir()}`, 'commit', '-m', message],
      { cwd, stdio: 'pipe' },
    );
    const hash = git(cwd, ['rev-parse', 'HEAD']);
    return { committed: true, hash, files };
  } catch (err) {
    return {
      committed: false,
      files,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function isLocalGitRemote(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/github\.com|gitlab\.com|bitbucket\.org|git@/i.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed) && !/^https?:\/\/(127\.0\.0\.1|localhost)\b/i.test(trimmed)) {
    return false;
  }
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('.') ||
    trimmed.startsWith('file://') ||
    /^[A-Za-z]:[\\/]/.test(trimmed)
  );
}

export interface PullRequestAttempt {
  title: string;
  body: string;
  created: boolean;
  pushed: boolean;
  url?: string;
  error?: string;
}

export function buildPrTitleAndBody(cwd: string, objective?: string): { title: string; body: string } {
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], true) || 'HEAD';
  const log = git(cwd, ['log', '--oneline', '-15'], true);
  const stat = git(cwd, ['diff', '--stat', 'HEAD'], true);
  const titleSource = objective?.trim() || log.split('\n')[0]?.replace(/^[a-f0-9]+\s+/, '') || branch;
  const title = titleSource.slice(0, 70);
  const body = [
    '## Summary',
    '',
    `- Branch: \`${branch}\``,
    objective ? `- Objective: ${objective.trim()}` : '',
    '',
    '## Commits',
    '',
    log || '(no commits)',
    '',
    '## Working tree',
    '',
    '```',
    stat || '(clean)',
    '```',
    '',
    '## Test plan',
    '',
    '- [ ] `npm test`',
    '- [ ] `npm run ci`',
  ]
    .filter((line) => line !== '')
    .join('\n');
  return { title, body };
}

export function attemptPullRequest(
  cwd: string,
  title: string,
  body: string,
  execGh: (args: string[]) => { ok: boolean; output: string } = defaultGh,
): PullRequestAttempt {
  const result: PullRequestAttempt = { title, body, created: false, pushed: false };
  const gh = execGh(['pr', 'create', '--title', title, '--body', body]);
  if (gh.ok) {
    const url = gh.output.match(/https:\/\/\S+/)?.[0] ?? gh.output.trim();
    result.created = true;
    result.url = url;
    return result;
  }
  result.error = gh.output.trim() || 'gh pr create failed';

  const origin = git(cwd, ['remote', 'get-url', 'origin'], true);
  if (origin && isLocalGitRemote(origin)) {
    try {
      git(cwd, ['push', '-u', 'origin', 'HEAD']);
      result.pushed = true;
      result.error = undefined;
    } catch (err) {
      result.error = `${result.error}; local push failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return result;
}

function defaultGh(args: string[]): { ok: boolean; output: string } {
  try {
    const output = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${e.stderr ?? ''}${e.stdout ?? ''}${e.message ?? ''}`.trim() };
  }
}

/**
 * Read stdin if it is a pipe that actually delivers bytes.
 * An open pipe with no data (agent/CI spawn) must NOT hang: after
 * `firstByteMs` without a byte we treat it as "no log provided".
 */
export async function readStdinIfPiped(
  stdin: NodeJS.ReadStream = process.stdin,
  firstByteMs = 400,
  maxBytes = 200_000,
): Promise<string | null> {
  if (stdin.isTTY) return null;

  return await new Promise((resolve) => {
    let data = '';
    let settled = false;
    let gotByte = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      stdin.removeListener('error', onEnd);
      try {
        stdin.pause();
      } catch {
        // ignore
      }
      resolve(value);
    };

    const timer = setTimeout(() => {
      if (!gotByte) finish(null);
    }, firstByteMs);

    const onData = (chunk: Buffer | string) => {
      gotByte = true;
      data += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (data.length >= maxBytes) finish(data.slice(0, maxBytes));
    };
    const onEnd = () => finish(gotByte ? data : data.length ? data : '');

    stdin.on('data', onData);
    stdin.once('end', onEnd);
    stdin.once('error', onEnd);
    if (typeof stdin.resume === 'function') stdin.resume();
  });
}

export function isShellWriteCommand(command: string): boolean {
  const c = command.trim();
  if (!c) return false;
  if (/(?:^|\s)(?:tee|install|cp|mv|rm|touch|mkdir|dd|truncate)\b/.test(c)) return true;
  if (/(?:^|&&|\|\||;)\s*(?:cat|printf|echo)\b[\s\S]*[>\u003e]/.test(c)) return true;
  if (/[>\u003e]{1,2}\s*\/|[>\u003e]{1,2}\s*\S/.test(c) && !/\b2>\s*\/dev\/null\b/.test(c.split('>')[0] ?? '')) {
    if (/(?:^|\s)(?:grep|rg|find|ls|head|tail|wc|git|npm|node|python)\b/.test(c) && !/[>\u003e]/.test(c)) {
      return false;
    }
    if (/[>\u003e]/.test(c) && !/2>\s*\/dev\/null/.test(c)) return true;
  }
  if (/<<['"]?\w+/.test(c)) return true;
  return false;
}
