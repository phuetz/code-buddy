import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { writeOfficeExport } from '../src/main/office-export/export-office';
import { docSectionsToMarkdown } from '../src/renderer/utils/doc-outline';

function zipList(filePath: string): string[] {
  return execFileSync('unzip', ['-Z1', filePath], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function zipCat(filePath: string, entry: string): string {
  return execFileSync('unzip', ['-p', filePath, entry], { encoding: 'utf8' });
}

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('writeOfficeExport', () => {
  it('writes a docx with headings, code, table and escaped text', async () => {
    const dir = join(tmpdir(), `cb-office-docx-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'dot.png'), PNG_1x1);
    const outputPath = join(dir, 'rapport.docx');
    const result = await writeOfficeExport({
      markdown: [
        '# Rapport',
        '',
        'Danger <script>alert(1)</script> & cie.',
        '',
        '```js',
        'const n = 1;',
        '```',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        '![Point](dot.png)',
        '',
        '![Absent](./nope.png)',
      ].join('\n'),
      title: 'Rapport',
      format: 'docx',
      outputPath,
      baseDir: dir,
    });
    expect(result.success).toBe(true);
    expect(result.warnings.some((w) => w.includes('nope.png'))).toBe(true);
    const names = zipList(outputPath);
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('word/document.xml');
    const xml = zipCat(outputPath, 'word/document.xml');
    expect(xml).toContain('w:document');
    expect(xml).toContain('&lt;script&gt;');
    expect(xml).not.toContain('<script>alert');
    expect(xml).toMatch(/Courier New|CourierNew/);
    expect(xml).toContain('w:tbl');
    expect(xml).toContain('a:blip');
    expect(xml).toMatch(/Image manquante/);
  });

  it('writes a pptx with one slide per H1 and speaker notes', async () => {
    const dir = join(tmpdir(), `cb-office-pptx-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const outputPath = join(dir, 'deck.pptx');
    const result = await writeOfficeExport({
      markdown: [
        '# Alpha',
        '',
        '- Un',
        '- Deux',
        '',
        '> Note du présentateur',
        '',
        '---',
        '',
        '# Beta',
        '',
        'Paragraphe.',
      ].join('\n'),
      format: 'pptx',
      outputPath,
      baseDir: dir,
    });
    expect(result.success).toBe(true);
    expect(result.slideCount).toBe(2);
    const names = zipList(outputPath);
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('ppt/presentation.xml');
    expect(names).toContain('ppt/slides/slide1.xml');
    expect(names).toContain('ppt/slides/slide2.xml');
    const notes = names.filter((name) => name.includes('notesSlide') && name.endsWith('.xml'));
    expect(notes.length).toBeGreaterThan(0);
    const notesXml = zipCat(outputPath, notes[0]!);
    expect(notesXml).toContain('Note du présentateur');
  });

  it('produces one slide per section for a multi-section outline', async () => {
    const dir = join(tmpdir(), `cb-office-pptx-outline-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const outputPath = join(dir, 'deck-outline.pptx');
    const md = docSectionsToMarkdown('Présentation Stratégique', [
      { id: '1', title: 'Partie 1', summary: 'Détails partie 1' },
      { id: '2', title: 'Partie 2', summary: 'Détails partie 2' },
      { id: '3', title: 'Partie 3', summary: 'Détails partie 3' },
    ]);
    const result = await writeOfficeExport({
      markdown: md,
      format: 'pptx',
      outputPath,
      baseDir: dir,
    });
    expect(result.success).toBe(true);
    expect(result.slideCount).toBe(4); // 1 title slide + 3 section slides
    const names = zipList(outputPath);
    expect(names).toContain('ppt/slides/slide1.xml');
    expect(names).toContain('ppt/slides/slide2.xml');
    expect(names).toContain('ppt/slides/slide3.xml');
    expect(names).toContain('ppt/slides/slide4.xml');
  });

  it('reports a warning in the export result when a slide exceeds 10 bullets', async () => {
    const dir = join(tmpdir(), `cb-office-pptx-warn-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const outputPath = join(dir, 'deck-overflow.pptx');
    const manyBullets = Array.from({ length: 13 }, (_, i) => `- Item ${i + 1}`).join('\n');
    const result = await writeOfficeExport({
      markdown: `# Diapo Surchargée\n\n${manyBullets}`,
      format: 'pptx',
      outputPath,
      baseDir: dir,
    });
    expect(result.success).toBe(true);
    expect(result.slideCount).toBe(1);
    expect(result.warnings.some((w) => w.includes('Diapo Surchargée') && w.includes('tronqué'))).toBe(true);
  });

  it('rejects a mismatched extension', async () => {
    const result = await writeOfficeExport({
      markdown: '# A',
      format: 'docx',
      outputPath: join(tmpdir(), 'nope.txt'),
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/\.docx/);
  });
});
