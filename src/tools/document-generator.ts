/**
 * Document Generator Tool — Pure TypeScript
 *
 * Generates professional documents (PPTX, DOCX, XLSX, PDF)
 * using native JS libraries — no Python dependency.
 *
 * - PPTX: pptxgenjs
 * - DOCX: docx (npm)
 * - XLSX: xlsx (SheetJS) — already a project dependency
 * - PDF:  pdfkit
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import type { ToolResult } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

export type DocumentType = 'pptx' | 'docx' | 'xlsx' | 'pdf';

export interface DocumentGeneratorInput {
  type: DocumentType;
  title: string;
  content: string;
  outputPath: string;
  theme?: 'professional' | 'minimal' | 'dark';
}

export interface DocumentResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  embeddedImages?: GeneratedDocumentImage[];
}

export interface DocxValidationEvidence {
  relationshipCount: number;
  embeddedRelationshipCount: number;
  mediaFileCount: number;
}

export interface MarkdownSection {
  heading: string;
  level: number;
  body: string[];
}

export interface GeneratedDocumentImage {
  path: string;
  caption?: string;
  width: number;
  height: number;
}

function expectedExtensionForType(type: DocumentType): string {
  return `.${type}`;
}

// ============================================================================
// Markdown Parser
// ============================================================================

export function parseMarkdownSections(content: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;

  for (const line of content.split('\n')) {
    const h1 = line.match(/^# (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h3 = line.match(/^### (.+)/);

    if (h1 || h2 || h3) {
      if (current) sections.push(current);
      const match = (h1 || h2 || h3)!;
      current = { heading: match[1].trim(), level: h1 ? 1 : h2 ? 2 : 3, body: [] };
    } else if (current) {
      current.body.push(line);
    } else {
      current = { heading: '', level: 0, body: [line] };
    }
  }
  if (current) sections.push(current);
  return sections;
}

function parseTableRows(content: string): string[][] {
  const rows: string[][] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || /^\|?-+[\s|:-]*$/.test(trimmed)) continue;
    if (trimmed.startsWith('|')) {
      rows.push(trimmed.split('|').filter(c => c.trim()).map(c => c.trim()));
    } else if (trimmed.includes(',')) {
      rows.push(trimmed.split(',').map(c => c.trim()));
    }
  }
  return rows;
}

function isMarkdownTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.includes('|', 1);
}

function isTabTableLine(line: string): boolean {
  return line.split('\t').filter(cell => cell.trim()).length > 1;
}

function isTableSeparatorLine(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function isDocxTableBlockLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === '[Table]' || isMarkdownTableLine(trimmed) || isTabTableLine(line) || isTableSeparatorLine(trimmed);
}

function parseDocxTableBlock(lines: string[]): string[][] {
  return lines
    .map(line => line.trim())
    .filter(line => line && line !== '[Table]' && !isTableSeparatorLine(line))
    .map(line => {
      if (line.includes('\t')) {
        return line.split('\t').map(cell => cell.trim()).filter(Boolean);
      }
      return line.split('|').map(cell => cell.trim()).filter(Boolean);
    })
    .filter(row => row.length > 1);
}

function isEmbeddedImageMarker(line: string): boolean {
  return /^\[Embedded image(?:: .+)?\]$/.test(line.trim());
}

function isInvalidXmlCharacter(char: string): boolean {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return false;
  }

  return (
    (codePoint >= 0x00 && codePoint <= 0x08) ||
    codePoint === 0x0b ||
    codePoint === 0x0c ||
    (codePoint >= 0x0e && codePoint <= 0x1f) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0xfffe ||
    codePoint === 0xffff
  );
}

function sanitizeDocxText(value: string): string {
  let sanitized = '';
  for (const char of value) {
    if (!isInvalidXmlCharacter(char)) {
      sanitized += char;
    }
  }
  return sanitized;
}

function formatCodePoint(char: string): string {
  const codePoint = char.codePointAt(0) ?? 0;
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

type LocalImageReference = {
  altText: string;
  imagePath: string;
};

type DocxImageType = 'png' | 'jpg' | 'gif' | 'bmp';

type ImageDimensions = {
  width: number;
  height: number;
};

const DEFAULT_DOCX_IMAGE_TRANSFORMATION = {
  width: 520,
  height: 320,
};

const DOCX_IMAGE_MAX_WIDTH = 520;
const DOCX_IMAGE_MAX_HEIGHT = 360;

function parseLocalImageReference(line: string): LocalImageReference | null {
  const trimmed = line.trim();
  const markdownImage = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (markdownImage) {
    return {
      altText: markdownImage[1].trim(),
      imagePath: markdownImage[2].trim(),
    };
  }

  const bracketImage = trimmed.match(/^\[Image:\s*(.+?)\]$/i);
  if (bracketImage) {
    return {
      altText: '',
      imagePath: bracketImage[1].trim(),
    };
  }

  return null;
}

function getDocxImageType(imagePath: string): DocxImageType | null {
  const ext = path.extname(imagePath).toLowerCase().replace(/^\./, '');
  if (ext === 'jpeg') return 'jpg';
  if (['png', 'jpg', 'gif', 'bmp'].includes(ext)) {
    return ext as DocxImageType;
  }
  return null;
}

function resolveLocalImagePath(imagePath: string, outputPath: string): string | null {
  if (/^https?:\/\//i.test(imagePath) || /^data:/i.test(imagePath)) {
    return null;
  }

  const unquoted = imagePath.replace(/^["']|["']$/g, '');
  const candidates = path.isAbsolute(unquoted)
    ? [unquoted]
    : [
        path.resolve(path.dirname(outputPath), unquoted),
        path.resolve(process.cwd(), unquoted),
      ];

  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function readPngDimensions(data: Buffer): ImageDimensions | null {
  if (data.length < 24 || data.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    return null;
  }

  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

function readGifDimensions(data: Buffer): ImageDimensions | null {
  const signature = data.toString('ascii', 0, 6);
  if (data.length < 10 || (signature !== 'GIF87a' && signature !== 'GIF89a')) {
    return null;
  }

  return {
    width: data.readUInt16LE(6),
    height: data.readUInt16LE(8),
  };
}

function readBmpDimensions(data: Buffer): ImageDimensions | null {
  if (data.length < 26 || data.toString('ascii', 0, 2) !== 'BM') {
    return null;
  }

  return {
    width: Math.abs(data.readInt32LE(18)),
    height: Math.abs(data.readInt32LE(22)),
  };
}

function readJpegDimensions(data: Buffer): ImageDimensions | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = data[offset + 1];
    offset += 2;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (offset + 2 > data.length) {
      break;
    }

    const segmentLength = data.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > data.length) {
      break;
    }

    const isStartOfFrame = (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    );
    if (isStartOfFrame && offset + 7 <= data.length) {
      return {
        height: data.readUInt16BE(offset + 3),
        width: data.readUInt16BE(offset + 5),
      };
    }

    offset += segmentLength;
  }

  return null;
}

function readImageDimensions(data: Buffer, type: DocxImageType): ImageDimensions | null {
  switch (type) {
    case 'png':
      return readPngDimensions(data);
    case 'gif':
      return readGifDimensions(data);
    case 'bmp':
      return readBmpDimensions(data);
    case 'jpg':
      return readJpegDimensions(data);
  }
}

function fitImageToDocxBox(dimensions: ImageDimensions | null): ImageDimensions {
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return DEFAULT_DOCX_IMAGE_TRANSFORMATION;
  }

  const scale = Math.min(
    1,
    DOCX_IMAGE_MAX_WIDTH / dimensions.width,
    DOCX_IMAGE_MAX_HEIGHT / dimensions.height
  );

  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  };
}

function extractRelationshipTargets(relsXml: string): Map<string, string> {
  const relationships = new Map<string, string>();
  const relationshipTags = relsXml.match(/<Relationship\b[^>]*>/g) ?? [];

  for (const tag of relationshipTags) {
    const id = tag.match(/\bId="([^"]+)"/)?.[1];
    const target = tag.match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) {
      relationships.set(id, target);
    }
  }

  return relationships;
}

async function validateDocxPackage(outputPath: string): Promise<DocxValidationEvidence> {
  const { default: AdmZip } = await import('adm-zip');
  const zip = new AdmZip(outputPath);
  const entries = new Set(zip.getEntries().map(entry => entry.entryName));

  for (const requiredEntry of ['[Content_Types].xml', 'word/document.xml', 'word/_rels/document.xml.rels']) {
    if (!entries.has(requiredEntry)) {
      throw new Error(`Generated DOCX missing ${requiredEntry}`);
    }
  }

  const documentXml = zip.readAsText('word/document.xml');
  const relsXml = zip.readAsText('word/_rels/document.xml.rels');
  const invalidDocumentXmlChar = Array.from(documentXml).find(isInvalidXmlCharacter);
  if (invalidDocumentXmlChar) {
    throw new Error(
      `Generated DOCX document.xml contains XML-invalid character ${formatCodePoint(invalidDocumentXmlChar)}`
    );
  }

  const relationshipTargets = extractRelationshipTargets(relsXml);
  const embeddedRelationshipIds = Array.from(
    documentXml.matchAll(/\br:embed="([^"]+)"/g),
    match => match[1]
  );

  for (const relationshipId of embeddedRelationshipIds) {
    const target = relationshipTargets.get(relationshipId);
    if (!target) {
      throw new Error(`Generated DOCX image relationship is missing: ${relationshipId}`);
    }

    const targetEntry = target.startsWith('word/') ? target : `word/${target}`;
    if (!entries.has(targetEntry)) {
      throw new Error(`Generated DOCX image target is missing: ${targetEntry}`);
    }
  }

  return {
    relationshipCount: relationshipTargets.size,
    embeddedRelationshipCount: embeddedRelationshipIds.length,
    mediaFileCount: Array.from(entries).filter(entry => entry.startsWith('word/media/')).length,
  };
}

// ============================================================================
// PPTX Generator (pptxgenjs)
// ============================================================================

async function generatePptx(title: string, sections: MarkdownSection[], outputPath: string, theme?: string): Promise<void> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();

  const colors = theme === 'dark'
    ? { bg: '1a1a2e', text: 'ffffff', accent: '4cc9f0' }
    : theme === 'minimal'
      ? { bg: 'ffffff', text: '333333', accent: '666666' }
      : { bg: 'ffffff', text: '2d3436', accent: '0984e3' };

  // Title slide
  const titleSlide = pptx.addSlide();
  titleSlide.background = { fill: colors.bg };
  titleSlide.addText(title, {
    x: 0.5, y: 1.5, w: 9, h: 2,
    fontSize: 36, bold: true, color: colors.accent, align: 'center',
  });

  // Content slides
  for (const section of sections) {
    if (!section.heading && section.body.every(l => !l.trim())) continue;

    const slide = pptx.addSlide();
    slide.background = { fill: colors.bg };

    if (section.heading) {
      slide.addText(section.heading, {
        x: 0.5, y: 0.3, w: 9, h: 0.8,
        fontSize: 24, bold: true, color: colors.accent,
      });
    }

    const bullets = section.body.filter(l => l.trim()).map(l => {
      const trimmed = l.trim();
      const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
      return { text: isBullet ? trimmed.slice(2) : trimmed, options: { bullet: isBullet, fontSize: 16, color: colors.text } };
    });

    if (bullets.length > 0) {
      slide.addText(bullets, { x: 0.5, y: 1.3, w: 9, h: 4, valign: 'top' });
    }
  }

  await pptx.writeFile({ fileName: outputPath });
}

// ============================================================================
// DOCX Generator (docx npm package)
// ============================================================================

async function generateDocx(
  title: string,
  sections: MarkdownSection[],
  outputPath: string
): Promise<GeneratedDocumentImage[]> {
  const docx = await import('docx');
  const {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    ImageRun,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
  } = docx;

  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];
  const embeddedImages: GeneratedDocumentImage[] = [];

  const buildParagraphs = (line: string): InstanceType<typeof Paragraph>[] => {
    const rawTrimmed = line.trim();
    const trimmed = sanitizeDocxText(rawTrimmed);
    const imageReference = parseLocalImageReference(rawTrimmed);

    if (imageReference) {
      const resolvedImagePath = resolveLocalImagePath(imageReference.imagePath, outputPath);
      const imageType = resolvedImagePath ? getDocxImageType(resolvedImagePath) : null;
      if (resolvedImagePath && imageType) {
        const imageName = sanitizeDocxText(imageReference.altText || path.basename(resolvedImagePath));
        const imageData = fs.readFileSync(resolvedImagePath);
        const transformation = fitImageToDocxBox(readImageDimensions(imageData, imageType));
        embeddedImages.push({
          path: resolvedImagePath,
          caption: imageReference.altText ? sanitizeDocxText(imageReference.altText) : undefined,
          width: transformation.width,
          height: transformation.height,
        });
        const paragraphs = [new Paragraph({
          children: [
            new ImageRun({
              data: imageData,
              type: imageType,
              transformation,
              altText: {
                name: imageName,
                title: imageName,
                description: imageName,
              },
            }),
          ],
          spacing: { before: 120, after: 120 },
        })];

        if (imageReference.altText) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({
              text: `Figure - ${sanitizeDocxText(imageReference.altText)}`,
              italics: true,
              color: '666666',
              size: 20,
            })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 160 },
          }));
        }

        return paragraphs;
      }

      return [new Paragraph({
        children: [new TextRun({ text: trimmed, italics: true, color: '666666' })],
        spacing: { before: 80, after: 80 },
      })];
    }

    if (isEmbeddedImageMarker(trimmed)) {
      return [new Paragraph({
        children: [new TextRun({ text: trimmed, italics: true, color: '666666' })],
        spacing: { before: 80, after: 80 },
      })];
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      return [new Paragraph({
        children: [new TextRun({ text: trimmed.slice(2) })],
        bullet: { level: 0 },
      })];
    }

    return [new Paragraph({
      children: [new TextRun({ text: trimmed })],
    })];
  };

  const buildTable = (rows: string[][]): InstanceType<typeof Table> => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, rowIndex) => new TableRow({
      children: row.map(cell => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text: sanitizeDocxText(cell), bold: rowIndex === 0 })],
        })],
        margins: { top: 120, bottom: 120, left: 120, right: 120 },
      })),
    })),
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
    },
  });

  // Title
  children.push(new Paragraph({
    children: [new TextRun({ text: sanitizeDocxText(title), bold: true, size: 48 })],
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  }));

  for (const section of sections) {
    if (section.heading) {
      const heading = section.level <= 1 ? HeadingLevel.HEADING_1
        : section.level === 2 ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3;
      children.push(new Paragraph({
        children: [new TextRun({ text: sanitizeDocxText(section.heading), bold: true })],
        heading,
        spacing: { before: 200, after: 100 },
      }));
    }

    for (let i = 0; i < section.body.length; i++) {
      const line = section.body[i];
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (isDocxTableBlockLine(line)) {
        const tableLines: string[] = [];
        while (i < section.body.length && isDocxTableBlockLine(section.body[i])) {
          tableLines.push(section.body[i]);
          i++;
        }
        i--;

        const tableRows = parseDocxTableBlock(tableLines);
        if (tableRows.length > 0) {
          if (tableLines.some(tableLine => tableLine.trim() === '[Table]')) {
            children.push(new Paragraph({
              children: [new TextRun({ text: 'Tableau extrait du document source', italics: true, color: '666666' })],
              spacing: { before: 120, after: 80 },
            }));
          }
          children.push(buildTable(tableRows));
          continue;
        }
      }

      children.push(...buildParagraphs(trimmed));
    }
  }

  if (children.length === 1) {
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Document generated without body content.', italics: true })],
    }));
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return embeddedImages;
}

// ============================================================================
// XLSX Generator (SheetJS — already installed)
// ============================================================================

async function generateXlsx(title: string, content: string, outputPath: string): Promise<number> {
  const XLSX = await import('xlsx');
  const rows = parseTableRows(content);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.slice(1).map(row => {
    const obj: Record<string, string> = {};
    const headers = rows[0] || [];
    row.forEach((cell, i) => { obj[headers[i] || `Col${i + 1}`] = cell; });
    return obj;
  }));

  // Auto-width columns
  if (rows.length > 0) {
    ws['!cols'] = rows[0].map((_, i) => ({
      wch: Math.min(50, Math.max(10, ...rows.map(r => (r[i] || '').length + 2))),
    }));
  }

  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31)); // Sheet name max 31 chars
  XLSX.writeFile(wb, outputPath);
  return rows.length;
}

// ============================================================================
// PDF Generator (pdfkit)
// ============================================================================

async function generatePdf(title: string, sections: MarkdownSection[], outputPath: string): Promise<void> {
  const PDFDocument = (await import('pdfkit')).default;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // Title
    doc.fontSize(28).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.moveDown(2);

    for (const section of sections) {
      if (section.heading) {
        const size = section.level <= 1 ? 20 : section.level === 2 ? 16 : 13;
        doc.fontSize(size).font('Helvetica-Bold').text(section.heading);
        doc.moveDown(0.5);
      }

      for (const line of section.body) {
        const trimmed = line.trim();
        if (!trimmed) { doc.moveDown(0.3); continue; }

        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          doc.fontSize(11).font('Helvetica').text(`  •  ${trimmed.slice(2)}`, { indent: 15 });
        } else if (trimmed.startsWith('```')) {
          doc.fontSize(9).font('Courier');
        } else {
          doc.fontSize(11).font('Helvetica').text(trimmed);
        }
      }
      doc.moveDown(0.5);
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function generateDocument(input: DocumentGeneratorInput): Promise<DocumentResult> {
  const { type, title, content, outputPath, theme } = input;

  try {
    const expectedExt = expectedExtensionForType(type);
    if (path.extname(outputPath).toLowerCase() !== expectedExt) {
      return {
        success: false,
        error: `outputPath must end with ${expectedExt} for ${type.toUpperCase()} documents`
      };
    }

    // Ensure output directory exists
    const outDir = path.dirname(path.resolve(outputPath));
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const sections = parseMarkdownSections(content);

    let embeddedImages: GeneratedDocumentImage[] | undefined;

    switch (type) {
      case 'pptx':
        await generatePptx(title, sections, outputPath, theme);
        break;
      case 'docx':
        embeddedImages = await generateDocx(title, sections, outputPath);
        break;
      case 'xlsx': {
        const rowCount = await generateXlsx(title, content, outputPath);
        logger.info(`Document generated: ${outputPath} (xlsx, ${rowCount} rows)`);
        return { success: true, outputPath };
      }
      case 'pdf':
        await generatePdf(title, sections, outputPath);
        break;
      default:
        return { success: false, error: `Unknown document type: ${type}` };
    }

    logger.info(`Document generated: ${outputPath} (${type})`);
    return {
      success: true,
      outputPath,
      ...(embeddedImages?.length ? { embeddedImages } : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Document generation failed', { error: msg });
    return { success: false, error: `Document generation failed: ${msg}` };
  }
}

/**
 * Tool execution adapter — called by tool-handler.
 */
