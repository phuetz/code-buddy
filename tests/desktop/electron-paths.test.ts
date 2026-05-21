import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  getElectronBaseDirs,
  getElectronBinaryCandidates,
  hasElectronBinary,
  resolveElectronBinaryPath,
} from '../../src/desktop/electron-paths.js';

function writeElectronBin(baseDir: string): string {
  const binDir = join(baseDir, 'node_modules', '.bin');
  mkdirSync(binDir, { recursive: true });
  const binPath = join(binDir, process.platform === 'win32' ? 'electron.cmd' : 'electron');
  writeFileSync(binPath, '');
  return binPath;
}

describe('desktop electron path resolution', () => {
  it('prefers Cowork Electron before the root fallback', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'codebuddy-electron-paths-'));
    try {
      const rootElectron = writeElectronBin(projectRoot);
      const coworkElectron = writeElectronBin(join(projectRoot, 'cowork'));

      expect(getElectronBaseDirs(projectRoot)).toEqual([
        resolve(projectRoot, 'cowork'),
        projectRoot,
      ]);
      expect(rootElectron).not.toBe(coworkElectron);
      expect(resolveElectronBinaryPath(projectRoot)).toBe(coworkElectron);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('falls back to root Electron when Cowork has no binary', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'codebuddy-electron-paths-'));
    try {
      const rootElectron = writeElectronBin(projectRoot);

      expect(resolveElectronBinaryPath(projectRoot)).toBe(rootElectron);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('requires an actual Electron binary, not only an installed package folder', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'codebuddy-electron-paths-'));
    try {
      const packageDir = join(projectRoot, 'cowork', 'node_modules', 'electron');
      mkdirSync(packageDir, { recursive: true });

      expect(existsSync(packageDir)).toBe(true);
      expect(hasElectronBinary(join(projectRoot, 'cowork'))).toBe(false);
      expect(() => resolveElectronBinaryPath(projectRoot)).toThrow('Electron binary not found');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('includes the package dist executable fallback candidate', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'codebuddy-electron-paths-'));
    try {
      const baseDir = join(projectRoot, 'cowork');
      const candidates = getElectronBinaryCandidates(baseDir);
      const distCandidate = candidates[1];
      mkdirSync(resolve(distCandidate, '..'), { recursive: true });
      writeFileSync(distCandidate, '');

      expect(hasElectronBinary(baseDir)).toBe(true);
      expect(resolveElectronBinaryPath(projectRoot)).toBe(distCandidate);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
