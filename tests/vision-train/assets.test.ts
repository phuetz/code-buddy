/**
 * vision-train assets — real tests (no mocks) for the pure Poly Haven parsing:
 * nested-file URL discovery, category/tag filtering, format preference. fetch is
 * injected (offline), and every path is fail-open ([] / null, never throws).
 */
import { describe, expect, it } from 'vitest';
import {
  firstFileUrl,
  listPolyHavenModels,
  resolveAssetUrl,
  type FetchLike,
} from '../../src/vision-train/assets.js';

function fakeFetch(map: Record<string, unknown>): FetchLike {
  return async (url: string) => {
    const body = map[url];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
  };
}

describe('firstFileUrl', () => {
  it('finds a url deep in Poly Haven nested files (format→res→name→{url})', () => {
    const files = {
      blend: { '1k': { blend: { url: 'https://ph/x.blend' } } },
      gltf: { '2k': { gltf: { url: 'https://ph/x.gltf' } } },
    };
    expect(firstFileUrl(files, 'gltf')).toBe('https://ph/x.gltf');
    expect(firstFileUrl(files, '.blend')).toBe('https://ph/x.blend');
  });

  it('ignores query strings when matching the extension and returns null if absent', () => {
    const files = { glb: { '1k': { glb: { url: 'https://ph/y.glb?token=abc' } } } };
    expect(firstFileUrl(files, 'glb')).toBe('https://ph/y.glb?token=abc');
    expect(firstFileUrl(files, 'obj')).toBeNull();
  });
});

describe('listPolyHavenModels', () => {
  const base = 'https://api.test';
  const catalog = {
    red_chair: { categories: ['furniture'], tags: ['chair', 'seat'] },
    hdri_sky: { categories: ['skies'], tags: ['outdoor'] },
    couch_a: { categories: ['furniture'], tags: ['couch', 'sofa'] },
  };

  it('returns all slugs with no filter', async () => {
    const slugs = await listPolyHavenModels(fakeFetch({ [`${base}/assets?type=models`]: catalog }), { apiBase: base });
    expect(slugs.sort()).toEqual(['couch_a', 'hdri_sky', 'red_chair']);
  });

  it('filters by category/tag intersection (case-insensitive substring)', async () => {
    const slugs = await listPolyHavenModels(fakeFetch({ [`${base}/assets?type=models`]: catalog }), {
      apiBase: base,
      matchAny: ['chair', 'couch'],
    });
    expect(slugs.sort()).toEqual(['couch_a', 'red_chair']);
  });

  it('returns [] on a failed response, never throws', async () => {
    const slugs = await listPolyHavenModels(fakeFetch({}), { apiBase: base });
    expect(slugs).toEqual([]);
  });
});

describe('resolveAssetUrl', () => {
  const base = 'https://api.test';
  it('prefers self-contained blend, then falls back to glb', async () => {
    const both = { glb: { '1k': { glb: { url: 'https://ph/a.glb' } } }, blend: { '1k': { blend: { url: 'https://ph/a.blend' } } } };
    const url = await resolveAssetUrl(fakeFetch({ [`${base}/files/a`]: both }), 'a', { apiBase: base });
    expect(url).toBe('https://ph/a.blend');

    const glbOnly = { glb: { '1k': { glb: { url: 'https://ph/c.glb' } } } };
    const url2 = await resolveAssetUrl(fakeFetch({ [`${base}/files/c`]: glbOnly }), 'c', { apiBase: base });
    expect(url2).toBe('https://ph/c.glb');
  });

  it('returns null when the slug is unknown, never throws', async () => {
    expect(await resolveAssetUrl(fakeFetch({}), 'missing', { apiBase: base })).toBeNull();
  });
});
