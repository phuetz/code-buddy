/**
 * GUI Installer
 *
 * Installs Electron and rebuilds native modules for the desktop GUI.
 * Used by the `buddy install-gui` CLI command.
 *
 * @module desktop/installer
 */

import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { hasElectronBinary } from './electron-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Install Electron and related dependencies for the desktop GUI.
 */
export async function installGUI(): Promise<void> {
  const projectRoot = resolve(__dirname, '..', '..');
  const coworkDir = resolve(projectRoot, 'cowork');
  const coworkPackageJson = resolve(coworkDir, 'package.json');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  process.stdout.write('\n  Installing Code Buddy Desktop GUI...\n');

  // The npm CLI tarball does not contain Cowork. Fail before changing its
  // dependencies or rebuilding the CLI's native modules against Electron.
  if (!existsSync(coworkPackageJson)) {
    process.stderr.write(
      '  Cowork sources are not included in the npm CLI package. Nothing was installed.\n'
      + '  Use a Code Buddy source checkout and follow cowork/DEV-LINUX.md on Linux\n'
      + '  (or docs/cowork.md on Windows/macOS). Run the checkout CLI, not the global buddy.\n',
    );
    process.exitCode = 1;
    return;
  }

  try {
    process.stdout.write('  [1/3] Installing Cowork dependencies...\n');
    execFileSync(npmCmd, ['install'], { cwd: coworkDir, stdio: 'inherit' });
    reinstallElectronBinaryIfMissing(coworkDir);
    if (!hasElectronBinary(coworkDir)) {
      throw new Error('Cowork Electron binary is missing after dependency installation');
    }

    process.stdout.write('\n  [2/3] Rebuilding Cowork native modules for Electron...\n');
    execFileSync(npmCmd, ['run', 'rebuild'], { cwd: coworkDir, stdio: 'inherit' });

    process.stdout.write('\n  [3/3] Checking Cowork build...\n');
    const entryPoint = resolve(coworkDir, 'dist-electron', 'main', 'index.js');
    if (!existsSync(entryPoint)) {
      // Build the application, without downloading standalone runtimes or
      // invoking the platform installer packager.
      execFileSync(npmCmd, ['exec', '--', 'vite', 'build'], { cwd: coworkDir, stdio: 'inherit' });
    }
    if (!existsSync(entryPoint)) {
      throw new Error('Cowork build did not produce dist-electron/main/index.js');
    }
  } catch (error) {
    process.stderr.write(`  Desktop GUI installation failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('\n  Desktop GUI installed successfully!\n  Run: buddy gui\n');
}

function reinstallElectronBinaryIfMissing(baseDir: string): void {
  if (hasElectronBinary(baseDir)) {
    return;
  }

  const installScript = resolve(baseDir, 'node_modules', 'electron', 'install.js');
  if (!existsSync(installScript)) {
    return;
  }

  execFileSync(process.execPath, [installScript], {
    cwd: baseDir,
    stdio: 'inherit',
  });
}

/**
 * Check if the GUI is installed and ready to use.
 */
export function isGUIInstalled(): boolean {
  try {
    const projectRoot = resolve(__dirname, '..', '..');
    const coworkDir = resolve(projectRoot, 'cowork');
    return existsSync(resolve(coworkDir, 'dist-electron', 'main', 'index.js'))
      && [coworkDir, projectRoot].some(hasElectronBinary);
  } catch {
    return false;
  }
}
