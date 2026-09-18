import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { artifactToMarkdown, htmlFragmentToMarkdown } from '../src/renderer/utils/artifact-office-source';
import { docSectionsToMarkdown } from '../src/renderer/utils/doc-outline';
import { loadLocalImage } from '../src/main/office-export/images';
import {
  documentToSlides,
  FALLBACK_TITLE,
  parseMarkdownDocument,
} from '../src/main/office-export/markdown-model';
import { parseOfficeMarkdown, proposeOfficeExportPath } from '../src/main/office-export/export-office';
import { sanitizeXmlText, slugifyExportName } from '../src/main/office-export/sanitize';

const SAMPLE = [
  '# Rapport agent',
  '',
  'Intro avec du **gras** et du `code`.',
  '',
  '## Analyse',
  '',
  '- Premier point',
  '- Second point',
  '',
  '1. Étape A',
  '2. Étape B',
  '',
  '```ts',
  'const x = 1 < 2 && true;',
  '```',
  '',
  '| Col | Val |',
  '| --- | --- |',
  '| A | 1 |',
  '| B | 2 |',
  '',
  '![Schéma](./missing-diagram.png)',
  '',
  '> Citation pour les notes',
  '',
  '---',
  '',
  '# Deuxième partie',
  '',
  '* Point isolé',
].join('\n');

describe('parseMarkdownDocument', () => {
  it('maps headings, paragraphs, lists, fences, tables and images', () => {
    const doc = parseMarkdownDocument(SAMPLE);
    expect(doc.title).toBe('Rapport agent');
    expect(doc.blocks.filter((b) => b.type === 'heading').map((b) => (b.type === 'heading' ? b.text : ''))).toEqual([
      'Rapport agent',
      'Analyse',
      'Deuxième partie',
    ]);
    expect(doc.blocks.some((b) => b.type === 'list' && !b.ordered && b.items.includes('Premier point'))).toBe(true);
    expect(doc.blocks.some((b) => b.type === 'list' && b.ordered && b.items[0] === 'Étape A')).toBe(true);
    const code = doc.blocks.find((b) => b.type === 'code');
    expect(code).toMatchObject({ type: 'code', language: 'ts' });
    if (code?.type === 'code') expect(code.text).toContain('const x = 1 < 2');
    const table = doc.blocks.find((b) => b.type === 'table');
    expect(table).toMatchObject({ type: 'table', headers: ['Col', 'Val'] });
    if (table?.type === 'table') expect(table.rows).toEqual([
      ['A', '1'],
      ['B', '2'],
    ]);
    expect(doc.blocks.some((b) => b.type === 'image' && b.src === './missing-diagram.png')).toBe(true);
    expect(doc.blocks.some((b) => b.type === 'thematic_break')).toBe(true);
  });

  it('uses Sans titre when the heading is empty', () => {
    const doc = parseMarkdownDocument('#   \n\nUn paragraphe.');
    expect(doc.title).toBe(FALLBACK_TITLE);
    const heading = doc.blocks.find((b) => b.type === 'heading');
    expect(heading).toMatchObject({ type: 'heading', level: 1, text: '' });
  });

  it('keeps raw < and & for the renderer to escape', () => {
    const doc = parseMarkdownDocument('# Titre\n\n<script>alert(1)</script> & cie');
    const para = doc.blocks.find((b) => b.type === 'paragraph');
    expect(para).toMatchObject({ type: 'paragraph', text: '<script>alert(1)</script> & cie' });
  });
});

describe('parseOfficeMarkdown', () => {
  it('preserves detected heading title over external session title', () => {
    const doc = parseOfficeMarkdown('# Rapport Synthétique\n\nContenu.', 'Session 1');
    expect(doc.title).toBe('Rapport Synthétique');
  });

  it('uses external title when markdown has no heading', () => {
    const doc = parseOfficeMarkdown('Contenu sans titre direct.', 'Plan stratégique');
    expect(doc.title).toBe('Plan stratégique');
  });

  it('uses external title when heading in markdown is empty', () => {
    const doc = parseOfficeMarkdown('#   \n\nContenu.', 'Titre de secours');
    expect(doc.title).toBe('Titre de secours');
  });

  it('defaults to Sans titre when neither markdown heading nor external title is present', () => {
    const doc = parseOfficeMarkdown('Juste du texte');
    expect(doc.title).toBe('Sans titre');
  });
});

