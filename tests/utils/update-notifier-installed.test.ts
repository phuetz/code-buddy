import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';
import { UpdateNotifier } from '../../src/utils/update-notifier.js';

vi.mock('fs', async (importOriginal) => ({ ...await importOriginal<typeof import('fs')>(), readFileSync: vi.fn() }));
vi.mock('../../src/utils/atomic-write.js', () => ({
  readJsonAtomicSync: vi.fn(() => ({ latestVersion: '2.0.0', lastCheck: new Date().toISOString() })),
  writeJsonAtomicSync: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

describe('installed update notifier', () => {
  it.each(['Z:\\Partage', '/tmp/unrelated-code-buddy-project'])('reads its own manifest when launched from %s', async (cwd) => {
    vi.spyOn(process, 'cwd').mockReturnValue(cwd);
    vi.mocked(fs.readFileSync).mockImplementation((path) => {
      expect(path).toBeInstanceOf(URL);
      expect(fileURLToPath(path as URL)).toBe(fileURLToPath(new URL('../../package.json', import.meta.url)));
      return JSON.stringify({ name: '@phuetz/code-buddy', version: '2.0.0' });
    });
    const network = vi.spyOn(https, 'get');
    const notifier = new UpdateNotifier();
    expect(await notifier.check()).toMatchObject({ currentVersion: '2.0.0', updateAvailable: false });
    expect(notifier.formatNotification()).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });

  it.each([null, '{}', '{invalid', '{"name":"other-code-buddy","version":"1.0.0"}', '{"name":"@phuetz/code-buddy","version":42}'])('suppresses checks when the installed manifest is unavailable or invalid: %s', async (manifest) => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      if (manifest === null) throw new Error('missing');
      return manifest;
    });
    const network = vi.spyOn(https, 'get');
    const notifier = new UpdateNotifier();
    expect(await notifier.check()).toBeNull();
    expect(await notifier.forceCheck()).toBeNull();
    expect(notifier.formatNotification()).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });

  it('still announces a newer cached release', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('{"name":"@phuetz/code-buddy","version":"1.8.0"}');
    const notifier = new UpdateNotifier();
    expect(await notifier.check()).toMatchObject({ currentVersion: '1.8.0', updateAvailable: true });
    expect(notifier.formatNotification()).toContain('1.8.0 → 2.0.0');
  });
});
