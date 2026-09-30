/**
 * Desktop Launcher
 *
 * Detects Electron availability and spawns the Cowork desktop app.
 * Used by the `buddy gui` / `buddy desktop` CLI commands.
 *
 * @module desktop/launcher
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { logger } from '../utils/logger.js';
import {
  getElectronBaseDirs,
  hasElectronBinary,
  resolveElectronBinaryPath,
} from './electron-paths.js';
import { electronLaunchArgs } from './electron-launch-args.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Get the project root directory.
 */
function getProjectRoot(): string {
  return resolve(__dirname, '..', '..');
}

/**
 * Check if Electron is available in node_modules.
 */
export function isElectronAvailable(): boolean {
  const projectRoot = getProjectRoot();
  return getElectronBaseDirs(projectRoot).some(hasElectronBinary);
}

/**
 * Get the path to the Electron binary.
 */
function getElectronBinaryPath(): string {
  return resolveElectronBinaryPath(getProjectRoot());
}

export interface LaunchOptions {
  /** Start with Vite dev server (hot reload) */
  dev?: boolean;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Detach the Electron process */
  detach?: boolean;
}

/**
 * Launch the Cowork Electron desktop app.
 *
 * @param options - Launch configuration
 * @returns The child process exit code (or 0 if detached)
 */
export async function launchDesktop(options: LaunchOptions = {}): Promise<number> {
  const projectRoot = getProjectRoot();
  const coworkDir = resolve(projectRoot, 'cowork');
  if (!existsSync(resolve(coworkDir, 'package.json'))) {
    process.stderr.write(
      '  Cowork is not included in the npm CLI package. Use a source checkout\n'
      + '  and follow cowork/DEV-LINUX.md on Linux or docs/cowork.md on Windows/macOS.\n',
    );
    return 1;
  }
  if (!isElectronAvailable()) {
    process.stderr.write('  Cowork Electron is not installed. From the source checkout, run buddy install-gui.\n');
    return 1;
  }

  // Determine entry point
  const entryPoint = options.dev
    ? resolve(coworkDir, 'src', 'main', 'index.ts')
    : resolve(coworkDir, 'dist-electron', 'main', 'index.js');

  if (!existsSync(entryPoint)) {
    process.stderr.write('  Cowork application is not built. Follow the source build guide before running buddy gui.\n');
    return 1;
  }

  const electronBin = getElectronBinaryPath();

  // Build environment
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    CODEBUDDY_EMBEDDED: '1',
    CODEBUDDY_ENGINE_PATH: resolve(projectRoot, 'dist'),
    ...options.env,
  };

  if (options.dev) {
    env.NODE_ENV = 'development';
  }

  logger.info('[Launcher] starting Electron', {
    electron: electronBin,
    entry: entryPoint,
    dev: !!options.dev,
  });

  return new Promise<number>((resolvePromise) => {
    const child = spawn(electronBin, electronLaunchArgs(entryPoint), {
      cwd: coworkDir,
      env,
      stdio: options.detach ? 'ignore' : 'inherit',
      detached: options.detach,
    });

    if (options.detach) {
      child.unref();
      console.log('  Code Buddy Desktop launched in background.');
      resolvePromise(0);
      return;
    }

    child.on('close', (code) => {
      resolvePromise(code ?? 0);
    });

    child.on('error', (err) => {
      console.error(`  Failed to launch desktop: ${err.message}`);
      resolvePromise(1);
    });
  });
}
