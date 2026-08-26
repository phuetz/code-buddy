import { EventEmitter } from "events";
import { exec } from "child_process";
import { existsSync } from "fs";
import { basename, delimiter, isAbsolute, join } from "path";
import { ToolResult, getErrorMessage } from "../types/index.js";
import { getFilteredEnv } from "./bash/command-validator.js";
import { SAFE_ENV_VARS } from "./bash/security-patterns.js";
import { getShellEnvPolicy } from "../security/shell-env-policy.js";

// Note: node-pty is an optional dependency for PTY support
// If not available, falls back to regular child_process

interface PTYShell {
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (event: { exitCode: number }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

interface PTYModule {
  spawn: (shell: string, args: string[], options: {
    name: string;
    cols: number;
    rows: number;
    cwd: string;
    env: Record<string, string | undefined>;
  }) => PTYShell;
}

let pty: PTYModule | null = null;
try {
  // Dynamic import to avoid crash if node-pty isn't installed
  pty = require("node-pty") as PTYModule;
} catch {
  // node-pty not available
}

// Dangerous command patterns that should be blocked
const BLOCKED_PATTERNS = [
  /rm\s+(-rf?|--recursive)\s+[/~]/i,  // rm -rf on root or home
  /mkfs\./i,                            // Format filesystem
  /dd\s+.*of=\/dev\//i,                 // dd to device
  />\s*\/dev\/sd[a-z]/i,                // Redirect to disk
  /chmod\s+-R\s+777\s+\//i,             // chmod 777 on root
  /chown\s+-R\s+.*\s+\//i,              // chown on root
  /:(){ :|:& };:/,                       // Fork bomb
  /\|\s*sh\s*$/i,                        // Piping to shell
  /curl.*\|\s*(ba)?sh/i,                 // curl | bash
  /wget.*\|\s*(ba)?sh/i,                 // wget | bash
];

/**
 * Validate command for dangerous patterns
 * @returns null if safe, error message if dangerous
 */
function validateCommand(command: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return `Blocked potentially dangerous command pattern: ${pattern.source}`;
    }
  }
  return null;
}

function getProcessEnvValue(name: string): string | undefined {
  const key = Object.keys(process.env).find(
    (candidate) => candidate.toUpperCase() === name.toUpperCase()
  );
  return key ? process.env[key] : undefined;
}

/**
 * Resolve Bash to an absolute path before passing it to node-pty.
 *
 * node-pty 1.1 uses posix_spawn (not posix_spawnp) on macOS, so a bare
 * executable name is not searched in PATH there. Its Windows backend also
 * reports "File not found" when Bash is not directly resolvable from the
 * parent Path. Git for Windows ships Bash in the standard locations below.
 */
