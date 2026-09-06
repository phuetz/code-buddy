/**
 * The shared album is a couple's memory, not a cache: an entry must survive,
 * stay private (0600, no name, no absolute path), deduplicate the same photo,
 * and never evict a favourite.
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SHARED_PHOTOS_MAX,
  deleteSharedPhoto,
  extensionForMime,
  listSharedPhotos,
  pruneSharedPhotos,
  readSharedPhoto,
  resolveSharedPhotosDir,
  setSharedPhotoFavorite,
  sharedPhotosMax,
  storeSharedPhoto,
} from '../../src/companion/shared-photos.js';

let dir = '';

/** Deterministic 8x8-ish payload — bytes only, never a real photo. */
function fakeJpeg(seed: number): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from(`payload-${seed}`, 'utf8'),
    Buffer.from([0xff, 0xd9]),
  ]);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cb-album-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('shared album — storage', () => {
  it('stores bytes and a sidecar under <yyyy-mm>/<sha256> with 0600 permissions', async () => {
    const record = await storeSharedPhoto(
      {
        bytes: fakeJpeg(1),
        mimeType: 'image/jpeg',
        surface: 'mobile',
        captionUser: 'regarde ce que j’ai vu',
        descriptionLisa: 'un lac au coucher du soleil',
      },
      { dir, now: new Date('2026-09-06T10:00:00Z') },
    );

    expect(record).not.toBeNull();
    expect(record!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(record!.descriptionLisa).toBe('un lac au coucher du soleil');

    const months = await readdir(dir);
    expect(months).toEqual(['2026-09']);
    const files = (await readdir(path.join(dir, '2026-09'))).sort();
    expect(files).toEqual([`${record!.hash}.jpg`, `${record!.hash}.json`]);

    for (const file of files) {
      const mode = statSync(path.join(dir, '2026-09', file)).mode & 0o777;
      expect(mode).toBe(0o600);
    }

    const sidecar = JSON.parse(
      await readFile(path.join(dir, '2026-09', `${record!.hash}.json`), 'utf8'),
    ) as Record<string, unknown>;
    expect(Object.keys(sidecar).sort()).toEqual(
      ['bytes', 'captionUser', 'descriptionLisa', 'hash', 'mimeType', 'receivedAt', 'surface'].sort(),
    );
    // No absolute path, no identity, ever — the only slash allowed is the MIME type.
    const serialized = JSON.stringify(sidecar);
    expect(serialized).not.toMatch(/(?:^|")(?:\/|[A-Za-z]:\\)/);
    expect(serialized).not.toContain(dir);
    expect(serialized).not.toContain(homedir());
  });

  it('bounds the description to 300 characters', async () => {
    const record = await storeSharedPhoto(
      {
        bytes: fakeJpeg(2),
        mimeType: 'image/jpeg',
        surface: 'telegram',
        descriptionLisa: 'x'.repeat(900),
      },
      { dir },
    );
    expect(record!.descriptionLisa.length).toBe(300);
    expect(record!.descriptionLisa.endsWith('…')).toBe(true);
  });

  it('treats the same photo sent twice as one memory and keeps its first date', async () => {
    const bytes = fakeJpeg(3);
    const first = await storeSharedPhoto(
      { bytes, mimeType: 'image/jpeg', surface: 'mobile', descriptionLisa: 'le chien' },
      { dir, now: new Date('2026-08-01T09:00:00Z') },
    );
    const second = await storeSharedPhoto(
      { bytes, mimeType: 'image/jpeg', surface: 'telegram' },
      { dir, now: new Date('2026-09-06T09:00:00Z') },
    );
    expect(second!.hash).toBe(first!.hash);
    expect(second!.receivedAt).toBe(first!.receivedAt);
    expect(second!.descriptionLisa).toBe('le chien');
    expect(await listSharedPhotos({ dir })).toHaveLength(1);
  });

  it('reads back the exact bytes, and refuses a traversal hash', async () => {
    const bytes = fakeJpeg(4);
    const record = await storeSharedPhoto(
      { bytes, mimeType: 'image/jpeg', surface: 'mobile' },
      { dir },
    );
    const loaded = await readSharedPhoto(record!.hash, { dir });
    expect(loaded!.bytes.equals(bytes)).toBe(true);
    expect(await readSharedPhoto('../../etc/passwd', { dir })).toBeNull();
    expect(await readSharedPhoto('NOTAHASH', { dir })).toBeNull();
  });
});

describe('shared album — listing, favourites, capacity', () => {
  it('lists newest first', async () => {
    await storeSharedPhoto(
      { bytes: fakeJpeg(10), mimeType: 'image/jpeg', surface: 'mobile' },
      { dir, now: new Date('2026-07-01T00:00:00Z') },
    );
    const newest = await storeSharedPhoto(
      { bytes: fakeJpeg(11), mimeType: 'image/jpeg', surface: 'mobile' },
      { dir, now: new Date('2026-09-01T00:00:00Z') },
    );
    const listed = await listSharedPhotos({ dir });
    expect(listed).toHaveLength(2);
    expect(listed[0]!.hash).toBe(newest!.hash);
  });

  it('marks and unmarks a favourite', async () => {
    const record = await storeSharedPhoto(
      { bytes: fakeJpeg(12), mimeType: 'image/jpeg', surface: 'mobile' },
      { dir },
    );
    expect((await setSharedPhotoFavorite(record!.hash, true, { dir }))!.favorite).toBe(true);
    expect((await setSharedPhotoFavorite(record!.hash, false, { dir }))!.favorite).toBeUndefined();
    expect(await setSharedPhotoFavorite('deadbeef', true, { dir })).toBeNull();
  });

  it('deletes an entry, bytes and sidecar', async () => {
    const record = await storeSharedPhoto(
      { bytes: fakeJpeg(13), mimeType: 'image/jpeg', surface: 'mobile' },
      { dir },
    );
    expect(await deleteSharedPhoto(record!.hash, { dir })).toBe(true);
    expect(await listSharedPhotos({ dir })).toHaveLength(0);
    expect(await deleteSharedPhoto(record!.hash, { dir })).toBe(false);
  });

  it('evicts the oldest non-favourite over the cap and never a favourite', async () => {
    const env = { CODEBUDDY_SHARED_PHOTOS_MAX: '2' } as NodeJS.ProcessEnv;
    const oldest = await storeSharedPhoto(
      { bytes: fakeJpeg(20), mimeType: 'image/jpeg', surface: 'mobile' },
      { dir, env, now: new Date('2026-01-01T00:00:00Z') },
    );
    await setSharedPhotoFavorite(oldest!.hash, true, { dir });
    const middle = await storeSharedPhoto(
      { bytes: fakeJpeg(21), mimeType: 'image/jpeg', surface: 'mobile' },
      { dir, env, now: new Date('2026-02-01T00:00:00Z') },
    );
    await storeSharedPhoto(
      { bytes: fakeJpeg(22), mimeType: 'image/jpeg', surface: 'mobile' },
      { dir, env, now: new Date('2026-03-01T00:00:00Z') },
    );
    await storeSharedPhoto(
      { bytes: fakeJpeg(23), mimeType: 'image/jpeg', surface: 'mobile' },
      { dir, env, now: new Date('2026-04-01T00:00:00Z') },
    );

    const remaining = (await listSharedPhotos({ dir })).map((entry) => entry.hash);
    expect(remaining).toContain(oldest!.hash);
    expect(remaining).not.toContain(middle!.hash);
    expect(remaining.length).toBeLessThanOrEqual(3);
    await pruneSharedPhotos({ dir, env });
  });
});

describe('shared album — configuration', () => {
  it('defaults the capacity to 500 and ignores garbage', () => {
    expect(sharedPhotosMax({} as NodeJS.ProcessEnv)).toBe(DEFAULT_SHARED_PHOTOS_MAX);
    expect(sharedPhotosMax({ CODEBUDDY_SHARED_PHOTOS_MAX: 'x' } as NodeJS.ProcessEnv)).toBe(500);
    expect(sharedPhotosMax({ CODEBUDDY_SHARED_PHOTOS_MAX: '-3' } as NodeJS.ProcessEnv)).toBe(500);
    expect(sharedPhotosMax({ CODEBUDDY_SHARED_PHOTOS_MAX: '12' } as NodeJS.ProcessEnv)).toBe(12);
  });

  it('stores outside the repository by default', () => {
    const resolved = resolveSharedPhotosDir({} as NodeJS.ProcessEnv);
    expect(resolved).toContain(path.join('.codebuddy', 'companion', 'shared-photos'));
    // Under the user's home, never under the tracked source tree.
    expect(resolved.startsWith(homedir())).toBe(true);
    expect(resolved).not.toContain(`${path.sep}src${path.sep}`);
    expect(resolved).not.toContain(`${path.sep}tests${path.sep}`);
  });

  it('maps MIME types to extensions', () => {
    expect(extensionForMime('image/jpeg')).toBe('.jpg');
    expect(extensionForMime('image/png')).toBe('.png');
    expect(extensionForMime('application/pdf')).toBe('.bin');
  });

  it('returns an empty album rather than throwing when the directory is absent', async () => {
    expect(await listSharedPhotos({ dir: path.join(dir, 'nope') })).toEqual([]);
  });
});
