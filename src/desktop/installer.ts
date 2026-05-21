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
import { existsSync, readFileSync } from 'fs';
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

  console.log('\n  Installing Code Buddy Desktop GUI...\n');

  // Step 1: Install Electron
  console.log('  [1/3] Installing Electron and Cowork dependencies...');
  try {
    execFileSync(npmCmd, [
      'install', 'electron', 'electron-store', 'electron-updater',
      '--save-optional',
    ], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    reinstallElectronBinaryIfMissing(projectRoot);
    if (existsSync(coworkPackageJson) && !existsSync(resolve(coworkDir, 'node_modules'))) {
      execFileSync(npmCmd, ['install'], {
        cwd: coworkDir,
        stdio: 'inherit',
      });
    }
    if (existsSync(coworkPackageJson)) {
      reinstallElectronBinaryIfMissing(coworkDir);
    }
  } catch (error) {
    console.error('  Failed to install Electron/Cowork dependencies:', (error as Error).message);
    process.exit(1);
  }

  // Step 2: Rebuild native modules for Electron
  console.log('\n  [2/3] Rebuilding native modules for Electron...');
  try {
    if (existsSync(coworkPackageJson)) {
      execFileSync(npmCmd, ['run', 'rebuild'], {
        cwd: coworkDir,
        stdio: 'inherit',
      });
    } else {
      const electronVersion = getElectronVersion(projectRoot);
      if (!electronVersion) {
        console.log('  Skipping electron-rebuild (version not detected)');
      } else {
        const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        execFileSync(npxCmd, [
          'electron-rebuild',
          '--version', electronVersion,
          '--module-dir', '.',
        ], {
          cwd: projectRoot,
          stdio: 'inherit',
        });
      }
    }
  } catch (error) {
    console.warn('  Warning: electron-rebuild failed:', (error as Error).message);
    console.warn('  Native modules may not work correctly in the GUI.');
  }

  // Step 3: Build Cowork if not already built
  console.log('\n  [3/3] Checking Cowork build...');
  const coworkDist = resolve(coworkDir, 'dist-electron');
  if (!existsSync(coworkDist)) {
    console.log('  Building Cowork desktop app...');
    try {
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      execFileSync(npmCmd, ['run', 'build:gui'], {
        cwd: projectRoot,
        stdio: 'inherit',
      });
    } catch {
      console.warn('  Warning: Cowork build skipped (run npm run build:gui manually)');
    }
  } else {
    console.log('  Cowork already built.');
  }

  console.log('\n  Desktop GUI installed successfully!');
  console.log('  Run: buddy gui\n');
}

/**
 * Get the installed Electron version.
 */
function getElectronVersion(projectRoot: string): string | null {
  try {
    const packageJsonPath = resolve(projectRoot, 'node_modules', 'electron', 'package.json');
    if (existsSync(packageJsonPath)) {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };
      return pkg.version;
    }
  } catch { /* ignore */ }
  return null;
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
    return [resolve(projectRoot, 'cowork'), projectRoot].some(hasElectronBinary);
  } catch {
    return false;
  }
}
