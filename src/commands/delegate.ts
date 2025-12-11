/**
 * /delegate Command - Automated PR Creation (GitHub Copilot CLI inspired)
 *
 * Delegates a task to run in the background:
 * 1. Creates a new branch from current HEAD
 * 2. Commits any unstaged changes
 * 3. Creates a draft PR
 * 4. Agent works on the task
 * 5. Requests review when done
 *
 * Usage: /delegate Fix all TypeScript errors
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';

const execAsync = promisify(exec);

export interface DelegateConfig {
  /** Task description */
  task: string;
  /** Base branch (default: current branch) */
  baseBranch?: string;
  /** Create draft PR */
  draft?: boolean;
  /** Assign reviewers */
  reviewers?: string[];
  /** PR labels */
  labels?: string[];
  /** Auto-merge when checks pass */
  autoMerge?: boolean;
}

export interface DelegateResult {
  success: boolean;
  branchName?: string;
  prUrl?: string;
  prNumber?: number;
  error?: string;
}

/**
 * Generate branch name from task description
 */
export function generateBranchName(task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);

  const hash = crypto.randomBytes(3).toString('hex');
  return `grok/${slug}-${hash}`;
}

/**
 * Check if we're in a git repository
 */
export async function isGitRepo(): Promise<boolean> {
  try {
    await execAsync('git rev-parse --is-inside-work-tree');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(): Promise<string> {
  const { stdout } = await execAsync('git branch --show-current');
  return stdout.trim();
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(): Promise<boolean> {
  const { stdout } = await execAsync('git status --porcelain');
  return stdout.trim().length > 0;
}

/**
 * Create a new branch
 */
export async function createBranch(branchName: string): Promise<void> {
  await execAsync(`git checkout -b ${branchName}`);
}

/**
 * Commit all changes
 */
export async function commitChanges(message: string): Promise<void> {
  await execAsync('git add -A');
  await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`);
}

/**
 * Push branch to remote
 */
export async function pushBranch(branchName: string): Promise<void> {
  await execAsync(`git push -u origin ${branchName}`);
}

/**
 * Check if gh CLI is available
 */
export async function hasGhCli(): Promise<boolean> {
  try {
    await execAsync('gh --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a pull request using gh CLI
 */
export async function createPullRequest(
  title: string,
  body: string,
  baseBranch: string,
  draft: boolean = true,
  labels: string[] = [],
  reviewers: string[] = []
): Promise<{ url: string; number: number }> {
  let cmd = `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --base ${baseBranch}`;

  if (draft) {
    cmd += ' --draft';
  }

  if (labels.length > 0) {
    cmd += ` --label "${labels.join(',')}"`;
  }

  if (reviewers.length > 0) {
    cmd += ` --reviewer "${reviewers.join(',')}"`;
  }

  const { stdout } = await execAsync(cmd);

  // Parse PR URL and number from output
  const urlMatch = stdout.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
  if (urlMatch) {
    return {
      url: urlMatch[0],
      number: parseInt(urlMatch[1], 10),
    };
  }

  throw new Error('Failed to parse PR URL from gh output');
}

/**
 * Add comment to PR
 */
export async function addPRComment(prNumber: number, comment: string): Promise<void> {
  await execAsync(`gh pr comment ${prNumber} --body "${comment.replace(/"/g, '\\"')}"`);
}

/**
 * Request review on PR
 */
export async function requestReview(prNumber: number, reviewers: string[]): Promise<void> {
  if (reviewers.length > 0) {
    await execAsync(`gh pr edit ${prNumber} --add-reviewer "${reviewers.join(',')}"`);
  }
}

/**
 * Mark PR as ready for review (remove draft status)
 */
export async function markReady(prNumber: number): Promise<void> {
  await execAsync(`gh pr ready ${prNumber}`);
}

/**
 * Main delegate function
 */
export async function delegate(config: DelegateConfig): Promise<DelegateResult> {
  try {
    // Validate environment
    if (!(await isGitRepo())) {
      return { success: false, error: 'Not a git repository' };
    }

    if (!(await hasGhCli())) {
      return { success: false, error: 'gh CLI not installed. Install from https://cli.github.com' };
    }

    const currentBranch = await getCurrentBranch();
    const baseBranch = config.baseBranch || currentBranch;
    const branchName = generateBranchName(config.task);

    console.log(`Creating branch: ${branchName}`);

    // Commit any unstaged changes first
    if (await hasUncommittedChanges()) {
      console.log('Committing unstaged changes...');
      await commitChanges(`WIP: Starting task - ${config.task}`);
    }

    // Create new branch
    await createBranch(branchName);

    // Push branch
    console.log('Pushing branch to remote...');
    await pushBranch(branchName);

    // Create PR body
    const prBody = `## Task

${config.task}

## Status

This PR was created by Grok CLI using \`/delegate\`.

The agent is working on this task in the background.

---

Generated with [Grok CLI](https://github.com/phuetz/grok-cli)`;

    // Create PR
    console.log('Creating pull request...');
    const pr = await createPullRequest(
      `[Grok] ${config.task.slice(0, 60)}${config.task.length > 60 ? '...' : ''}`,
      prBody,
      baseBranch,
      config.draft !== false,
      config.labels || ['grok-cli', 'automated'],
      config.reviewers || []
    );

    console.log(`Pull request created: ${pr.url}`);

    return {
      success: true,
      branchName,
      prUrl: pr.url,
      prNumber: pr.number,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Complete delegation - mark PR ready and request review
 */
export async function completeDelegate(
  prNumber: number,
  summary: string,
  reviewers: string[] = []
): Promise<void> {
  // Add completion comment
  await addPRComment(prNumber, `## Task Completed

${summary}

---

Ready for review.`);

  // Mark as ready
  await markReady(prNumber);

  // Request review
  if (reviewers.length > 0) {
    await requestReview(prNumber, reviewers);
  }
}

/**
 * Abort delegation - close PR and delete branch
 */
export async function abortDelegate(
  prNumber: number,
  reason: string
): Promise<void> {
  await addPRComment(prNumber, `## Task Aborted

${reason}`);

  await execAsync(`gh pr close ${prNumber} --delete-branch`);
}
