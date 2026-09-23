/**
 * PR Handlers
 *
 * Implements /pr slash command for creating GitHub/GitLab PRs from the current branch.
 * - Detects base branch (main/master/develop)
 * - Uses gh (GitHub CLI) or glab (GitLab CLI) to create PRs
 * - Falls back to showing the manual command if CLIs are unavailable
 * - Supports --draft flag
 */

import { execFileSync, spawnSync } from 'child_process';
import { logger } from '../../utils/logger.js';

export interface CommandHandlerResult {
  handled: boolean;
  failed?: boolean;
  entry?: {
    type: 'assistant' | 'user';
    content: string;
    timestamp: Date;
  };
  passToAI?: boolean;
  prompt?: string;
}

/**
 * Detect which PR CLI is available: 'gh', 'glab', or null.
 */
function detectPRCli(): 'gh' | 'glab' | null {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';

  try {
    spawnSync(whichCmd, ['gh'], { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    const result = spawnSync(whichCmd, ['gh'], { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    if (result.status === 0) return 'gh';
  } catch {
    // gh not found
  }

  try {
    const result = spawnSync(whichCmd, ['glab'], { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    if (result.status === 0) return 'glab';
  } catch {
    // glab not found
  }

  return null;
}

/**
 * Get the current git branch name.
 */
function getCurrentBranch(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Detect the base branch (main, master, or develop).
 */
function detectBaseBranch(cwd: string): string {
  const candidates = ['main', 'master', 'develop'];

  for (const branch of candidates) {
    try {
      const result = spawnSync('git', ['rev-parse', '--verify', branch], {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      });
      if (result.status === 0) return branch;
    } catch {
      // branch doesn't exist, try next
    }
  }

  // Also try origin references
  for (const branch of candidates) {
    try {
      const result = spawnSync('git', ['rev-parse', '--verify', `origin/${branch}`], {
        cwd,
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      });
      if (result.status === 0) return branch;
    } catch {
      // branch doesn't exist, try next
    }
  }

  return 'main'; // default fallback
}

/**
 * Get a short summary of the git diff from the base branch.
 */
function getDiffSummary(cwd: string, baseBranch: string): string {
  try {
    const stat = execFileSync('git', ['diff', `${baseBranch}...HEAD`, '--stat'], {
      cwd,
      encoding: 'utf-8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    }).trim();
    return stat || 'No changes detected.';
  } catch {
    return 'Could not retrieve diff summary.';
  }
}

/**
 * Get recent commit messages from the branch.
 */
function getCommitMessages(cwd: string, baseBranch: string): string[] {
  try {
    const log = execFileSync('git', ['log', `${baseBranch}..HEAD`, '--oneline', '--max-count=20'], {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return log ? log.split('\n') : [];
  } catch {
    return [];
  }
}

/**
 * Parse PR handler args: extract --draft flag and title text.
 */
function parsePRArgs(args: string[]): { title: string; draft: boolean } {
  let draft = false;
  const titleParts: string[] = [];

  for (const arg of args) {
    if (arg === '--draft' || arg === '-d') {
      draft = true;
    } else {
      titleParts.push(arg);
    }
  }

  return { title: titleParts.join(' ').trim(), draft };
}

/**
 * /pr — Create a GitHub/GitLab PR from current branch.
 *
 * Usage:
 *   /pr                — Auto-generate title and description
 *   /pr My PR title    — Use specified title
 *   /pr --draft        — Create as draft PR
 *   /pr --draft Title  — Draft PR with specific title
 */
export async function handlePR(args: string[]): Promise<CommandHandlerResult> {
  const cwd = process.cwd();

  // Verify we're in a git repo
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'pipe', timeout: 5000 });
  } catch {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'Not inside a git repository. Navigate to a git project first.',
        timestamp: new Date(),
      },
    };
  }

  // Get current branch
  const currentBranch = getCurrentBranch(cwd);
  if (!currentBranch) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'Could not determine the current branch.',
        timestamp: new Date(),
      },
    };
  }

  // Detect base branch
  const baseBranch = detectBaseBranch(cwd);

  // Prevent PR from base to itself
  if (currentBranch === baseBranch) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Cannot create PR: you are on the base branch (${baseBranch}). Switch to a feature branch first.\n\nUsage: git checkout -b my-feature`,
        timestamp: new Date(),
      },
    };
  }

  // Parse args
  const { title: userTitle, draft } = parsePRArgs(args);

  // Get diff summary and commits
  const diffSummary = getDiffSummary(cwd, baseBranch);
  const commits = getCommitMessages(cwd, baseBranch);

  // Build title
  const title = userTitle || buildTitleFromBranch(currentBranch, commits);

  // Build description
  const description = buildDescription(commits, diffSummary);

  // Detect CLI
  const cli = detectPRCli();

  if (!cli) {
    // No CLI available — show manual instructions
    const ghCmd = `gh pr create --base ${baseBranch} --title "${title}"${draft ? ' --draft' : ''} --body "${description.replace(/"/g, '\\"')}"`;
    const glabCmd = `glab mr create --target-branch ${baseBranch} --title "${title}"${draft ? ' --draft' : ''} --description "${description.replace(/"/g, '\\"')}"`;

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: [
          'Neither `gh` (GitHub CLI) nor `glab` (GitLab CLI) was found.',
          '',
          'Install one of:',
          '  GitHub: https://cli.github.com/',
          '  GitLab: https://gitlab.com/gitlab-org/cli',
          '',
          'Then run manually:',
          '',
          '**GitHub:**',
          '```',
          ghCmd,
          '```',
          '',
          '**GitLab:**',
          '```',
          glabCmd,
          '```',
        ].join('\n'),
        timestamp: new Date(),
      },
    };
  }

  // Build CLI command
  let cliArgs: string[];
  if (cli === 'gh') {
    cliArgs = ['pr', 'create', '--base', baseBranch, '--title', title];
    if (draft) cliArgs.push('--draft');
    cliArgs.push('--body', description);
  } else {
    cliArgs = ['mr', 'create', '--target-branch', baseBranch, '--title', title];
    if (draft) cliArgs.push('--draft');
    cliArgs.push('--description', description);
  }

  // Execute the command
  try {
    const result = execFileSync(cli, cliArgs, {
      cwd,
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    }).trim();

    // Extract URL from output (gh and glab both typically output the PR URL)
    const urlMatch = result.match(/https?:\/\/\S+/);
    const prUrl = urlMatch ? urlMatch[0] : null;

    const typeLabel = cli === 'gh' ? 'Pull request' : 'Merge request';
    const draftLabel = draft ? ' (draft)' : '';

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: [
          `${typeLabel} created${draftLabel}!`,
          '',
          `  Branch: ${currentBranch} -> ${baseBranch}`,
          `  Title:  ${title}`,
          prUrl ? `  URL:    ${prUrl}` : '',
          '',
          'Output:',
          '```',
          result,
          '```',
        ].filter(Boolean).join('\n'),
        timestamp: new Date(),
      },
    };
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    const output = [execError.stdout, execError.stderr, execError.message]
      .filter(Boolean)
      .join('\n')
      .trim();

    logger.error('/pr creation failed', { error: output });

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: [
          'PR creation failed.',
          '',
          '```',
          output || 'Unknown error',
          '```',
          '',
          'You may need to:',
          '  - Push your branch first: `git push -u origin ' + currentBranch + '`',
          '  - Authenticate: `gh auth login` or `glab auth login`',
        ].join('\n'),
        timestamp: new Date(),
      },
    };
  }
}

/**
 * Build a reasonable PR title from the branch name and commits.
 */
function buildTitleFromBranch(branchName: string, commits: string[]): string {
  // If there's exactly one commit, use its message
  const firstCommit = commits[0];
  if (commits.length === 1 && firstCommit !== undefined) {
    // Remove the short hash prefix
    const msg = firstCommit.replace(/^[a-f0-9]+ /, '');
    return msg;
  }

  // Otherwise derive from branch name
  return branchName
    .replace(/^(feature|bugfix|fix|hotfix|chore|docs|refactor|test)[-/]/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Build the PR body/description.
 */
function buildDescription(commits: string[], diffSummary: string): string {
  const sections: string[] = [];

  if (commits.length > 0) {
    sections.push('## Commits');
    sections.push('');
    for (const commit of commits.slice(0, 10)) {
      sections.push(`- ${commit}`);
    }
    if (commits.length > 10) {
      sections.push(`- ... and ${commits.length - 10} more`);
    }
  }

  if (diffSummary && diffSummary !== 'No changes detected.') {
    sections.push('');
    sections.push('## Changes');
    sections.push('');
    sections.push('```');
    sections.push(diffSummary);
    sections.push('```');
  }

  return sections.join('\n');
}
