/**
 * A photo she can bring up later. One rolling memory key (the same mechanism as
 * `episode:recent`), read back by the relational context so "la photo du lac de
 * l'autre jour" is something Lisa can actually say.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRelationalContext } from '../../src/companion/relational-context.js';
import type { PreparedCompanionPhoto } from '../../src/companion/companion-photo.js';
import {
  SHARED_PHOTO_MEMORY_KEY,
  SHARED_PHOTO_MEMORY_LINES,
  SHARED_PHOTO_MEMORY_SCOPE,
  mergePhotoMemory,
  readSharedPhotoMemory,
  rememberSharedPhotos,
  type PhotoMemoryPort,
} from '../../src/companion/shared-photo-memory.js';
import { listSharedPhotos } from '../../src/companion/shared-photos.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function photo(description?: string): PreparedCompanionPhoto {
  return {
    mimeType: 'image/png',
    bytes: PNG_1X1,
    dataUrl: `data:image/png;base64,${PNG_1X1.toString('base64')}`,
    ...(description ? { description } : {}),
  };
}

/** In-memory stand-in for the persistent-memory manager. */
function fakeMemory(initial: Record<string, string> = {}): PhotoMemoryPort & {
  store: Record<string, string>;
  scopes: string[];
} {
  const store: Record<string, string> = { ...initial };
  const scopes: string[] = [];
  return {
    store,
    scopes,
    recall: (key: string, scope?: string) => {
      if (scope) scopes.push(scope);
      return store[key] ?? null;
    },
    remember: async (key: string, value: string, options?: { scope?: string }) => {
      if (options?.scope) scopes.push(options.scope);
      store[key] = value;
    },
  };
}

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cb-photo-mem-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('the rolling photo memory', () => {
  it('prepends, deduplicates and stays bounded', () => {
    const line = '2026-09-06 : tu m’as montré un lac';
    expect(mergePhotoMemory(null, line, 3)).toBe(line);
    expect(mergePhotoMemory('vieux', line, 3)).toBe(`${line}\nvieux`);
    expect(mergePhotoMemory(`${line}\nvieux`, line, 3)).toBe(`${line}\nvieux`);
    const long = mergePhotoMemory('a\nb\nc\nd\ne\nf', line, SHARED_PHOTO_MEMORY_LINES);
    expect(long.split('\n')).toHaveLength(SHARED_PHOTO_MEMORY_LINES);
    expect(long.split('\n')[0]).toBe(line);
  });

  it('writes one dated line under a single key and files the album entry', async () => {
    const memory = fakeMemory();
    const records = await rememberSharedPhotos([photo('un lac au coucher du soleil')], {
      surface: 'mobile',
      caption: 'regarde',
      dir,
      memory,
      now: new Date('2026-09-06T18:00:00Z'),
    });

    expect(records).toHaveLength(1);
    expect(await listSharedPhotos({ dir })).toHaveLength(1);
    const written = memory.store[SHARED_PHOTO_MEMORY_KEY]!;
    expect(written).toBe("2026-09-06 : tu m'as montré un lac au coucher du soleil");
    expect(Object.keys(memory.store)).toEqual([SHARED_PHOTO_MEMORY_KEY]);
  });

  it('writes in the USER scope — the project memory file is git-tracked', async () => {
    // `.codebuddy/CODEBUDDY_MEMORY.md` is resolved RELATIVE TO THE CWD and is a
    // tracked file when the server runs inside a repository. The description of
    // a private photo must never be written there.
    expect(SHARED_PHOTO_MEMORY_SCOPE).toBe('user');
    const memory = fakeMemory();
    await rememberSharedPhotos([photo('un lac')], { surface: 'mobile', dir, memory });
    expect(memory.scopes.length).toBeGreaterThan(0);
    expect(memory.scopes.every((scope) => scope === 'user')).toBe(true);
    expect(memory.scopes).not.toContain('project');
  });

  it('keeps one key however many photos are shared', async () => {
    const memory = fakeMemory();
    for (let index = 0; index < 8; index += 1) {
      await rememberSharedPhotos(
        [
          {
            ...photo(`scène ${index}`),
            bytes: Buffer.concat([PNG_1X1, Buffer.from(String(index))]),
          },
        ],
        { surface: 'telegram', dir, memory, now: new Date(`2026-0${(index % 8) + 1}-01T00:00:00Z`) },
      );
    }
    expect(Object.keys(memory.store)).toEqual([SHARED_PHOTO_MEMORY_KEY]);
    expect(memory.store[SHARED_PHOTO_MEMORY_KEY]!.split('\n').length).toBeLessThanOrEqual(
      SHARED_PHOTO_MEMORY_LINES,
    );
  });

  it('reads the block back', async () => {
    const memory = fakeMemory({ [SHARED_PHOTO_MEMORY_KEY]: '2026-09-06 : tu m’as montré un lac' });
    expect(await readSharedPhotoMemory(memory)).toBe('2026-09-06 : tu m’as montré un lac');
    expect(await readSharedPhotoMemory(fakeMemory())).toBeNull();
  });

  it('skips memory but still files the album when asked', async () => {
    const memory = fakeMemory();
    await rememberSharedPhotos([photo('un chien')], {
      surface: 'mobile',
      dir,
      memory,
      writeMemory: false,
    });
    expect(memory.store[SHARED_PHOTO_MEMORY_KEY]).toBeUndefined();
    expect(await listSharedPhotos({ dir })).toHaveLength(1);
  });

  it('never throws when memory is broken', async () => {
    const broken: PhotoMemoryPort = {
      recall: () => {
        throw new Error('memory offline');
      },
      remember: async () => undefined,
    };
    const records = await rememberSharedPhotos([photo('un lac')], {
      surface: 'mobile',
      dir,
      memory: broken,
    });
    expect(records).toHaveLength(1);
  });
});

describe('the relational context surfaces the photos', () => {
  it('adds a <recent_photos> block when there is one', async () => {
    const context = await buildRelationalContext({
      includeFacts: false,
      includeGuidance: false,
      includeEpisode: false,
      includePersonality: false,
      includePresence: false,
      includeInnerLife: false,
      includeSelfEvolution: false,
      photosBlock: async () => '2026-09-06 : tu m’as montré un lac au coucher du soleil',
    });
    expect(context).toContain('<recent_photos>');
    expect(context).toContain('un lac au coucher du soleil');
  });

  it('is byte-identical when no photo was ever shared', async () => {
    const common = {
      includeFacts: false,
      includeGuidance: false,
      includeEpisode: false,
      includePersonality: false,
      includePresence: false,
      includeInnerLife: false,
      includeSelfEvolution: false,
    } as const;
    const withoutPhotos = await buildRelationalContext({ ...common, includePhotos: false });
    const withEmptyPhotos = await buildRelationalContext({ ...common, photosBlock: async () => null });
    expect(withEmptyPhotos).toBe(withoutPhotos);
  });
});
