/**
 * One-click "Push to GitHub" for App Studio (G3).
 *
 * Turns a generated project into a real GitHub repository: it initialises git
 * (if needed), writes a sane `.gitignore`, makes an initial commit, then uses
 * the `gh` CLI — detected on the machine exactly like the deploy service probes
 * surge/netlify/vercel — to create the remote repo and push. When `gh` is
 * absent or unauthenticated it falls back to printable instructions (the
 * escape-hatch every competitor ships), never leaving the project half-pushed.
 *
 * @module main/studio/github-service
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type GithubPushResult =
  | { ok: true; data: GithubPushData }
  | { ok: false; error: string };

export interface GithubPushData {
  /** `pushed` = repo created + pushed via gh; `manual` = instructions returned. */
  mode: 'pushed' | 'manual';
  /** Public repo URL when known (parsed from `gh repo create` output). */
  url?: string;
  /** Combined command output for the terminal. */
  log: string;
  /** Copy-paste commands when gh is unavailable/unauthenticated. */
  instructions?: string[];
}

export interface GithubPushRequest {
  root: string;
  /** Repo name; defaults to a sanitised project folder name. */
  name?: string;
  /** Create the repo private (default true — safest for generated apps). */
  private?: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeResolve(root: string): string | null {
  if (!root || root.includes('\0')) return null;
  return path.resolve(root);
}

/** GitHub repo names allow letters, digits, `.`, `_` and `-`. */
export function sanitizeRepoName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return cleaned || 'app-studio-project';
}

function whichCommand(): string {
  return process.platform === 'win32' ? 'where' : 'which';
}

const DEFAULT_GITIGNORE = ['node_modules/', 'dist/', 'build/', '.next/', '.DS_Store', '*.log', '.studio2/'].join('\n') + '\n';

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function extractRepoUrl(output: string): string | undefined {
  return output.match(/https?:\/\/github\.com\/\S+/)?.[0]?.replace(/[.,)]+$/, '');
}

function manualInstructions(repoName: string, isPrivate: boolean): string[] {
  return [
    'git init',
    'git add -A',
    'git commit -m "Initial commit from App Studio"',
    `gh repo create ${repoName} --source . --push ${isPrivate ? '--private' : '--public'}`,
    '# — or, without the gh CLI, create the repo on github.com then:',
    'git remote add origin <your-repo-url>',
    'git push -u origin HEAD',
  ];
}

export class GithubService {
  constructor(private readonly exec: typeof execFileAsync = execFileAsync) {}

  /** Detect a usable, authenticated `gh` CLI. Returns the binary or null. */
  async detectGh(): Promise<string | null> {
    try {
      await this.exec(whichCommand(), ['gh']);
    } catch {
      return null;
    }
    try {
      await this.exec('gh', ['auth', 'status']);
      return 'gh';
    } catch {
      return null; // installed but not logged in — fall back to instructions
    }
  }

  private async git(root: string, args: string[]): Promise<string> {
    const { stdout, stderr } = await this.exec('git', args, { cwd: root });
    return (String(stdout) + String(stderr)).trim();
  }

  /** Ensure the project is a git repo with at least one commit + a .gitignore. */
  private async ensureCommitted(root: string, log: string[]): Promise<void> {
    if (!(await pathExists(path.join(root, '.git')))) {
      await this.git(root, ['init']);
      log.push('git init');
    }
    if (!(await pathExists(path.join(root, '.gitignore')))) {
      await fs.writeFile(path.join(root, '.gitignore'), DEFAULT_GITIGNORE, 'utf8');
      log.push('wrote .gitignore');
    }
    const hasHead = await this.git(root, ['rev-parse', 'HEAD']).then(
      () => true,
      () => false
    );
    // Stage everything; commit only when there is something to commit (a repo
    // that already has HEAD + no changes just pushes the existing history).
    await this.git(root, ['add', '-A']);
    const status = await this.git(root, ['status', '--porcelain']);
    if (!hasHead || status.length > 0) {
      await this.git(root, ['commit', '-m', 'Initial commit from App Studio']);
      log.push('git commit');
    }
  }

  async push(request: GithubPushRequest): Promise<GithubPushResult> {
    const root = safeResolve(request.root);
    if (!root) return { ok: false, error: 'Invalid project root' };
    if (!(await pathExists(root))) return { ok: false, error: 'Project directory does not exist' };

    const repoName = sanitizeRepoName(request.name ?? path.basename(root));
    const isPrivate = request.private ?? true;
    const log: string[] = [];

    try {
      await this.ensureCommitted(root, log);
    } catch (error) {
      return { ok: false, error: `git setup failed: ${errorMessage(error)}` };
    }

    const gh = await this.detectGh();
    if (!gh) {
      return {
        ok: true,
        data: {
          mode: 'manual',
          log: [...log, 'gh CLI not available or not authenticated'].join('\n'),
          instructions: manualInstructions(repoName, isPrivate),
        },
      };
    }

    try {
      // gh repo create with --source/--push creates the remote, adds the
      // origin, and pushes the current branch in one shot.
      const { stdout, stderr } = await this.exec(
        'gh',
        ['repo', 'create', repoName, '--source', '.', '--push', isPrivate ? '--private' : '--public'],
        { cwd: root }
      );
      const ghLog = (String(stdout) + String(stderr)).trim();
      log.push(`gh repo create ${repoName}`);
      const url = extractRepoUrl(ghLog);
      return {
        ok: true,
        data: {
          mode: 'pushed',
          ...(url ? { url } : {}),
          log: [...log, ghLog].filter(Boolean).join('\n'),
        },
      };
    } catch (error) {
      // gh failed (repo name taken, network, scopes) — hand back instructions
      // instead of a dead end so the user can finish by hand.
      return {
        ok: true,
        data: {
          mode: 'manual',
          log: [...log, `gh repo create failed: ${errorMessage(error)}`].join('\n'),
          instructions: manualInstructions(repoName, isPrivate),
        },
      };
    }
  }
}