describe('documentToSlides', () => {
  it('splits on H1 and --- and lifts quotes into speaker notes', () => {
    const slides = documentToSlides(parseMarkdownDocument(SAMPLE));
    expect(slides).toHaveLength(2);
    expect(slides[0]?.title).toBe('Rapport agent');
    expect(slides[0]?.bullets).toEqual(expect.arrayContaining(['Premier point', 'Second point', 'Étape A']));
    expect(slides[0]?.notes).toContain('Citation pour les notes');
    expect(slides[0]?.bullets.join(' ')).not.toMatch(/\*\*/);
    expect(slides[0]?.image?.src).toBe('./missing-diagram.png');
    expect(slides[1]?.title).toBe('Deuxième partie');
    expect(slides[1]?.bullets).toContain('Point isolé');
  });

  it('titles an empty H1 slide with Sans titre', () => {
    const slides = documentToSlides(parseMarkdownDocument('#\n\n- a\n\n---\n\n#  \n\n- b'));
    expect(slides.map((s) => s.title)).toEqual([FALLBACK_TITLE, FALLBACK_TITLE]);
  });

  it('produces one slide per section for a multi-section outline', () => {
    const md = docSectionsToMarkdown('Mon Document', [
      { id: '1', title: 'Section 1', summary: 'Summary 1' },
      { id: '2', title: 'Section 2', summary: 'Summary 2' },
      { id: '3', title: 'Section 3', summary: 'Summary 3' },
    ]);
    const doc = parseMarkdownDocument(md);
    const slides = documentToSlides(doc);
    expect(slides).toHaveLength(4); // 1 title slide + 3 section slides
    expect(slides[0]?.title).toBe('Mon Document');
    expect(slides[0]?.bullets).toEqual([]);
    expect(slides[1]?.title).toBe('Section 1');
    expect(slides[1]?.bullets).toEqual(['Summary 1']);
    expect(slides[2]?.title).toBe('Section 2');
    expect(slides[2]?.bullets).toEqual(['Summary 2']);
    expect(slides[3]?.title).toBe('Section 3');
    expect(slides[3]?.bullets).toEqual(['Summary 3']);
  });

  it('announces bullet truncation in warnings when a slide exceeds 10 bullets', () => {
    const warnings: string[] = [];
    const manyBullets = Array.from({ length: 14 }, (_, i) => `- Point ${i + 1}`).join('\n');
    const doc = parseMarkdownDocument(`# Diapo Chargée\n\n${manyBullets}`);
    const slides = documentToSlides(doc, warnings);
    expect(slides[0]?.bullets).toHaveLength(10);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Diapo Chargée');
    expect(warnings[0]).toContain('10');
    expect(warnings[0]).toContain('4 élément(s) tronqué(s)');
  });
});

describe('slugifyExportName', () => {
  it('preserves Chinese titles without emptying or mutilating them', () => {
    expect(slugifyExportName('项目总结')).toBe('项目总结');
    expect(slugifyExportName('2026年 项目总结：最终版')).toBe('2026年-项目总结-最终版');
  });

  it('preserves Cyrillic titles without mutilating them', () => {
    expect(slugifyExportName('Отчет о работе')).toBe('Отчет-о-работе');
    expect(slugifyExportName('План проекта 2026')).toBe('План-проекта-2026');
  });

  it('normalizes accented Latin titles cleanly', () => {
    expect(slugifyExportName('Rapport marché IA')).toBe('Rapport-marche-IA');
    expect(slugifyExportName('Événement été & café')).toBe('Evenement-ete-cafe');
  });

  it('falls back to default when title consists only of invalid characters', () => {
    expect(slugifyExportName('   ***   ')).toBe('export');
  });
});

describe('sanitizeXmlText', () => {
  it('strips illegal XML control characters', () => {
    expect(sanitizeXmlText('ok\u0000fin')).toBe('okfin');
  });
});

describe('loadLocalImage', () => {
  it('warns on a missing file and never fetches http', () => {
    expect(loadLocalImage('./no-such.png', tmpdir()).warning).toMatch(/Image manquante/);
    expect(loadLocalImage('https://example.test/x.png', tmpdir()).warning).toMatch(/aucun réseau/);
  });
});

describe('proposeOfficeExportPath', () => {
  it('proposes the session exports folder', () => {
    expect(
      proposeOfficeExportPath({
        sessionCwd: '/tmp/session-cwd',
        userDataDir: '/tmp/user-data',
        title: 'Rapport marché IA',
        format: 'docx',
      })
    ).toBe(join('/tmp/session-cwd', 'exports', 'Rapport-marche-IA.docx'));
  });

  it('proposes paths preserving Chinese and Cyrillic titles', () => {
    expect(
      proposeOfficeExportPath({
        sessionCwd: '/tmp/session-cwd',
        userDataDir: '/tmp/user-data',
        title: '项目总结',
        format: 'pptx',
      })
    ).toBe(join('/tmp/session-cwd', 'exports', '项目总结.pptx'));

    expect(
      proposeOfficeExportPath({
        sessionCwd: '/tmp/session-cwd',
        userDataDir: '/tmp/user-data',
        title: 'Отчет',
        format: 'docx',
      })
    ).toBe(join('/tmp/session-cwd', 'exports', 'Отчет.docx'));
  });
});

describe('artifactToMarkdown', () => {
  it('rebuilds a report and strips HTML tags', () => {
    const report = artifactToMarkdown({
      kind: 'report',
      source: 'ignored',
      report: {
        title: 'T',
        body: '# T\n\nHello',
        sources: [{ n: 1, label: 'Src', url: 'https://example.test' }],
      },
    });
    expect(report).toContain('## Références');
    expect(htmlFragmentToMarkdown('<h1>Hi</h1><p>Bonjour <b>toi</b></p>')).toContain('# Hi');
  });
});

describe('docSectionsToMarkdown', () => {
  it('emits H1 then H2 sections', () => {
    const md = docSectionsToMarkdown('Mon doc', [
      { id: 'a', title: 'Intro', summary: 'Texte **utile**.' },
    ]);
    expect(md).toContain('# Mon doc');
    expect(md).toContain('## Intro');
  });
});

describe('PNG data URI', () => {
  it('loads an inlined image without touching the network', () => {
    const dir = join(tmpdir(), 'cb-office-export-img');
    mkdirSync(dir, { recursive: true });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    writeFileSync(join(dir, 'dot.png'), png);
    const fromFile = loadLocalImage('dot.png', dir);
    expect(fromFile.image?.type).toBe('png');
    expect(fromFile.image?.width).toBe(1);
    const fromData = loadLocalImage(`data:image/png;base64,${png.toString('base64')}`, dir);
    expect(fromData.image?.type).toBe('png');
  });
});
