import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

interface RipgrepModule {
  rgPath: string;
}

interface RipgrepResolutionOptions {
  loadBundledPath?: () => string;
  pathValue?: string;
  pathExtValue?: string;
  platform?: NodeJS.Platform;
  isExecutable?: (candidate: string) => boolean;
}

const requireModule = createRequire(import.meta.url);

function loadBundledRipgrepPath(): string {
  return (requireModule('@vscode/ripgrep') as RipgrepModule).rgPath;
}

function isExecutableFile(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function resolveRipgrepPath(options: RipgrepResolutionOptions = {}): string | null {
  const loadBundledPath = options.loadBundledPath ?? loadBundledRipgrepPath;
  try {
    const bundledPath = loadBundledPath();
    if (bundledPath) {
      return bundledPath;
    }
  } catch {
    // The wrapper remains installed under --omit=optional, while its
    // platform package does not. Fall through to a system ripgrep.
  }

  const platform = options.platform ?? process.platform;
  const pathValue = options.pathValue ?? process.env.PATH ?? '';
  const isExecutable = options.isExecutable ?? isExecutableFile;
  const extensions = platform === 'win32'
    ? (options.pathExtValue ?? process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
      .split(';')
      .filter(Boolean)
    : [''];

  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `rg${extension}`);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

let cachedRipgrepPath: string | null | undefined;

export function requireRipgrepPath(resolvedPath: string | null): string {
  if (resolvedPath === null) {
    throw new Error(
      'Search is unavailable because ripgrep is not installed. Reinstall Code Buddy without `--omit=optional` or install `rg` on PATH.',
    );
  }
  return resolvedPath;
}

export function getRipgrepPath(): string {
  if (cachedRipgrepPath === undefined) {
    cachedRipgrepPath = resolveRipgrepPath();
  }
  return requireRipgrepPath(cachedRipgrepPath);
}
