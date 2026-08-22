/**
 * Shell-free launch plans for npm and project-local CLIs (eslint, prettier).
 *
 * On POSIX the binaries/shims are executable files, so they spawn directly.
 * On Windows `npm` and the `node_modules/.bin/*` entries are `.cmd` batch
 * files: Node refuses to spawn them without a shell, and `shell: true` is
 * deprecated for that use (DEP0190) and only kills cmd.exe on timeout. So on
 * win32 we run the CLI's JavaScript entry through `process.execPath` and only
 * fall back to an explicit cmd.exe invocation (verbatim argv) when that entry
 * cannot be found.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface LaunchPlan {
  file: string;
  args: string[];
  /** Only set for the cmd.exe fallback (the argv is passed verbatim). */
  windowsVerbatimArguments?: boolean;
}

const isWindows = process.platform === 'win32';

function existingFile(candidate: string | undefined): string | null {
  if (!candidate) return null;
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function cmdExeLaunch(commandLine: string): LaunchPlan {
  return {
    file: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

/** `npm <args>` — on win32 through `npm-cli.js` (npm_execpath, else the Node install's own npm). */
export function resolveNpmLaunch(args: string[]): LaunchPlan {
  if (!isWindows) return { file: 'npm', args };
  const fromEnv = process.env.npm_execpath;
  const candidates = [
    fromEnv && /\.[cm]?js$/i.test(fromEnv) ? fromEnv : undefined,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    const cli = existingFile(candidate);
    if (cli) return { file: process.execPath, args: [cli, ...args] };
  }
  return cmdExeLaunch(`npm ${args.join(' ')}`);
}

/**
 * A project-local CLI: `shimPath` is the `node_modules/.bin` entry (already
 * checked to exist by the caller); `jsEntries` are the package's JS entry
 * points relative to `root`, tried in order on win32.
 */
export function resolveLocalBinaryLaunch(root: string, shimPath: string, jsEntries: string[], args: string[]): LaunchPlan {
  if (!isWindows) return { file: shimPath, args };
  for (const entry of jsEntries) {
    const js = existingFile(path.join(root, entry));
    if (js) return { file: process.execPath, args: [js, ...args] };
  }
  return cmdExeLaunch(`"${shimPath}" ${args.join(' ')}`);
}
