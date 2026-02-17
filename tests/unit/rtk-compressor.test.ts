/**
 * RTK Command Proxy Tests
 */

import { execSync } from 'child_process';
import {
  isRTKAvailable,
  resetRTKCache,
  wrapWithRTK,
  isRTKCompatible,
  getCompressionStats,
} from '../../src/utils/rtk-compressor.js';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;

beforeEach(() => {
  resetRTKCache();
  jest.clearAllMocks();
});

describe('isRTKAvailable', () => {
  it('should return true when rtk binary is found', () => {
    mockedExecSync.mockReturnValue(Buffer.from('/usr/bin/rtk'));

    expect(isRTKAvailable()).toBe(true);
    expect(mockedExecSync).toHaveBeenCalledWith('which rtk', { stdio: 'ignore' });
  });

  it('should return false when rtk binary is not found', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    expect(isRTKAvailable()).toBe(false);
  });

  it('should cache the result', () => {
    mockedExecSync.mockReturnValue(Buffer.from('/usr/bin/rtk'));

    isRTKAvailable();
    isRTKAvailable();
    isRTKAvailable();

    expect(mockedExecSync).toHaveBeenCalledTimes(1);
  });

  it('should reset cache with resetRTKCache', () => {
    mockedExecSync.mockReturnValue(Buffer.from('/usr/bin/rtk'));

    isRTKAvailable();
    expect(mockedExecSync).toHaveBeenCalledTimes(1);

    resetRTKCache();
    isRTKAvailable();
    expect(mockedExecSync).toHaveBeenCalledTimes(2);
  });
});

describe('wrapWithRTK', () => {
  beforeEach(() => {
    // Make RTK available for wrapping tests
    mockedExecSync.mockReturnValue(Buffer.from('/usr/bin/rtk'));
    isRTKAvailable(); // warm cache
  });

  it('should wrap supported commands with rtk prefix', () => {
    expect(wrapWithRTK('git status')).toBe('rtk git status');
    expect(wrapWithRTK('ls -la src/')).toBe('rtk ls -la src/');
    expect(wrapWithRTK('grep -r "pattern" .')).toBe('rtk grep -r "pattern" .');
    expect(wrapWithRTK('find . -name "*.ts"')).toBe('rtk find . -name "*.ts"');
    expect(wrapWithRTK('cargo test')).toBe('rtk cargo test');
    expect(wrapWithRTK('docker ps')).toBe('rtk docker ps');
    expect(wrapWithRTK('npx tsc --noEmit')).toBe('rtk npx tsc --noEmit');
  });

  it('should not wrap unsupported commands', () => {
    expect(wrapWithRTK('echo hello')).toBe('echo hello');
    expect(wrapWithRTK('cat file.txt')).toBe('cat file.txt');
    expect(wrapWithRTK('node script.js')).toBe('node script.js');
    expect(wrapWithRTK('python app.py')).toBe('python app.py');
  });

  it('should wrap npm run but not npm list/install', () => {
    expect(wrapWithRTK('npm run build')).toBe('rtk npm run build');
    expect(wrapWithRTK('npm run test')).toBe('rtk npm run test');
    expect(wrapWithRTK('npm list')).toBe('npm list');
    expect(wrapWithRTK('npm install express')).toBe('npm install express');
    expect(wrapWithRTK('npm outdated')).toBe('npm outdated');
  });

  it('should not wrap interactive/editor commands', () => {
    expect(wrapWithRTK('vim file.txt')).toBe('vim file.txt');
    expect(wrapWithRTK('nano file.txt')).toBe('nano file.txt');
    expect(wrapWithRTK('ssh user@host')).toBe('ssh user@host');
    expect(wrapWithRTK('sudo rm -rf /tmp/test')).toBe('sudo rm -rf /tmp/test');
  });

  it('should not double-wrap rtk commands', () => {
    expect(wrapWithRTK('rtk git status')).toBe('rtk git status');
  });

  it('should not wrap commands piped to head/tail/wc', () => {
    expect(wrapWithRTK('git log | head -5')).toBe('git log | head -5');
    expect(wrapWithRTK('npm list | tail -10')).toBe('npm list | tail -10');
    expect(wrapWithRTK('ls -la | wc -l')).toBe('ls -la | wc -l');
  });

  it('should return original when RTK is not available', () => {
    resetRTKCache();
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    expect(wrapWithRTK('git status')).toBe('git status');
  });
});

describe('isRTKCompatible', () => {
  it('should return true for supported commands', () => {
    expect(isRTKCompatible('git status')).toBe(true);
    expect(isRTKCompatible('ls -la')).toBe(true);
    expect(isRTKCompatible('docker compose up')).toBe(true);
    expect(isRTKCompatible('cargo build')).toBe(true);
  });

  it('should return false for unsupported commands', () => {
    expect(isRTKCompatible('echo hello')).toBe(false);
    expect(isRTKCompatible('cat file.txt')).toBe(false);
  });

  it('should handle conditional npm support', () => {
    expect(isRTKCompatible('npm run build')).toBe(true);
    expect(isRTKCompatible('npm list')).toBe(false);
    expect(isRTKCompatible('npm install')).toBe(false);
  });

  it('should return false for skip patterns', () => {
    expect(isRTKCompatible('vim file.txt')).toBe(false);
    expect(isRTKCompatible('rtk git status')).toBe(false);
    expect(isRTKCompatible('git log | head -5')).toBe(false);
  });
});

describe('getCompressionStats', () => {
  it('should calculate compression ratio', () => {
    const original = 'a'.repeat(1000);
    const compressed = 'a'.repeat(400);

    const stats = getCompressionStats(original, compressed);

    expect(stats.originalTokens).toBe(250); // 1000 / 4
    expect(stats.compressedTokens).toBe(100); // 400 / 4
    expect(stats.ratio).toBeCloseTo(0.6, 2); // 60% reduction
  });

  it('should handle empty original', () => {
    const stats = getCompressionStats('', 'something');

    expect(stats.originalTokens).toBe(0);
    expect(stats.ratio).toBe(0);
  });

  it('should handle identical strings', () => {
    const text = 'hello world';
    const stats = getCompressionStats(text, text);

    expect(stats.ratio).toBe(0);
    expect(stats.originalTokens).toBe(stats.compressedTokens);
  });
});
