/**
 * Git Worktree Handlers
 *
 * Manage git worktrees for parallel Grok CLI instances.
 * Inspired by Claude Code's git worktree workflow.
 *
 * Git worktrees allow running multiple instances on different branches
 * simultaneously without stashing or switching.
 */

import { ChatEntry } from "../../agent/grok-agent.js";
import { execSync, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface CommandHandlerResult {
  handled: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
}

interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
  detached: boolean;
  locked?: boolean;
  prunable?: boolean;
}

/**
 * Handle /worktree command
 */
export function handleWorktree(args: string[]): CommandHandlerResult {
  const action = args[0]?.toLowerCase();

  let content: string;

  try {
    switch (action) {
      case 'add':
      case 'create':
        content = addWorktree(args.slice(1));
        break;

      case 'remove':
      case 'rm':
      case 'delete':
        content = removeWorktree(args.slice(1));
        break;

      case 'list':
      case 'ls':
        content = listWorktrees();
        break;

      case 'prune':
        content = pruneWorktrees();
        break;

      case 'lock':
        content = lockWorktree(args[1]);
        break;

      case 'unlock':
        content = unlockWorktree(args[1]);
        break;

      case 'move':
        content = moveWorktree(args[1], args[2]);
        break;

      case 'help':
      default:
        content = getWorktreeHelp();
        break;
    }
  } catch (error) {
    content = `❌ Git worktree error: ${error instanceof Error ? error.message : String(error)}`;
  }

  return {
    handled: true,
    entry: {
      type: "assistant",
      content,
      timestamp: new Date(),
    },
  };
}

/**
 * Add a new worktree
 */
