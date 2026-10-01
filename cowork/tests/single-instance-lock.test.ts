import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestSingleInstanceLock } from '../src/main/utils/single-instance-lock.js';

vi.mock('../src/main/utils/logger.js', () => ({ logWarn: vi.fn() }));

afterEach(() => vi.unstubAllEnvs());

describe('Linux single-instance socket path', () => {
  it('preserves the native lock result for a fitting TMPDIR', () => {
    vi.stubEnv('TMPDIR', '/' + 'a'.repeat(73)); // 74 + 33 = 107 bytes, fits.
    const nativeLock = vi.fn(() => {
      expect(process.env.TMPDIR).toHaveLength(74);
      return false;
    });
    expect(requestSingleInstanceLock({ requestSingleInstanceLock: nativeLock }, 'linux')).toBe(false);
    expect(nativeLock).toHaveBeenCalledOnce();
  });

  it.each([true, false])('keeps the native result %s and restores an oversized TMPDIR', (result) => {
    const original = '/' + 'a'.repeat(74); // Socket would occupy 108 bytes.
    vi.stubEnv('TMPDIR', original);
    const nativeLock = vi.fn(() => {
      expect(process.env.TMPDIR).toBe('/tmp');
      return result;
    });
    expect(requestSingleInstanceLock({ requestSingleInstanceLock: nativeLock }, 'linux')).toBe(result);
    expect(nativeLock).toHaveBeenCalledOnce();
    expect(process.env.TMPDIR).toBe(original);
  });

  it('counts UTF-8 bytes rather than characters', () => {
    const original = '/' + 'é'.repeat(37);
    vi.stubEnv('TMPDIR', original);
    const nativeLock = vi.fn(() => {
      expect(process.env.TMPDIR).toBe('/tmp');
      return true;
    });
    expect(requestSingleInstanceLock({ requestSingleInstanceLock: nativeLock }, 'linux')).toBe(true);
    expect(process.env.TMPDIR).toBe(original);
  });

  it('restores TMPDIR and propagates a native failure', () => {
    const original = '/long-' + 'a'.repeat(100);
    vi.stubEnv('TMPDIR', original);
    const error = new Error('lock failed');
    expect(() => requestSingleInstanceLock({ requestSingleInstanceLock: () => { throw error; } }, 'linux')).toThrow(error);
    expect(process.env.TMPDIR).toBe(original);
  });

  it.each(['darwin', 'win32'] as const)('leaves %s temp policy alone', (platform) => {
    const original = '/' + 'a'.repeat(100);
    vi.stubEnv('TMPDIR', original);
    const nativeLock = vi.fn(() => {
      expect(process.env.TMPDIR).toBe(original);
      return true;
    });
    expect(requestSingleInstanceLock({ requestSingleInstanceLock: nativeLock }, platform)).toBe(true);
  });

  it('leaves an unset TMPDIR unset', () => {
    vi.stubEnv('TMPDIR', undefined);
    const nativeLock = vi.fn(() => {
      expect(process.env.TMPDIR).toBeUndefined();
      return true;
    });
    expect(requestSingleInstanceLock({ requestSingleInstanceLock: nativeLock }, 'linux')).toBe(true);
    expect(process.env.TMPDIR).toBeUndefined();
  });
});
