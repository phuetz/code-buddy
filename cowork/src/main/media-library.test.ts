/**
 * media-library — real filesystem scan: media-generation subtree (recursive),
 * loose audio at the root (non-recursive), kind mapping, dedup + newest-first.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { kindOf, scanMediaLibrary, scanRoot } from './media-library.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-lib-'));
  const images = path.join(root, '.codebuddy', 'media-generation', 'images');
  const videos = path.join(root, '.codebuddy', 'media-generation', 'videos');
  fs.mkdirSync(images, { recursive: true });
  fs.mkdirSync(videos, { recursive: true });
  fs.writeFileSync(path.join(images, 'a.jpg'), 'x'.repeat(10));
  fs.writeFileSync(path.join(videos, 'b.mp4'), 'x'.repeat(20));
  fs.writeFileSync(path.join(root, 'voice.wav'), 'x'.repeat(5));
  // Non-media + nested non-media must be ignored.
  fs.writeFileSync(path.join(root, 'notes.txt'), 'nope');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'photo.png'), 'not scanned (root is non-recursive)');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('scanRoot', () => {
  it('finds media-generation media + loose root audio, ignores the rest', () => {
    const items = scanRoot(root);
    const names = items.map((i) => path.basename(i.path)).sort();
    expect(names).toEqual(['a.jpg', 'b.mp4', 'voice.wav']);
    expect(items.every((i) => i.root === root)).toBe(true);
    expect(items.find((i) => i.path.endsWith('a.jpg'))?.kind).toBe('image');
    expect(items.find((i) => i.path.endsWith('b.mp4'))?.kind).toBe('video');
    expect(items.find((i) => i.path.endsWith('voice.wav'))?.kind).toBe('audio');
  });
});

describe('assembled films', () => {
  it('indexes a produced film under media-generation/films with its sidecar', () => {
    const films = path.join(root, '.codebuddy', 'media-generation', 'films');
    fs.mkdirSync(films, { recursive: true });
    fs.writeFileSync(path.join(films, 'my-demo-123.mp4'), 'x'.repeat(30));
    fs.writeFileSync(
      path.join(films, 'my-demo-123.mp4.meta.json'),
      JSON.stringify({ kind: 'film', prompt: 'My Demo — 3 clips enchaînés (xfade)', provider: 'film', model: 'xfade' }),
    );
    const film = scanRoot(root).find((i) => i.path.endsWith('my-demo-123.mp4'));
    expect(film?.kind).toBe('video');
    expect(film).toMatchObject({ provider: 'film', model: 'xfade' });
    expect(film?.prompt).toContain('My Demo');
  });
});

describe('sidecar metadata', () => {
  it('reads prompt/model/provider from <file>.meta.json, fail-open otherwise', () => {
    const images = path.join(root, '.codebuddy', 'media-generation', 'images');
    fs.writeFileSync(
      path.join(images, 'a.jpg.meta.json'),
      JSON.stringify({ prompt: 'un chiot sharpei', model: 'grok-imagine', provider: 'xai' }),
    );
    fs.writeFileSync(path.join(images, 'broken.png'), 'x');
    fs.writeFileSync(path.join(images, 'broken.png.meta.json'), '{not json');
    const items = scanRoot(root);
    const withMeta = items.find((i) => i.path.endsWith('a.jpg'));
    expect(withMeta).toMatchObject({ prompt: 'un chiot sharpei', model: 'grok-imagine', provider: 'xai' });
    const broken = items.find((i) => i.path.endsWith('broken.png'));
    expect(broken?.prompt).toBeUndefined();
  });
});

describe('scanMediaLibrary', () => {
  it('deduplicates repeated roots and sorts newest first', () => {
    const items = scanMediaLibrary([root, root, path.join(root, 'missing')]);
    expect(items).toHaveLength(3);
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].mtimeMs).toBeGreaterThanOrEqual(items[i].mtimeMs);
    }
  });
});

describe('kindOf', () => {
  it('maps extensions case-insensitively and rejects non-media', () => {
    expect(kindOf('/x/IMG.JPG')).toBe('image');
    expect(kindOf('/x/clip.WebM')).toBe('video');
    expect(kindOf('/x/notes.txt')).toBeNull();
  });
});
