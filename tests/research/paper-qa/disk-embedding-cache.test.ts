import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DiskEmbeddingCache } from '../../../src/research/paper-qa/disk-embedding-cache.js';

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'codebuddy-paper-qa-'));
  directories.push(directory);
  return directory;
}

function fingerprint(char: string): string {
  return char.repeat(40);
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

describe('DiskEmbeddingCache', () => {
  it('restores an exact vector in a new process-like instance', () => {
    const directory = temporaryDirectory();
    const first = new DiskEmbeddingCache({ directory, maxEntries: 10 });
    first.set(fingerprint('a'), new Float32Array([0.25, -1.5, 3.75]));

    const restored = new DiskEmbeddingCache({ directory, maxEntries: 10 }).get(fingerprint('a'));

    expect(restored).toEqual(new Float32Array([0.25, -1.5, 3.75]));
  });

  it('evicts the oldest entry when the configured bound is reached', async () => {
    const directory = temporaryDirectory();
    const cache = new DiskEmbeddingCache({ directory, maxEntries: 2 });
    cache.set(fingerprint('a'), new Float32Array([1]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    cache.set(fingerprint('b'), new Float32Array([2]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    cache.set(fingerprint('c'), new Float32Array([3]));

    expect(cache.get(fingerprint('a'))).toBeUndefined();
    expect(cache.get(fingerprint('b'))).toEqual(new Float32Array([2]));
    expect(cache.get(fingerprint('c'))).toEqual(new Float32Array([3]));
  });

  it('deletes a corrupt entry and degrades to a miss', () => {
    const directory = temporaryDirectory();
    const cache = new DiskEmbeddingCache({ directory, maxEntries: 10 });
    cache.set(fingerprint('d'), new Float32Array([4, 5]));
    const path = join(directory, 'dd', `${fingerprint('d')}.f32`);
    expect(readFileSync(path).length).toBeGreaterThan(0);
    writeFileSync(path, 'corrupt');

    expect(cache.get(fingerprint('d'))).toBeUndefined();
  });

  it('ignores unsafe fingerprints and non-finite vectors', () => {
    const cache = new DiskEmbeddingCache({ directory: temporaryDirectory(), maxEntries: 10 });

    cache.set('../outside', new Float32Array([1]));
    cache.set(fingerprint('e'), new Float32Array([Number.NaN]));

    expect(cache.get('../outside')).toBeUndefined();
    expect(cache.get(fingerprint('e'))).toBeUndefined();
  });
});
