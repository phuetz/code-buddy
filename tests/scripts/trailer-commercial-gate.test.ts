import { createHash } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertTrailerCommerciallyRenderable,
  COMMERCIAL_GATE_FILENAME,
  LOCAL_MANIFEST_FILENAME,
  revalidateTrailerCommercialWorkspace,
} from '../../scripts/trailers/trailer-commercial-gate.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    fs.rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), 'commercial-gate-'));
  roots.push(value);
  return value;
}

function approvedDigest(chapters: Array<{ name: string; text: string }>): string {
  const hash = createHash('sha256');
  for (const chapter of chapters) {
    hash.update(chapter.name);
    hash.update('\0');
    hash.update(chapter.text);
    hash.update('\0');
  }
  return hash.digest('hex');
}

describe('trailer commercial gate', () => {
  it('refuses a known 1/40 manuscript before any render work', async () => {
    const parent = await root();
    const book = path.join(parent, 'La_Chair_des_Machines');
    await fs.mkdir(path.join(book, 'chapitres'), { recursive: true });
    await fs.writeFile(path.join(book, 'chapitres', 'chapitre-01.md'), '# Chapitre 1\n');

    await expect(assertTrailerCommerciallyRenderable(book)).rejects.toThrow(
      /manuscript incomplete: 1\/40.*chair-des-machines/iu,
    );
  });

  it('requires exact completeness, approval, digest, CTA and HTTPS URL', async () => {
    const book = await root();
    const directory = path.join(book, 'chapters');
    await fs.mkdir(directory);
    const chapters = Array.from({ length: 40 }, (_, index) => ({
      name: `${String(index + 1).padStart(2, '0')}.md`,
      text: `# Chapter ${index + 1}\n\nApproved text ${index + 1}.\n`,
    }));
    await Promise.all(chapters.map((chapter) =>
      fs.writeFile(path.join(directory, chapter.name), chapter.text)));
    const manifest = {
      titleId: 'complete-book',
      title: 'Complete Book',
      sourceDirectoryName: path.basename(book),
      chapterGlob: 'chapters/*.md',
      expectedChapters: 40,
      presentChapters: 40,
      manuscriptStatus: 'approved',
      approvedContentSha256: approvedDigest(chapters),
      cta: 'Read the book',
      url: 'https://example.test/complete-book',
    };
    await fs.writeFile(
      path.join(book, LOCAL_MANIFEST_FILENAME),
      `${JSON.stringify(manifest)}\n`,
    );

    await expect(assertTrailerCommerciallyRenderable(book)).resolves.toMatchObject({
      complete: true,
      presentChapters: 40,
      expectedChapters: 40,
      status: 'approved-for-trailer-render',
    });

    await fs.appendFile(path.join(directory, '40.md'), 'changed');
    await expect(assertTrailerCommerciallyRenderable(book)).rejects.toThrow(
      /changed since approval/iu,
    );
  });

  it('refuses replaying a workspace after its approved manuscript changed', async () => {
    const book = await root();
    const workspace = await root();
    const directory = path.join(book, 'chapters');
    await fs.mkdir(directory);
    const chapters = [{
      name: '01.md',
      text: '# Chapter 1\n\nApproved.\n',
    }];
    await fs.writeFile(path.join(directory, chapters[0]!.name), chapters[0]!.text);
    await fs.writeFile(path.join(book, LOCAL_MANIFEST_FILENAME), JSON.stringify({
      titleId: 'one-chapter-book',
      title: 'One Chapter Book',
      sourceDirectoryName: path.basename(book),
      chapterGlob: 'chapters/*.md',
      expectedChapters: 1,
      presentChapters: 1,
      manuscriptStatus: 'approved',
      approvedContentSha256: approvedDigest(chapters),
      cta: 'Read the book',
      url: 'https://example.test/one-chapter-book',
    }));
    const receipt = await assertTrailerCommerciallyRenderable(book);
    await fs.writeFile(
      path.join(workspace, COMMERCIAL_GATE_FILENAME),
      JSON.stringify(receipt),
    );
    await fs.writeFile(
      path.join(workspace, 'excerpts.json'),
      JSON.stringify({ book: { directory: book } }),
    );

    await expect(revalidateTrailerCommercialWorkspace(workspace)).resolves.toEqual(receipt);
    await fs.appendFile(path.join(directory, '01.md'), 'Changed.');
    await expect(revalidateTrailerCommercialWorkspace(workspace)).rejects.toThrow(
      /changed since approval/iu,
    );
  });
});
