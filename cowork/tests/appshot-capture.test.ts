import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppshotStaging, pickForegroundSource } from '../src/main/appshot-capture';

function pngStub() {
  return Buffer.from('89504e470d0a1a0a', 'hex');
}

describe('appshot staging', () => {
  it('prefers the named foreground window and skips Cowork when possible', () => {
    const sources = [
      { id: '1', name: 'Cowork', thumbnail: { isEmpty: () => false, toPNG: pngStub } },
      { id: '2', name: 'Firefox', thumbnail: { isEmpty: () => false, toPNG: pngStub } },
    ];
    expect(pickForegroundSource(sources, 'Firefox')?.name).toBe('Firefox');
    expect(pickForegroundSource(sources)?.name).toBe('Firefox');
  });

  it('does not send until confirm(), and cancel deletes the file', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'appshot-'));
    const staging = new AppshotStaging({
      userData,
      now: () => 42,
      getSources: async () => [
        {
          id: 'w1',
          name: 'Notes',
          thumbnail: { isEmpty: () => false, toPNG: () => Buffer.from('png-bytes') },
        },
      ],
    });
    const pending = await staging.capture('sess-1');
    expect(existsSync(pending.filePath)).toBe(true);
    expect(readFileSync(pending.filePath, 'utf8')).toBe('png-bytes');
    expect(() => staging.confirm()).not.toThrow();
    expect(() => staging.confirm()).toThrow(/confirmation required/i);
  });

  it('refuses send when nothing is pending', () => {
    const userData = mkdtempSync(join(tmpdir(), 'appshot-'));
    const staging = new AppshotStaging({
      userData,
      getSources: async () => [],
    });
    expect(() => staging.confirm()).toThrow(/confirmation required/i);
  });

  it('cancel removes a staged capture without sending', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'appshot-'));
    const staging = new AppshotStaging({
      userData,
      now: () => 7,
      getSources: async () => [
        {
          id: 'w1',
          name: 'Notes',
          thumbnail: { isEmpty: () => false, toPNG: () => Buffer.from('x') },
        },
      ],
    });
    const pending = await staging.capture('sess-2');
    staging.cancel();
    expect(existsSync(pending.filePath)).toBe(false);
    expect(() => staging.confirm()).toThrow(/confirmation required/i);
  });
});
