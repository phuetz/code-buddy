import { existsSync } from 'fs';
import { resolve } from 'path';

export function getElectronBaseDirs(projectRoot: string): string[] {
  return [
    resolve(projectRoot, 'cowork'),
    projectRoot,
  ];
}

export function getElectronBinaryCandidates(baseDir: string): string[] {
  const binName = process.platform === 'win32' ? 'electron.cmd' : 'electron';
  const electronPkgPath = resolve(baseDir, 'node_modules', 'electron', 'dist', 'electron');
  const electronExe = process.platform === 'win32' ? electronPkgPath + '.exe' : electronPkgPath;
  return [
    resolve(baseDir, 'node_modules', '.bin', binName),
    electronExe,
  ];
}

export function hasElectronBinary(baseDir: string): boolean {
  return getElectronBinaryCandidates(baseDir).some((candidate) => existsSync(candidate));
}

export function resolveElectronBinaryPath(projectRoot: string): string {
  for (const baseDir of getElectronBaseDirs(projectRoot)) {
    const candidate = getElectronBinaryCandidates(baseDir).find((pathValue) => existsSync(pathValue));
    if (candidate) {
      return candidate;
    }
  }

  throw new Error('Electron binary not found. Run: buddy install-gui');
}
