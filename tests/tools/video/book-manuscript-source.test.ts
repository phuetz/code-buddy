import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  extractCandidateExcerpts,
  loadBookManuscript,
} from '../../../src/tools/video/book-manuscript-source.js';

const temporaryDirectories: string[] = [];

async function temporaryBook(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'book-manuscript-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe('loadBookManuscript', () => {
  it('loads Markdown chapters in natural order and prefers a frontmatter title', async () => {
    const directory = await temporaryBook();
    await fs.writeFile(path.join(directory, 'chapter-10.md'), '# La fin\n\nLa pluie frappe la vitre.\n');
    await fs.writeFile(path.join(directory, 'chapter-2.md'), '# Le seuil\n\nMara ouvre la porte.\n');
    await fs.writeFile(
      path.join(directory, 'chapter-1.md'),
      '---\ntitle: "Les Veilleurs"\n---\n# Commencement\n\nLa maison demeure silencieuse.\n',
    );
    await fs.writeFile(path.join(directory, 'cover.webp'), 'cover');

    const manuscript = await loadBookManuscript(directory);

    expect(manuscript.title).toBe('Les Veilleurs');
    expect(manuscript.chapters.map((chapter) => chapter.file)).toEqual([
      'chapter-1.md',
      'chapter-2.md',
      'chapter-10.md',
    ]);
    expect(manuscript.chapters.map((chapter) => chapter.heading)).toEqual([
      'Commencement',
      'Le seuil',
      'La fin',
    ]);
    expect(manuscript.coverPath).toBe(path.join(directory, 'cover.webp'));
  });

  it('rejects an empty directory and one without Markdown', async () => {
    const empty = await temporaryBook();
    await expect(loadBookManuscript(empty)).rejects.toThrow(/empty/i);

    const withoutMarkdown = await temporaryBook();
    await fs.writeFile(path.join(withoutMarkdown, 'notes.txt'), 'notes');
    await expect(loadBookManuscript(withoutMarkdown)).rejects.toThrow(/no Markdown/i);
  });

  it('fails closed before reading a chapter beyond the configured limit', async () => {
    const directory = await temporaryBook();
    await fs.writeFile(path.join(directory, '01.md'), '# Livre\n\n' + 'x'.repeat(128));

    await expect(loadBookManuscript(directory, { maxBytesPerFile: 32 })).rejects.toThrow(
      /32-byte limit/i,
    );
  });
});

describe('extractCandidateExcerpts', () => {
  it('selects visual/tension passages with exact chapter and line provenance', async () => {
    const directory = await temporaryBook();
    await fs.writeFile(
      path.join(directory, '01-arrivee.md'),
      '# Arrivée\n\nLe jardin semblait paisible.\n\n— Ferme la porte ! crie Mara. Une ombre court derrière la fenêtre. Le couteau tombe sur le sol.\n',
    );
    await fs.writeFile(
      path.join(directory, '02-nuit.md'),
      '# Nuit\n\nLa pluie frappe la maison. Elias découvre une lettre couverte de sang.\n',
    );
    const manuscript = await loadBookManuscript(directory);

    const excerpts = extractCandidateExcerpts(manuscript, { limit: 3 });
    const dialogue = excerpts.find((excerpt) => excerpt.text.startsWith('— Ferme'));

    expect(dialogue).toMatchObject({
      chapterIndex: 0,
      lineStart: 5,
      lineEnd: 5,
      manuscriptSource: {
        file: '01-arrivee.md',
        locator: 'chapter:1;lines:5-5',
      },
    });
    expect(dialogue?.text).toContain('Une ombre court derrière la fenêtre.');
  });

  it('is deterministic for the same manuscript and options', async () => {
    const directory = await temporaryBook();
    await fs.writeFile(
      path.join(directory, 'book.md'),
      '# La chambre\n\nNora ouvre la fenêtre. Le feu gagne la maison.\n\n— Cours ! hurle Elias dans la nuit.\n',
    );
    const manuscript = await loadBookManuscript(directory);

    expect(extractCandidateExcerpts(manuscript)).toEqual(extractCandidateExcerpts(manuscript));
  });
});
