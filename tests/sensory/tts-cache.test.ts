import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TtsCache } from '../../src/sensory/tts-cache.js';

let dir: string;
let tmp: string;
let src: string;
let clock = 1_000_000;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ttscache-'));
  tmp = await mkdtemp(path.join(os.tmpdir(), 'ttstmp-'));
  src = path.join(tmp, 'src.wav');
  await writeFile(src, Buffer.from('RIFF....fake-wav-bytes'));
  clock = 1_000_000;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(tmp, { recursive: true, force: true });
});

const cache = () => new TtsCache({ dir, tmpDir: tmp, now: () => clock });

describe('TtsCache — reuse repeated syntheses + count usage', () => {
  it('miss → store → hit returns a throwaway copy and counts exactly once per use', () => {
    const c = cache();
    expect(c.lookup('Bonjour', 'v')).toBeNull(); // miss: nothing cached yet

    c.store('Bonjour', 'v', src); // first use (miss) → hits = 1
    expect(c.stats()).toHaveLength(1);
    expect(c.stats()[0]!.hits).toBe(1);
    expect(c.stats()[0]!.text).toBe('Bonjour');

    clock += 1000;
    const hit = c.lookup('Bonjour', 'v'); // reuse → hits = 2
    expect(hit).not.toBeNull();
    expect(existsSync(hit!)).toBe(true);
    expect(hit!.startsWith(dir)).toBe(false); // copy-on-hit: NOT the cache file itself
    expect(c.stats()[0]!.hits).toBe(2);

    c.lookup('Bonjour', 'v'); // reuse → hits = 3
    expect(c.stats()[0]!.hits).toBe(3);
  });

  it('separates entries by text and by voice; stats sort by hits desc', () => {
    const c = cache();
    c.store('A', 'v', src);
    c.store('B', 'v', src);
    c.lookup('B', 'v');
    c.lookup('B', 'v'); // B → 3, A → 1
    expect(c.stats().map((e) => e.text)).toEqual(['B', 'A']);

    expect(c.lookup('A', 'otherVoice')).toBeNull(); // same text, different voice → miss
  });

  it('evict drops the one-offs and keeps the useful (high-hit) entries', () => {
    const c = cache();
    c.store('keep', 'v', src);
    c.lookup('keep', 'v');
    c.lookup('keep', 'v'); // keep → 3
    c.store('drop', 'v', src); // drop → 1
    const removed = c.evict({ maxHits: 1 });
    expect(removed).toHaveLength(1);
    expect(c.stats().map((e) => e.text)).toEqual(['keep']);
    expect(c.lookup('drop', 'v')).toBeNull(); // its WAV is gone too
  });

  it('never throws on a bad source path (best-effort on the speak hot path)', () => {
    const c = cache();
    expect(() => c.store('x', 'v', path.join(tmp, 'does-not-exist.wav'))).not.toThrow();
    expect(c.lookup('x', 'v')).toBeNull();
  });
});
