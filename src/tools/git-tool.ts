import { spawn } from "child_process";
import * as path from "path";
import { ToolResult, getErrorMessage } from "../types/index.js";
import { ConfirmationService } from "../utils/confirmation-service.js";

/**
 * Execute a command safely using spawn with array arguments
 * This prevents command injection attacks
 */
function execGitSafe(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || `git ${args[0]} failed with code ${code}`));
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

export interface GitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  branch: string;
  ahead: number;
  behind: number;
}

export interface CommitOptions {
  message?: string;
  autoGenerate?: boolean;
  push?: boolean;
  addAll?: boolean;
}

export class GitTool {
  private confirmationService = ConfirmationService.getInstance();
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  /**
   * Execute git command safely with array arguments
   * @param args - Array of command arguments (NOT a single string)
   */
  private async execGit(args: string[]): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execGitSafe(args, this.cwd);
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error));
    }
  }

  async isGitRepo(): Promise<boolean> {
    try {
      await this.execGit(['rev-parse', '--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<GitStatus> {
    // Execute both git status commands in parallel
    const [{ stdout: porcelain }, { stdout: branchInfo }] = await Promise.all([
      this.execGit(['status', '--porcelain=v1']),
      this.execGit(['status', '--branch', '--porcelain=v2']),
    ]);

    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    for (const line of porcelain.split("\n").filter(Boolean)) {
      const indexStatus = line[0];
      const workTreeStatus = line[1];
      const file = line.slice(3);

      if (indexStatus === "?" && workTreeStatus === "?") {
        untracked.push(file);
      } else {
        if (indexStatus !== " " && indexStatus !== "?") {
          staged.push(file);
        }
        if (workTreeStatus !== " " && workTreeStatus !== "?") {
          unstaged.push(file);
        }
      }
    }

    // Parse branch info
    let branch = "unknown";
    let ahead = 0;
    let behind = 0;

    for (const line of branchInfo.split("\n")) {
      if (line.startsWith("# branch.head")) {
        branch = line.split(" ")[2] || "unknown";
      } else if (line.startsWith("# branch.ab")) {
        const match = line.match(/\+(\d+)\s+-(\d+)/);
        if (match) {
          ahead = parseInt(match[1]);
          behind = parseInt(match[2]);
        }
      }
    }

    return { staged, unstaged, untracked, branch, ahead, behind };
  }

  async getDiff(staged: boolean = false): Promise<string> {
    const args = staged ? ['diff', '--cached'] : ['diff'];
    const { stdout } = await this.execGit(args);
    return stdout;
  }

  async getLog(count: number = 5): Promise<string> {
    const { stdout } = await this.execGit(
      ['log', '--oneline', `-${count}`, '--format=%h %s']
    );
    return stdout;
  }

  async add(files: string[] | "all"): Promise<ToolResult> {
    // Use array args to prevent command injection
    const args = files === "all" ? ['add', '.'] : ['add', ...files];

    try {
      await this.execGit(args);
      return {
        success: true,
        output: `Staged: ${files === "all" ? "all changes" : files.join(", ")}`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  async commit(message: string): Promise<ToolResult> {
    // Check for user confirmation
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: "Git commit",
          filename: "repository",
          showVSCodeOpen: false,
          content: `Commit message: "${message}"`,
        },
        "bash"
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || "Commit cancelled by user",
        };
      }
    }

    try {
      // Use array args - message is safely passed as a single argument
      const { stdout } = await this.execGit(['commit', '-m', message]);
      return {
        success: true,
        output: stdout.trim(),
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  async push(setUpstream: boolean = false): Promise<ToolResult> {
    try {
      // Use array args to prevent command injection
      const args = setUpstream ? ['push', '-u', 'origin', 'HEAD'] : ['push'];
      const { stdout, stderr } = await this.execGit(args);
      return {
        success: true,
        output: stdout.trim() || stderr.trim() || "Push successful",
      };
    } catch (error: unknown) {
      // Check if we need to set upstream
      if (getErrorMessage(error).includes("no upstream branch")) {
        return this.push(true);
      }
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  async pull(): Promise<ToolResult> {
    try {
      const { stdout } = await this.execGit(['pull']);
      return {
        success: true,
        output: stdout.trim() || "Already up to date",
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  async autoCommit(options: CommitOptions = {}): Promise<ToolResult> {
    const { addAll = true, push = false } = options;

    // Check if in a git repo
    if (!(await this.isGitRepo())) {
      return {
        success: false,
        error: "Not a git repository",
      };
    }

    // Get status
    const status = await this.getStatus();
    const hasChanges =
      status.staged.length > 0 ||
      status.unstaged.length > 0 ||
      status.untracked.length > 0;

    if (!hasChanges) {
      return {
        success: false,
        error: "No changes to commit",
      };
    }

    // Add all changes if requested
    if (addAll) {
      const addResult = await this.add("all");
      if (!addResult.success) {
        return addResult;
      }
    }

    // Generate or use provided commit message
    let message = options.message;
    if (!message || options.autoGenerate) {
      message = await this.generateCommitMessage();
    }

    // Commit
    const commitResult = await this.commit(message);
    if (!commitResult.success) {
      return commitResult;
    }

    // Push if requested
    if (push) {
      const pushResult = await this.push();
      if (!pushResult.success) {
        return {
          success: false,
          error: `Commit successful but push failed: ${pushResult.error}`,
        };
      }
      return {
        success: true,
        output: `${commitResult.output}\n${pushResult.output}`,
      };
    }

    return commitResult;
  }

  private async generateCommitMessage(): Promise<string> {
    // Get status and diff in parallel
    const [status, diff] = await Promise.all([
      this.getStatus(),
      this.getDiff(true),
    ]);

    // Analyze changes to generate appropriate message
    const allFiles = [...status.staged, ...status.unstaged, ...status.untracked];

    // Determine commit type based on files changed
    let type = "chore";
    let scope = "";

    if (allFiles.some((f) => f.includes("test") || f.includes("spec"))) {
      type = "test";
    } else if (allFiles.some((f) => f.includes("README") || f.includes("doc"))) {
      type = "docs";
    } else if (allFiles.some((f) => f.includes("fix") || diff.includes("fix"))) {
      type = "fix";
    } else if (allFiles.some((f) => f.endsWith(".ts") || f.endsWith(".js"))) {
      type = "feat";
    }

    // Determine scope from directory
    const directories = allFiles
      .map((f) => path.dirname(f))
      .filter((d) => d !== ".");
    if (directories.length > 0) {
      const commonDir = directories[0].split("/")[0];
      if (commonDir && commonDir !== "src") {
        scope = commonDir;
      }
    }

    // Generate description
    const fileCount = allFiles.length;
    const fileTypes = [...new Set(allFiles.map((f) => path.extname(f)))];

    let description = "";
    if (fileCount === 1) {
      description = `update ${path.basename(allFiles[0])}`;
    } else if (fileTypes.length === 1) {
      description = `update ${fileCount} ${fileTypes[0]} files`;
    } else {
      description = `update ${fileCount} files`;
    }

    return scope
      ? `${type}(${scope}): ${description}`
      : `${type}: ${description}`;
  }

  async stash(message?: string): Promise<ToolResult> {
    try {
      // Use array args to prevent command injection
      const args = message ? ['stash', '-m', message] : ['stash'];
      const { stdout } = await this.execGit(args);
      return {
        success: true,
        output: stdout.trim() || "Stashed changes",
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  async stashPop(): Promise<ToolResult> {
    try {
      const { stdout } = await this.execGit(['stash', 'pop']);
      return {
        success: true,
        output: stdout.trim(),
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  async checkout(branchOrFile: string, create: boolean = false): Promise<ToolResult> {
    try {
      // Use array args to prevent command injection
      const args = create ? ['checkout', '-b', branchOrFile] : ['checkout', branchOrFile];
      const { stdout } = await this.execGit(args);
      return {
        success: true,
        output: stdout.trim() || `Switched to ${branchOrFile}`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  async branch(name?: string, delete_: boolean = false): Promise<ToolResult> {
    try {
      // Use array args to prevent command injection
      if (delete_ && name) {
        const { stdout } = await this.execGit(['branch', '-d', name]);
        return { success: true, output: stdout.trim() };
      } else if (name) {
        const { stdout } = await this.execGit(['branch', name]);
        return { success: true, output: stdout.trim() || `Created branch ${name}` };
      } else {
        const { stdout } = await this.execGit(['branch', '-a']);
        return { success: true, output: stdout.trim() };
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  formatStatus(status: GitStatus): string {
    let output = `Branch: ${status.branch}`;

    if (status.ahead > 0 || status.behind > 0) {
      output += ` (`;
      if (status.ahead > 0) output += `↑${status.ahead}`;
      if (status.behind > 0) output += `↓${status.behind}`;
      output += `)`;
    }
    output += "\n\n";

    if (status.staged.length > 0) {
      output += "Staged:\n";
      status.staged.forEach((f) => (output += `  ✓ ${f}\n`));
    }

    if (status.unstaged.length > 0) {
      output += "Modified:\n";
      status.unstaged.forEach((f) => (output += `  ● ${f}\n`));
    }

    if (status.untracked.length > 0) {
      output += "Untracked:\n";
      status.untracked.forEach((f) => (output += `  ? ${f}\n`));
    }

    if (
      status.staged.length === 0 &&
      status.unstaged.length === 0 &&
      status.untracked.length === 0
    ) {
      output += "Working tree clean\n";
    }

    return output;
  }
}

// Singleton instance
let gitToolInstance: GitTool | null = null;

export function getGitTool(cwd?: string): GitTool {
  if (!gitToolInstance || cwd) {
    gitToolInstance = new GitTool(cwd);
  }
  return gitToolInstance;
}