function addWorktree(args: string[]): string {
  if (args.length < 1) {
    return `❌ Usage: /worktree add <path> [branch]

Examples:
  /worktree add ../feature-auth feature/auth
  /worktree add ../bugfix-123 bugfix/issue-123
  /worktree add ../experiment  (creates new branch from HEAD)`;
  }

  const worktreePath = args[0];
  const branch = args[1];
  const resolvedPath = path.resolve(worktreePath);
  const dirName = path.basename(resolvedPath);

  // Check if path already exists
  if (fs.existsSync(resolvedPath)) {
    return `❌ Path already exists: ${resolvedPath}

Remove it first or choose a different path.`;
  }

  let cmd: string;
  let branchName: string;

  if (branch) {
    // Check if branch exists
    try {
      execSync(`git rev-parse --verify ${branch}`, { stdio: 'pipe' });
      // Branch exists, just add worktree
      cmd = `git worktree add "${resolvedPath}" ${branch}`;
      branchName = branch;
    } catch {
      // Branch doesn't exist, create it
      cmd = `git worktree add -b ${branch} "${resolvedPath}"`;
      branchName = branch;
    }
  } else {
    // No branch specified, create new branch from directory name
    branchName = dirName;
    cmd = `git worktree add -b ${branchName} "${resolvedPath}"`;
  }

  try {
    execSync(cmd, { stdio: 'pipe' });

    return `✅ Worktree created successfully!

📁 Path: ${resolvedPath}
🌿 Branch: ${branchName}

To start a new Grok CLI instance:
  cd ${resolvedPath} && grok

💡 Tips:
  • Each worktree is isolated - changes don't affect other worktrees
  • Run multiple Grok instances in parallel on different features
  • Use /worktree list to see all worktrees
  • Use /worktree remove ${worktreePath} when done`;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create worktree: ${errorMsg}`);
  }
}

/**
 * Remove a worktree
 */
function removeWorktree(args: string[]): string {
  if (args.length < 1) {
    return `❌ Usage: /worktree remove <path>

Use /worktree list to see available worktrees.`;
  }

  const worktreePath = args[0];
  const force = args.includes('--force') || args.includes('-f');
  const resolvedPath = path.resolve(worktreePath);

  // Check if we're trying to remove current worktree
  const cwd = process.cwd();
  if (resolvedPath === cwd || cwd.startsWith(resolvedPath + path.sep)) {
    return `❌ Cannot remove current worktree

You're currently in: ${cwd}
Worktree to remove: ${resolvedPath}

Change to a different directory first:
  cd .. && grok -d ${process.cwd()}`;
  }

  const cmd = force
    ? `git worktree remove --force "${resolvedPath}"`
    : `git worktree remove "${resolvedPath}"`;

  try {
    execSync(cmd, { stdio: 'pipe' });
    return `✅ Worktree removed: ${resolvedPath}`;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (errorMsg.includes('contains modified or untracked files')) {
      return `⚠️ Worktree has uncommitted changes

Path: ${resolvedPath}

Options:
  • Commit or stash your changes first
  • Use /worktree remove ${worktreePath} --force to force removal`;
    }

    throw new Error(`Failed to remove worktree: ${errorMsg}`);
  }
}

/**
 * List all worktrees
 */
function listWorktrees(): string {
  const worktrees = getWorktrees();

  if (worktrees.length === 0) {
    return `📁 No worktrees found (not a git repository?)`;
  }

  const lines: string[] = [
    '📁 Git Worktrees',
    '═'.repeat(50),
    '',
  ];

  const cwd = process.cwd();

  for (const wt of worktrees) {
    const isCurrent = wt.path === cwd || cwd.startsWith(wt.path + path.sep);
    const status: string[] = [];

    if (isCurrent) status.push('current');
    if (wt.bare) status.push('bare');
    if (wt.detached) status.push('detached');
    if (wt.locked) status.push('locked');
    if (wt.prunable) status.push('prunable');

    const statusStr = status.length > 0 ? ` (${status.join(', ')})` : '';
    const marker = isCurrent ? '→' : ' ';

    lines.push(`${marker} ${wt.path}`);
    lines.push(`    Branch: ${wt.branch || wt.head.slice(0, 8)}${statusStr}`);
    lines.push('');
  }

  lines.push('Commands:');
  lines.push('  /worktree add <path> [branch]  - Create new worktree');
  lines.push('  /worktree remove <path>        - Remove worktree');

  return lines.join('\n');
}

/**
 * Prune stale worktrees
 */
function pruneWorktrees(): string {
  try {
    // First, do a dry run
    const dryRun = execSync('git worktree prune --dry-run', { encoding: 'utf-8' });

    if (!dryRun.trim()) {
      return `✅ No stale worktrees to prune`;
    }

    // Actually prune
    execSync('git worktree prune', { stdio: 'pipe' });

    return `✅ Pruned stale worktrees:

${dryRun}`;
  } catch (error) {
    throw new Error(`Failed to prune worktrees: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Lock a worktree
 */
function lockWorktree(worktreePath?: string): string {
  if (!worktreePath) {
    return `❌ Usage: /worktree lock <path>`;
  }

  const resolvedPath = path.resolve(worktreePath);

  try {
    execSync(`git worktree lock "${resolvedPath}"`, { stdio: 'pipe' });
    return `🔒 Worktree locked: ${resolvedPath}

This worktree will not be pruned automatically.
Use /worktree unlock ${worktreePath} to unlock.`;
  } catch (error) {
    throw new Error(`Failed to lock worktree: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Unlock a worktree
 */
function unlockWorktree(worktreePath?: string): string {
  if (!worktreePath) {
    return `❌ Usage: /worktree unlock <path>`;
  }

  const resolvedPath = path.resolve(worktreePath);

  try {
    execSync(`git worktree unlock "${resolvedPath}"`, { stdio: 'pipe' });
    return `🔓 Worktree unlocked: ${resolvedPath}`;
  } catch (error) {
    throw new Error(`Failed to unlock worktree: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Move a worktree
 */
function moveWorktree(oldPath?: string, newPath?: string): string {
  if (!oldPath || !newPath) {
    return `❌ Usage: /worktree move <old-path> <new-path>`;
  }

  const resolvedOld = path.resolve(oldPath);
  const resolvedNew = path.resolve(newPath);

  try {
    execSync(`git worktree move "${resolvedOld}" "${resolvedNew}"`, { stdio: 'pipe' });
    return `✅ Worktree moved: ${resolvedOld} → ${resolvedNew}`;
  } catch (error) {
    throw new Error(`Failed to move worktree: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get list of worktrees
 */
function getWorktrees(): WorktreeInfo[] {
  try {
    const output = execSync('git worktree list --porcelain', { encoding: 'utf-8' });
    const worktrees: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> = {};

    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) {
          worktrees.push(current as WorktreeInfo);
        }
        current = { path: line.slice(9) };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace('refs/heads/', '');
      } else if (line === 'bare') {
        current.bare = true;
      } else if (line === 'detached') {
        current.detached = true;
      } else if (line === 'locked') {
        current.locked = true;
      } else if (line === 'prunable') {
        current.prunable = true;
      }
    }

    if (current.path) {
      worktrees.push(current as WorktreeInfo);
    }

    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Get worktree help
 */
function getWorktreeHelp(): string {
  return `📁 Git Worktrees - Parallel Development
═══════════════════════════════════════════════════

Git worktrees let you work on multiple branches simultaneously,
each in its own directory. Perfect for running multiple Grok
instances in parallel!

📋 Commands:
  /worktree                        - Show this help
  /worktree list                   - List all worktrees
  /worktree add <path> [branch]    - Create new worktree
  /worktree remove <path>          - Remove worktree
  /worktree move <old> <new>       - Move worktree
  /worktree lock <path>            - Prevent auto-pruning
  /worktree unlock <path>          - Allow auto-pruning
  /worktree prune                  - Clean up stale worktrees

📌 Examples:
  /worktree add ../feature-auth feature/auth
  /worktree add ../bugfix-123
  /worktree remove ../feature-auth

🚀 Workflow:
  1. Create a worktree for a new feature
  2. Open a new terminal and cd to that worktree
  3. Run \`grok\` to start a new instance
  4. Work on multiple features in parallel!

💡 Tips:
  • Each worktree has its own working directory and index
  • Changes in one worktree don't affect others
  • All worktrees share the same git history
  • Great for code reviews, experiments, or parallel features`;
}
