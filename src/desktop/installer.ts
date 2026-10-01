/** Installs the desktop bundle from a source checkout, without packaging it. */
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { hasElectronBinary } from './electron-paths.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function hasDesktopBundle(coworkDir: string): boolean {
  return ['dist-electron/main/index.js', 'dist-electron/preload/index.js', 'dist/index.html']
    .every((entry) => existsSync(resolve(coworkDir, entry)));
}

/** Fail visibly unless Electron, its native modules and the bundle are ready. */
export async function installGUI(): Promise<void> {
  const projectRoot = resolve(__dirname, '..', '..');
  const coworkDir = resolve(projectRoot, 'cowork');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  if (!existsSync(resolve(coworkDir, 'package.json'))) {
    throw new Error(
      'Cowork requires a Code Buddy source checkout; the npm CLI package does not include the desktop sources. '
      + 'Clone https://github.com/phuetz/code-buddy.git, run npm install && npm run build there, '
      + 'then node dist/index.js install-gui. See docs/cowork.md.',
    );
  }

  logger.info('Installing Code Buddy Desktop GUI...');
  // Cowork owns its Electron version and ABI. Never add/rebuild GUI dependencies
  // in the CLI package, where rebuilding SQLite would break the Node CLI.
  if (!existsSync(resolve(coworkDir, 'node_modules')) || !hasElectronBinary(coworkDir)) {
    execFileSync(npmCmd, ['install'], { cwd: coworkDir, stdio: 'inherit' });
  }
  const installScript = resolve(coworkDir, 'node_modules', 'electron', 'install.js');
  if (!hasElectronBinary(coworkDir) && existsSync(installScript)) {
    execFileSync(process.execPath, [installScript], { cwd: coworkDir, stdio: 'inherit' });
  }
  if (!hasElectronBinary(coworkDir)) {
    throw new Error('Cowork Electron binary is missing after installation. Retry npm install in cowork.');
  }

  execFileSync(npmCmd, ['run', 'rebuild'], { cwd: coworkDir, stdio: 'inherit' });
  if (!hasDesktopBundle(coworkDir)) {
    // Vite builds all three contexts. Shipping installers and downloading all
    // cross-platform runtimes belong to the release pipeline, not first launch.
    execFileSync(npmCmd, ['run', 'build:e2e'], { cwd: coworkDir, stdio: 'inherit' });
  }
  if (!hasDesktopBundle(coworkDir)) {
    throw new Error('Cowork build did not produce the complete desktop bundle. Run npm run build:e2e in cowork.');
  }
  logger.info('Desktop GUI installed successfully! Run: buddy gui');
}

/** The Electron binary alone cannot launch Cowork without its bundle. */
export function isGUIInstalled(): boolean {
  const coworkDir = resolve(__dirname, '..', '..', 'cowork');
  return hasElectronBinary(coworkDir) && hasDesktopBundle(coworkDir);
