/**
 * RTK Output Compressor Tests
 */

import { execSync, spawnSync, type SpawnSyncReturns } from 'child_process';
import {
  isRTKAvailable,
  resetRTKCache,
  compressWithRTK,
  getCompressionStats,
} from '../../src/utils/rtk-compressor.js';

jest.mock('child_process', () => ({
  execSync: jest.fn(),
  spawnSync: jest.fn(),
}));

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

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

describe('compressWithRTK', () => {
  it('should return original output when RTK is not available', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not found');
    });

    const output = 'some long output '.repeat(100);
    expect(compressWithRTK(output)).toBe(output);
  });

  it('should compress output via rtk stdin pipe', () => {
    mockedExecSync.mockReturnValue(Buffer.from('/usr/bin/rtk'));
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'compressed output',
      stderr: '',
      pid: 1234,
      output: ['', 'compressed output', ''],
      signal: null,
    } as SpawnSyncReturns<string>);

    const result = compressWithRTK('original long output');

    expect(result).toBe('compressed output');
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'rtk',
      ['compress', '--stdin'],
      expect.objectContaining({
        input: 'original long output',
        encoding: 'utf-8',
      })
    );
  });

  it('should pass format option to rtk', () => {
    mockedExecSync.mockReturnValue(Buffer.from('/usr/bin/rtk'));
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'compressed',
      stderr: '',
      pid: 1234,
      output: ['', 'compressed', ''],
      signal: null,
    } as SpawnSyncReturns<string>);

    compressWithRTK('some json output', { format: 'json' });

    expect(mockedSpawnSync).toHaveBeenCalledWith(
      'rtk',
      ['compress', '--stdin', '--format', 'json'],
      expect.any(Object)
    );
  });

  it('should return original on non-zero exit code', () => {
    mockedExecSync.mockReturnValue(Buffer.from('/usr/bin/rtk'));
    mockedSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'rtk error',
      pid: 1234,
      output: ['', '', 'rtk error'],
      signal: null,
    } as SpawnSyncReturns<string>);

    const original = 'original output';
    expect(compressWithRTK(original)).toBe(original);
  });

  it('should return original on spawn exception', () => {
    mockedExecSync.mockReturnValue(Buffer.from('/usr/bin/rtk'));
    mockedSpawnSync.mockImplementation(() => {
      throw new Error('spawn failed');
    });

    const original = 'original output';
    expect(compressWithRTK(original)).toBe(original);
  });

  it('should return original when stdout is empty', () => {
    mockedExecSync.mockReturnValue(Buffer.from('/usr/bin/rtk'));
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: '',
      stderr: '',
      pid: 1234,
      output: ['', '', ''],
      signal: null,
    } as SpawnSyncReturns<string>);

    const original = 'original output';
    expect(compressWithRTK(original)).toBe(original);
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
