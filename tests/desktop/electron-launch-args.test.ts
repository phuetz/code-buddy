import { describe, expect, it } from 'vitest';
import { electronLaunchArgs } from '../../src/desktop/electron-launch-args.js';

describe('electronLaunchArgs', () => {
  const entry = '/repo/cowork/dist-electron/main/index.js';

  it('passes the Linux sandbox/GPU flags documented in cowork/DEV-LINUX.md', () => {
    expect(electronLaunchArgs(entry, 'linux')).toEqual([
      '--no-sandbox',
      '--disable-gpu',
      entry,
    ]);
  });

  it('does not add Linux-only flags on macOS or Windows', () => {
    expect(electronLaunchArgs(entry, 'darwin')).toEqual([entry]);
    expect(electronLaunchArgs(entry, 'win32')).toEqual([entry]);
  });
});
