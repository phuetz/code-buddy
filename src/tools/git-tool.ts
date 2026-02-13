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

/**
 * Execute a git command that may exit non-zero without throwing.
 * Returns the exit code along with stdout/stderr.
 */
function execGitRaw(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
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

export interface BlameLine {
  lineNumber: number;
  commitHash: string;
  author: string;
  date: string;
  content: string;
}

export interface BlameOptions {
  startLine?: number;
  endLine?: number;
}

export interface CherryPickOptions {
  noCommit?: boolean;
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
    // Clamp count to safe range
    const safeCount = Math.max(1, Math.min(Math.floor(count) || 5, 1000));
    const { stdout } = await this.execGit(
      ['log', '--oneline', `-${safeCount}`, '--format=%h %s']
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
      // Auto-set upstream on first attempt only (prevent infinite recursion)
      if (!setUpstream && getErrorMessage(error).includes("no upstream branch")) {
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

  /**
   * Run git blame on a file and return structured output
   * @param filePath - Path to the file to blame
   * @param options - Optional line range filtering
   */
  async blame(filePath: string, options?: BlameOptions): Promise<ToolResult> {
    try {
      const args = ['blame', '--porcelain'];

      // Add line range if specified
      if (options?.startLine !== undefined && options?.endLine !== undefined) {
        args.push(`-L`, `${options.startLine},${options.endLine}`);
      } else if (options?.startLine !== undefined) {
        args.push(`-L`, `${options.startLine},`);
      }

      args.push('--', filePath);

      const { stdout } = await this.execGit(args);

      // Parse porcelain output into structured blame lines
      const blameLines = this.parseBlameOutput(stdout);

      if (blameLines.length === 0) {
        return {
          success: true,
          output: 'No blame information available (file may be empty or not committed)',
        };
      }

      // Format output for display
      const formatted = blameLines.map((bl) =>
        `${bl.lineNumber}\t${bl.commitHash.slice(0, 8)}\t${bl.author}\t${bl.date}\t${bl.content}`
      ).join('\n');

      const header = 'Line\tCommit\tAuthor\tDate\tContent';

      return {
        success: true,
        output: `${header}\n${formatted}`,
        data: blameLines,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  /**
   * Parse git blame --porcelain output into structured BlameLine objects
   */
  private parseBlameOutput(porcelainOutput: string): BlameLine[] {
    const lines = porcelainOutput.split('\n');
    const blameLines: BlameLine[] = [];
    let currentHash = '';
    let currentAuthor = '';
    let currentDate = '';
    let currentLineNumber = 0;

    for (const line of lines) {
      // Header line: <hash> <orig-line> <final-line> [<num-lines>]
      const headerMatch = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
      if (headerMatch) {
        currentHash = headerMatch[1];
        currentLineNumber = parseInt(headerMatch[2], 10);
        continue;
      }

      // Author line
      if (line.startsWith('author ')) {
        currentAuthor = line.slice(7);
        continue;
      }

      // Author time (unix timestamp) - convert to ISO date
      if (line.startsWith('author-time ')) {
        const timestamp = parseInt(line.slice(12), 10);
        currentDate = new Date(timestamp * 1000).toISOString().split('T')[0];
        continue;
      }

      // Content line (starts with tab)
      if (line.startsWith('\t')) {
        blameLines.push({
          lineNumber: currentLineNumber,
          commitHash: currentHash,
          author: currentAuthor,
          date: currentDate,
          content: line.slice(1),
        });
      }
    }

    return blameLines;
  }

  /**
   * Cherry-pick a commit into the current branch
   * @param commitHash - The commit hash to cherry-pick
   * @param options - Cherry-pick options
   */
  async cherryPick(commitHash: string, options?: CherryPickOptions): Promise<ToolResult> {
    try {
      const args = ['cherry-pick'];

      if (options?.noCommit) {
        args.push('--no-commit');
      }

      args.push(commitHash);

      // Use raw execution to handle conflict exit code (1) gracefully
      const result = await execGitRaw(args, this.cwd);

      if (result.exitCode === 0) {
        return {
          success: true,
          output: result.stdout.trim() || `Cherry-picked commit ${commitHash.slice(0, 8)} successfully`,
        };
      }

      // Check for conflicts
      const combinedOutput = `${result.stdout}\n${result.stderr}`;
      if (combinedOutput.includes('CONFLICT') || combinedOutput.includes('conflict')) {
        // Get the list of conflicted files
        let conflictFiles = '';
        try {
          const statusResult = await this.execGit(['diff', '--name-only', '--diff-filter=U']);
          conflictFiles = statusResult.stdout.trim();
        } catch {
          // Ignore -- we'll report the conflict without file details
        }

        return {
          success: false,
          error: `Cherry-pick of ${commitHash.slice(0, 8)} resulted in conflicts`,
          output: conflictFiles
            ? `Conflicted files:\n${conflictFiles}\n\nResolve conflicts and run 'git cherry-pick --continue' or 'git cherry-pick --abort'`
            : `Resolve conflicts and run 'git cherry-pick --continue' or 'git cherry-pick --abort'`,
        };
      }

      // Other failure
      return {
        success: false,
        error: result.stderr.trim() || `Cherry-pick failed with exit code ${result.exitCode}`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  /**
   * Start a git bisect session
   * @param badRef - The known bad commit (defaults to HEAD)
   * @param goodRef - The known good commit
   */
  async bisectStart(badRef?: string, goodRef?: string): Promise<ToolResult> {
    try {
      // Start bisect
      const startArgs = ['bisect', 'start'];
      if (badRef) {
        startArgs.push(badRef);
      }
      if (goodRef) {
        startArgs.push(goodRef);
      }

      const { stdout } = await this.execGit(startArgs);

      return {
        success: true,
        output: stdout.trim() || 'Bisect session started',
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  /**
   * Mark the current bisect commit as good, bad, or skip
   * @param result - The test result for the current commit
   */
  async bisectStep(result: 'good' | 'bad' | 'skip'): Promise<ToolResult> {
    try {
      const { stdout } = await this.execGit(['bisect', result]);
      const output = stdout.trim();

      // Check if bisect is done (found the first bad commit)
      const isDone = output.includes('is the first bad commit');

      return {
        success: true,
        output: output,
        data: { done: isDone },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  /**
   * Reset/end the bisect session
   */
  async bisectReset(): Promise<ToolResult> {
    try {
      const { stdout } = await this.execGit(['bisect', 'reset']);
      return {
        success: true,
        output: stdout.trim() || 'Bisect session reset',
      };
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
