import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadApprovedImageSource } from '../../../src/tools/video/approved-media-source.js';

const roots: string[] = [];
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fixture'),
]);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<{ root: string; file: string; sha256: string }> {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'approved-media-'));
  roots.push(root);
  const file = path.join(root, 'portrait.png');
  await fs.writeFile(file, png);
  return { root, file, sha256: createHash('sha256').update(png).digest('hex') };
}

describe('loadApprovedImageSource', () => {
  it('returns digest-pinned bytes and detects MIME from the signature', async () => {
    const value = await fixture();
    await expect(loadApprovedImageSource(value.file, value.root, value.sha256)).resolves.toMatchObject({
      contentType: 'image/png',
      sha256: value.sha256,
      realPath: value.file,
    });
  });

  it('rejects digest mismatches and fake image extensions', async () => {
    const value = await fixture();
    await expect(loadApprovedImageSource(value.file, value.root, 'a'.repeat(64))).rejects.toThrow('digest');
    const fake = path.join(value.root, 'fake.png');
    await fs.writeFile(fake, 'not an image');
    const digest = createHash('sha256').update('not an image').digest('hex');
    await expect(loadApprovedImageSource(fake, value.root, digest)).rejects.toThrow('signature');
  });

  it('rejects symlinks and files outside the approved root', async () => {
    const value = await fixture();
    const outsideRoot = await fs.mkdtemp(path.join(tmpdir(), 'outside-media-'));
    roots.push(outsideRoot);
    const outside = path.join(outsideRoot, 'outside.png');
    await fs.writeFile(outside, png);
    const link = path.join(value.root, 'linked.png');
    await fs.symlink(outside, link);
    await expect(loadApprovedImageSource(link, value.root, value.sha256)).rejects.toThrow('non-symlink');
    await expect(loadApprovedImageSource(outside, value.root, value.sha256)).rejects.toThrow('escapes');
  });
});