export async function executeGenerateDocument(args: {
  type: string;
  title: string;
  content: string;
  outputPath: string;
  theme?: string;
}): Promise<ToolResult> {
  const result = await generateDocument({
    type: args.type as DocumentType,
    title: args.title,
    content: args.content,
    outputPath: args.outputPath,
    theme: args.theme as DocumentGeneratorInput['theme'],
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  const embeddedImages = result.embeddedImages ?? [];
  const docxValidation = args.type === 'docx' && result.outputPath
    ? await validateDocxPackage(result.outputPath)
    : undefined;
  const embeddedImageLines = embeddedImages.length > 0
    ? [
        'Embedded images:',
        ...embeddedImages.map((image) => {
          const caption = image.caption ? ` (${image.caption})` : '';
          return `- ${image.path}${caption} [${image.width}x${image.height}]`;
        }),
      ]
    : [];
  const validationLines = docxValidation
    ? [
        'DOCX validation:',
        `- relationships: ${docxValidation.relationshipCount}`,
        `- embedded image relationships: ${docxValidation.embeddedRelationshipCount}`,
        `- media files: ${docxValidation.mediaFileCount}`,
      ]
    : [];

  return {
    success: true,
    output: [
      `Created ${args.type.toUpperCase()}: ${result.outputPath}`,
      ...embeddedImageLines,
      ...validationLines,
    ].join('\n'),
    data: {
      outputPath: result.outputPath,
      embeddedImages,
      ...(docxValidation ? { docxValidation } : {}),
    },
  };
}