function resolveBashExecutable(): string {
  const candidates: string[] = [];

  if (process.platform === "win32") {
    for (const envName of ["PROGRAMFILES", "PROGRAMW6432", "PROGRAMFILES(X86)"]) {
      const root = getProcessEnvValue(envName);
      if (!root) continue;
      candidates.push(join(root, "Git", "bin", "bash.exe"));
      candidates.push(join(root, "Git", "usr", "bin", "bash.exe"));
    }

    const localAppData = getProcessEnvValue("LOCALAPPDATA");
    if (localAppData) {
      candidates.push(join(localAppData, "Programs", "Git", "bin", "bash.exe"));
      candidates.push(join(localAppData, "Programs", "Git", "usr", "bin", "bash.exe"));
    }
  } else {
    const configuredShell = getProcessEnvValue("SHELL");
    if (
      configuredShell &&
      isAbsolute(configuredShell) &&
      basename(configuredShell) === "bash"
    ) {
      candidates.push(configuredShell);
    }
    candidates.push("/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash");
  }

  const pathValue = getProcessEnvValue("PATH");
  if (pathValue) {
    const executableName = process.platform === "win32" ? "bash.exe" : "bash";
    for (const pathEntry of pathValue.split(delimiter)) {
      const directory = pathEntry.trim().replace(/^["']|["']$/g, "");
      if (directory) candidates.push(join(directory, executableName));
    }
  }

  const shell = candidates.find((candidate) => existsSync(candidate));
  if (!shell) {
    throw new Error(
      "Bash executable not found. Install Bash or add it to PATH (Git for Windows includes bash.exe)."
    );
  }
  return shell;
}

/**
 * Build the environment for both interactive execution paths.
 *
 * A PTY needs the same terminal variables as a normal shell (PATH, HOME,
 * SHELL, locale, etc.), but inheriting all of process.env would also carry
 * interpreter injection variables such as NODE_OPTIONS, NODE_PATH, or
 * PYTHONPATH. Explicit overrides use the same allowlist so they cannot reopen
 * that gap after the inherited environment has been filtered.
 */
function buildInteractiveEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const safeOverrides: Record<string, string> = {};

  for (const [key, value] of Object.entries(overrides)) {
    if (!SAFE_ENV_VARS.has(key)) continue;
    // eslint-disable-next-line no-control-regex
    safeOverrides[key] = value.replace(/[\x00-\x1f\x7f]/g, '');
  }

  const env = getShellEnvPolicy().buildEnv({
    ...getFilteredEnv(),
    ...safeOverrides,
  });

  // node-pty needs a terminal type even when the parent process has none.
  env.TERM = 'xterm-256color';
  return env;
}

export interface InteractiveSession {
  id: string;
  command: string;
  startTime: Date;
  isRunning: boolean;
}

export interface PTYOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

/** Entry stored in sessions Map */
interface SessionEntry {
  shell: PTYShell;
  session: InteractiveSession;
}

export class InteractiveBashTool extends EventEmitter {
  private sessions: Map<string, SessionEntry> = new Map();
  private sessionCounter: number = 0;
  private isPTYAvailable: boolean;

  constructor() {
    super();
    this.isPTYAvailable = pty !== null;
  }

  isPTYSupported(): boolean {
    return this.isPTYAvailable;
  }

  async executeInteractive(
    command: string,
    options: PTYOptions = {}
  ): Promise<{ sessionId: string; output: string }> {
    // Validate command for dangerous patterns before execution
    const validationError = validateCommand(command);
    if (validationError) {
      return { sessionId: '', output: `Error: ${validationError}` };
    }

    const shellExecutable = resolveBashExecutable();

    if (!this.isPTYAvailable) {
      return this.fallbackExecute(command, shellExecutable);
    }

    const sessionId = `pty-${++this.sessionCounter}`;
    const cols = options.cols || 120;
    const rows = options.rows || 30;

    return new Promise((resolve, reject) => {
      try {
        if (!pty) {
          reject(new Error("PTY module not available"));
          return;
        }

        const shell = pty.spawn(shellExecutable, ["-c", command], {
          name: "xterm-256color",
          cols,
          rows,
          cwd: options.cwd || process.cwd(),
          env: buildInteractiveEnv(options.env),
        });

        let output = "";
        let resolved = false;

        const session: InteractiveSession = {
          id: sessionId,
          command,
          startTime: new Date(),
          isRunning: true,
        };

        this.sessions.set(sessionId, { shell, session });

        shell.onData((data: string) => {
          output += data;
          this.emit("pty:data", { sessionId, data });
        });

        shell.onExit(({ exitCode }: { exitCode: number }) => {
          session.isRunning = false;
          this.emit("pty:exit", { sessionId, exitCode });

          if (!resolved) {
            resolved = true;
            resolve({ sessionId, output });
          }
        });

        // Timeout for non-interactive commands
        setTimeout(() => {
          if (!resolved && !this.isInteractiveCommand(command)) {
            resolved = true;
            shell.kill();
            resolve({ sessionId, output });
          }
        }, 30000);
      } catch (error) {
        reject(new Error(`PTY execution failed: ${getErrorMessage(error)}`));
      }
    });
  }

  private isInteractiveCommand(command: string): boolean {
    const interactiveCommands = [
      "vim",
      "vi",
      "nano",
      "emacs",
      "htop",
      "top",
      "less",
      "more",
      "man",
      "git rebase -i",
      "git add -i",
      "git add -p",
      "ssh",
      "python",
      "node",
      "irb",
      "rails console",
      "mysql",
      "psql",
      "mongo",
    ];

    return interactiveCommands.some((cmd) =>
      command.toLowerCase().includes(cmd)
    );
  }

  private async fallbackExecute(
    command: string,
    shellExecutable: string
  ): Promise<{ sessionId: string; output: string }> {
    const sessionId = `exec-${++this.sessionCounter}`;

    return new Promise((resolve) => {
      // Use exec for simpler command execution with maxBuffer support
      exec(command, {
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
        cwd: process.cwd(),
        shell: shellExecutable,
        env: {
          ...buildInteractiveEnv(),
          // Disable shell history for security
          HISTFILE: "/dev/null",
          HISTSIZE: "0",
        },
      }, (error, stdout, stderr) => {
        if (error) {
          resolve({
            sessionId,
            output: `Error: ${getErrorMessage(error)}\n${stderr || ''}`,
          });
        } else {
          resolve({
            sessionId,
            output: stdout + (stderr ? `\nStderr:\n${stderr}` : ""),
          });
        }
      });
    });
  }

  sendInput(sessionId: string, input: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry || !entry.session.isRunning) {
      return false;
    }

    try {
      entry.shell.write(input);
      return true;
    } catch {
      return false;
    }
  }

  sendKey(sessionId: string, key: string): boolean {
    const keyMap: Record<string, string> = {
      enter: "\r",
      tab: "\t",
      escape: "\x1b",
      up: "\x1b[A",
      down: "\x1b[B",
      left: "\x1b[D",
      right: "\x1b[C",
      "ctrl-c": "\x03",
      "ctrl-d": "\x04",
      "ctrl-z": "\x1a",
      "ctrl-l": "\x0c",
    };

    const keyCode = keyMap[key.toLowerCase()] || key;
    return this.sendInput(sessionId, keyCode);
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry || !this.isPTYAvailable) {
      return false;
    }

    try {
      entry.shell.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  kill(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return false;
    }

    try {
      entry.shell.kill();
      entry.session.isRunning = false;
      return true;
    } catch {
      return false;
    }
  }

  getSession(sessionId: string): InteractiveSession | null {
    const entry = this.sessions.get(sessionId);
    return entry?.session || null;
  }

  getActiveSessions(): InteractiveSession[] {
    return Array.from(this.sessions.values())
      .map((entry) => entry.session)
      .filter((session) => session.isRunning);
  }

  async executeWithToolResult(
    command: string,
    options?: PTYOptions
  ): Promise<ToolResult> {
    try {
      const { output } = await this.executeInteractive(command, options);

      // Strip ANSI codes for cleaner output
      const cleanOutput = this.stripAnsi(output);

      return {
        success: true,
        output: cleanOutput,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  private stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  }

  formatHelp(): string {
    const ptyStatus = this.isPTYAvailable
      ? "✓ Available"
      : "✗ Not installed (install node-pty for full support)";

    return `
Interactive Terminal (PTY) Support

Status: ${ptyStatus}

Capabilities:
  - Run interactive commands (vim, htop, git rebase -i)
  - Full terminal emulation with color support
  - Send keystrokes and control sequences
  - Resize terminal dimensions

Usage:
  /interactive <command>   Run command in PTY
  /pty send <input>        Send input to active session
  /pty key <keyname>       Send special key (enter, ctrl-c, etc.)
  /pty resize <cols> <rows> Resize terminal
  /pty kill <sessionId>    Kill session

Special Keys:
  enter, tab, escape, up, down, left, right
  ctrl-c, ctrl-d, ctrl-z, ctrl-l

Examples:
  /interactive vim file.txt
  /interactive htop
  /interactive git rebase -i HEAD~5

Note: PTY support requires the 'node-pty' package:
  npm install node-pty
  # or
  bun add node-pty
`;
  }

  cleanup(): void {
    for (const [sessionId] of this.sessions) {
      this.kill(sessionId);
    }
    this.sessions.clear();
  }

  /**
   * Dispose the tool and clean up all resources
   */
  dispose(): void {
    this.cleanup();
    this.removeAllListeners();
  }
}

// Singleton instance
let interactiveBashInstance: InteractiveBashTool | null = null;

export function getInteractiveBash(): InteractiveBashTool {
  if (!interactiveBashInstance) {
    interactiveBashInstance = new InteractiveBashTool();
  }
  return interactiveBashInstance;
}
