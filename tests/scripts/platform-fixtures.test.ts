import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasBash, spawnBashScript, forceLinuxWithoutDisplay } from '../setup/platform-fixtures.js';

// Windows needs a working Git Bash, not merely a bash.exe WSL placeholder.
describe.skipIf(process.platform === 'win32' && !hasBash())('portable Bash script fixture', () => {
  it('runs a script whose path has spaces and Windows separators without interpreting arguments', () => {
    const root = mkdtempSync(join(tmpdir(), 'bash fixture '));
    try {
      const script = join(root, 'fixture script.sh');
      writeFileSync(script, '#!/usr/bin/env bash\nprintf "%s" "$1"\n');
      const result = spawnBashScript(script.replace(/\//g, '\\'), ['literal $(exit 9)'], {
        encoding: 'utf8',
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('literal $(exit 9)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('explicit Linux headless fixture', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    vi.unstubAllEnvs();
    Object.defineProperty(process, 'platform', originalPlatform);
  });

  it.each(['linux', 'darwin', 'win32'])('selects and restores the backend from %s', (platform) => {
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });
    vi.stubEnv('DISPLAY', ':99');
    vi.stubEnv('WAYLAND_DISPLAY', 'wayland-fixture');
    const display = process.env.DISPLAY;
    const wayland = process.env.WAYLAND_DISPLAY;
    restore = forceLinuxWithoutDisplay();
    expect(process.platform).toBe('linux');
    expect(process.env.DISPLAY).toBeUndefined();
    expect(process.env.WAYLAND_DISPLAY).toBeUndefined();
    restore();
    restore = undefined;
    expect(process.platform).toBe(platform);
    expect(process.env.DISPLAY).toBe(display);
    expect(process.env.WAYLAND_DISPLAY).toBe(wayland);
  });
});
