/**
 * media-library — real filesystem scan: media-generation subtree (recursive),
 * loose audio at the root (non-recursive), kind mapping, dedup + newest-first.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isExportableMediaBundlePath,
  kindOf,
  resolveExportableMediaBundlePaths,
  scanMediaLibrary,
  scanRoot,
} from './media-library.js';

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

  it('exports a YouTube sidecar only beside its selected source video', () => {
    const video = '/x/final.mp4';
    expect(isExportableMediaBundlePath(`${video}.youtube.json`, [video, `${video}.youtube.json`])).toBe(true);
    expect(isExportableMediaBundlePath('/x/unrelated.youtube.json', [video])).toBe(false);
    expect(isExportableMediaBundlePath('/x/secrets.json', [video])).toBe(false);
  });
});

describe('resolveExportableMediaBundlePaths', () => {
  it('confines regular media and its exact YouTube sidecar to trusted roots', async () => {
    const video = path.join(root, '.codebuddy', 'media-generation', 'videos', 'b.mp4');
    const sidecar = `${video}.youtube.json`;
    fs.writeFileSync(sidecar, '{}');
    await expect(resolveExportableMediaBundlePaths([video, sidecar], [root]))
      .resolves.toEqual([video, sidecar]);
  });

  it('rejects outside files, symlinks and orphan sidecars', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'media-outside-'));
    try {
      const outsideVideo = path.join(outside, 'outside.mp4');
      fs.writeFileSync(outsideVideo, 'video');
      const linked = path.join(root, '.codebuddy', 'media-generation', 'videos', 'linked.mp4');
      fs.symlinkSync(outsideVideo, linked);
      await expect(resolveExportableMediaBundlePaths([outsideVideo], [root])).rejects.toThrow('outside');
      await expect(resolveExportableMediaBundlePaths([linked], [root])).rejects.toThrow('non-symlink');
      const video = path.join(root, '.codebuddy', 'media-generation', 'videos', 'b.mp4');
      const sidecar = `${video}.youtube.json`;
      fs.writeFileSync(sidecar, '{}');
      await expect(resolveExportableMediaBundlePaths([sidecar], [root])).rejects.toThrow('exact source');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not export source-tree media merely because it is inside a workspace', async () => {
    const privateVideo = path.join(root, 'src', 'private.mp4');
    fs.writeFileSync(privateVideo, 'private source fixture');
    await expect(resolveExportableMediaBundlePaths([privateVideo], [root])).rejects.toThrow('not indexed');
  });

  it('accepts indexed loose audio but rejects loose video and symlinked ancestors', async () => {
    const looseAudio = path.join(root, 'voice.wav');
    await expect(resolveExportableMediaBundlePaths([looseAudio], [root])).resolves.toEqual([looseAudio]);

    const looseVideo = path.join(root, 'private.mp4');
    fs.writeFileSync(looseVideo, 'private source fixture');
    await expect(resolveExportableMediaBundlePaths([looseVideo], [root])).rejects.toThrow('not indexed');

    const videos = path.join(root, '.codebuddy', 'media-generation', 'videos');
    const realDirectory = path.join(videos, 'real');
    fs.mkdirSync(realDirectory);
    const realVideo = path.join(realDirectory, 'linked.mp4');
    fs.writeFileSync(realVideo, 'video');
    const linkedDirectory = path.join(videos, 'alias');
    fs.symlinkSync(realDirectory, linkedDirectory, 'dir');
    await expect(resolveExportableMediaBundlePaths([path.join(linkedDirectory, 'linked.mp4')], [root]))
      .rejects.toThrow('symbolic link');
  });

  it('rejects basename collisions that would overwrite one selected export', async () => {
    const videos = path.join(root, '.codebuddy', 'media-generation', 'videos');
    const firstDirectory = path.join(videos, 'first');
    const secondDirectory = path.join(videos, 'second');
    fs.mkdirSync(firstDirectory);
    fs.mkdirSync(secondDirectory);
    const first = path.join(firstDirectory, 'same.mp4');
    const second = path.join(secondDirectory, 'same.mp4');
    fs.writeFileSync(first, 'first');
    fs.writeFileSync(second, 'second');
    await expect(resolveExportableMediaBundlePaths([first, second], [root]))
      .rejects.toThrow('duplicate filename');
  });
});
