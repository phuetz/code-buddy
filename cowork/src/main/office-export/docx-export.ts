/**
 * Render a Markdown model to a .docx file with the `docx` package (MIT).
 *
 * @module main/office-export/docx-export
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
} from 'docx';
import { loadLocalImage, fitImageBox } from './images';
import { FALLBACK_TITLE, type MdBlock, type MdDocument } from './markdown-model';
import { sanitizeXmlText } from './sanitize';

const CONTENT_WIDTH = 9026;
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const CELL_BORDERS = {
  top: CELL_BORDER,
  bottom: CELL_BORDER,
  left: CELL_BORDER,
  right: CELL_BORDER,
};

export interface DocxExportResult {
  warnings: string[];
}

type InlineRun = { text: string; bold?: boolean; italics?: boolean; code?: boolean };

function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      runs.push({ text: text.slice(last, match.index) });
    }
    const token = match[0] ?? '';
    if (token.startsWith('`')) {
      runs.push({ text: token.slice(1, -1), code: true });
    } else if (token.startsWith('**') || token.startsWith('__')) {
      runs.push({ text: token.slice(2, -2), bold: true });
    } else {
      runs.push({ text: token.slice(1, -1), italics: true });
    }
    last = match.index + token.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length > 0 ? runs : [{ text }];
}

function toRuns(text: string, extra?: { bold?: boolean }): TextRun[] {
  return parseInline(text).map(
    (run) =>
      new TextRun({
        text: sanitizeXmlText(run.text),
        bold: extra?.bold || run.bold,
        italics: run.italics,
        font: run.code ? 'Courier New' : 'Arial',
        size: run.code ? 20 : 22,
      })
  );
}

function headingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  if (level <= 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  if (level === 3) return HeadingLevel.HEADING_3;
  if (level === 4) return HeadingLevel.HEADING_4;
  if (level === 5) return HeadingLevel.HEADING_5;
  return HeadingLevel.HEADING_6;
}

function buildTable(headers: string[], rows: string[][]): Table {
  const columnCount = Math.max(1, headers.length, ...rows.map((row) => row.length));
  const columnWidth = Math.floor(CONTENT_WIDTH / columnCount);
  const columnWidths = Array.from({ length: columnCount }, () => columnWidth);
  const allRows = [headers, ...rows];

  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths,
    rows: allRows.map(
      (row, rowIndex) =>
        new TableRow({
          children: Array.from({ length: columnCount }, (_, col) => {
            const cell = row[col] ?? '';
            return new TableCell({
              borders: CELL_BORDERS,
              width: { size: columnWidth, type: WidthType.DXA },
              shading:
                rowIndex === 0
                  ? { fill: 'E8EEF4', type: ShadingType.CLEAR }
                  : undefined,
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [
                new Paragraph({
                  children: toRuns(cell, { bold: rowIndex === 0 }),
                }),
              ],
            });
          }),
        })
    ),
  });
}

async function blockToChildren(
  block: MdBlock,
  baseDir: string,
  warnings: string[]
): Promise<Array<Paragraph | Table>> {
  if (block.type === 'heading') {
    const text = block.text.trim() || FALLBACK_TITLE;
    return [
      new Paragraph({
        heading: headingLevel(block.level),
        spacing: { before: 240, after: 120 },
        children: [new TextRun({ text: sanitizeXmlText(text), bold: true, font: 'Arial' })],
      }),
    ];
  }

  if (block.type === 'paragraph') {
    return [
      new Paragraph({
        spacing: { after: 160 },
        children: toRuns(block.text),
      }),
    ];
  }

  if (block.type === 'list') {
    const reference = block.ordered ? 'office-export-numbers' : 'office-export-bullets';
    return block.items.map(
      (item) =>
        new Paragraph({
          numbering: { reference, level: 0 },
          children: toRuns(item),
        } satisfies IParagraphOptions)
    );
  }

  if (block.type === 'code') {
    const lines = block.text.length > 0 ? block.text.split('\n') : [''];
    return lines.map(
      (line, index) =>
        new Paragraph({
          shading: { type: ShadingType.CLEAR, fill: 'F4F4F5' },
          spacing: { before: index === 0 ? 120 : 0, after: index === lines.length - 1 ? 160 : 0 },
          children: [
            new TextRun({
              text: sanitizeXmlText(line.length > 0 ? line : ' '),
              font: 'Courier New',
              size: 18,
            }),
          ],
        })
    );
  }

  if (block.type === 'table') {
    return [buildTable(block.headers, block.rows)];
  }

  if (block.type === 'blockquote') {
    return [
      new Paragraph({
        indent: { left: 360 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: '94A3B8', space: 8 } },
        spacing: { after: 160 },
        children: [
          new TextRun({
            text: sanitizeXmlText(block.text),
            italics: true,
            color: '475569',
            font: 'Arial',
          }),
        ],
      }),
    ];
  }

  if (block.type === 'image') {
    const loaded = loadLocalImage(block.src, baseDir);
    if (loaded.warning) warnings.push(loaded.warning);
    if (!loaded.image) {
      return [
        new Paragraph({
          spacing: { after: 160 },
          children: [
            new TextRun({
              text: sanitizeXmlText(`[Image manquante : ${block.alt || block.src}]`),
              italics: true,
              color: '666666',
            }),
          ],
        }),
      ];
    }
    const box = fitImageBox(loaded.image);
    const name = sanitizeXmlText(block.alt || path.basename(loaded.image.resolvedPath ?? 'image'));
    const children: Paragraph[] = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 80 },
        children: [
          new ImageRun({
            type: loaded.image.type,
            data: loaded.image.data,
            transformation: { width: box.width, height: box.height },
            altText: { name, title: name, description: name },
          }),
        ],
      }),
    ];
    if (block.alt) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 160 },
          children: [
            new TextRun({
              text: sanitizeXmlText(block.alt),
              italics: true,
              color: '666666',
              size: 18,
            }),
          ],
        })
      );
    }
    return children;
  }

  return [];
}

export async function writeDocxFile(
  docModel: MdDocument,
  outputPath: string,
  baseDir: string
): Promise<DocxExportResult> {
  const warnings: string[] = [];
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
      children: [
        new TextRun({
          text: sanitizeXmlText(docModel.title || FALLBACK_TITLE),
          bold: true,
          font: 'Arial',
          size: 48,
        }),
      ],
    }),
  ];

  for (const block of docModel.blocks) {
    if (block.type === 'thematic_break') continue;
    if (block.type === 'heading' && block.level === 1 && block.text.trim() === docModel.title) {
      continue;
    }
    children.push(...(await blockToChildren(block, baseDir, warnings)));
  }

  if (children.length === 1) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: 'Document sans contenu.', italics: true })],
      })
    );
  }

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 22 } } },
    },
    numbering: {
      config: [
        {
          reference: 'office-export-bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
        {
          reference: 'office-export-numbers',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  return { warnings };
}
