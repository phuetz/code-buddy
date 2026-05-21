import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import path from 'path';
import { ToolResult, getErrorMessage } from '../types/index.js';
import { createLoopGuard } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface DocumentContent {
  text: string;
  type: 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp' | 'rtf' | 'csv';
  metadata: DocumentMetadata;
  sheets?: SheetContent[]; // For spreadsheets
  slides?: SlideContent[]; // For presentations
}

export interface DocumentMetadata {
  title?: string;
  author?: string;
  creator?: string;
  created?: string;
  modified?: string;
  lastModifiedBy?: string;
  pageCount?: number;
  wordCount?: number;
  embeddedImageCount?: number;
  sheetCount?: number;
  slideCount?: number;
}

export interface SheetContent {
  name: string;
  data: string[][];
  rowCount: number;
  colCount: number;
}

export interface SlideContent {
  number: number;
  title?: string;
  text: string;
}

export interface ExtractedDocumentImage {
  sourcePath: string;
  outputPath: string;
  markdownRef: string;
  size: number;
}

interface DocxImageRelationship {
  id: string;
  target: string;
  zipPath: string;
}

/**
 * Document Tool for reading Office documents (DOCX, XLSX, PPTX) and other formats
 * Uses ZIP-based extraction for Office Open XML formats
 */
export class DocumentTool {
  private readonly supportedFormats = ['.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.rtf', '.csv', '.tsv'];
  private readonly maxFileSizeMB = 100;
  private vfs = UnifiedVfsRouter.Instance;

  /**
   * Read document content
   */
  async readDocument(filePath: string): Promise<ToolResult> {
    try {
      const resolvedPath = path.resolve(process.cwd(), filePath);

      if (!await this.vfs.exists(resolvedPath)) {
        return {
          success: false,
          error: `Document not found: ${filePath}`
        };
      }

      const ext = path.extname(resolvedPath).toLowerCase();
      if (!this.supportedFormats.includes(ext)) {
        return {
          success: false,
          error: `Unsupported format: ${ext}. Supported: ${this.supportedFormats.join(', ')}`
        };
      }

      const stats = await this.vfs.stat(resolvedPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      if (fileSizeMB > this.maxFileSizeMB) {
        return {
          success: false,
          error: `File too large: ${fileSizeMB.toFixed(2)}MB. Max: ${this.maxFileSizeMB}MB`
        };
      }

      let content: DocumentContent;

      switch (ext) {
        case '.docx':
          content = await this.readDocx(resolvedPath);
          break;
        case '.xlsx':
          content = await this.readXlsx(resolvedPath);
          break;
        case '.pptx':
          content = await this.readPptx(resolvedPath);
          break;
        case '.csv':
        case '.tsv':
          content = await this.readCsv(resolvedPath, ext === '.tsv' ? '\t' : ',');
          break;
        case '.rtf':
          content = await this.readRtf(resolvedPath);
          break;
        default:
          return {
            success: false,
            error: `Format ${ext} is recognized but not yet fully implemented`
          };
      }

      return {
        success: true,
        output: this.formatOutput(content, filePath),
        data: content
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to read document: ${getErrorMessage(error)}`
      };
    }
  }

  /**
   * Extract embedded DOCX images to a directory so downstream OCR or deliverable
   * generation can inspect screenshots instead of only seeing text markers.
   */
  async extractEmbeddedImages(filePath: string, outputDir?: string): Promise<ToolResult> {
    try {
      const resolvedPath = path.resolve(process.cwd(), filePath);

      if (!await this.vfs.exists(resolvedPath)) {
        return {
          success: false,
          error: `Document not found: ${filePath}`
        };
      }

      const ext = path.extname(resolvedPath).toLowerCase();
      if (ext !== '.docx') {
        return {
          success: false,
          error: 'Embedded image extraction currently supports DOCX files only'
        };
      }

      const stats = await this.vfs.stat(resolvedPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      if (fileSizeMB > this.maxFileSizeMB) {
        return {
          success: false,
          error: `File too large: ${fileSizeMB.toFixed(2)}MB. Max: ${this.maxFileSizeMB}MB`
        };
      }

      const AdmZip = (await import('adm-zip')).default;
      const buffer = await this.vfs.readFileBuffer(resolvedPath);
      const zip = new AdmZip(buffer);
      const selectedImages = this.selectDocxImagesForExtraction(zip);
      const resolvedOutputDir = outputDir
        ? path.resolve(process.cwd(), outputDir)
        : path.join(path.dirname(resolvedPath), `${path.basename(resolvedPath, ext)}-images`);

      if (selectedImages.length === 0) {
        return {
          success: true,
          output: `No embedded images found in ${filePath}`,
          data: { images: [], outputDir: resolvedOutputDir }
        };
      }

      await this.vfs.ensureDir(resolvedOutputDir);

      const images: ExtractedDocumentImage[] = [];
      for (const selected of selectedImages) {
        const fileName = path.basename(selected.entry.entryName);
        if (!fileName) continue;
        const imageBuffer = selected.entry.getData();
        const outputPath = path.join(resolvedOutputDir, fileName);
        const markdownRef = `![Source screenshot - ${fileName}](${formatMarkdownPath(outputPath)})`;
        await this.vfs.writeFileBuffer(outputPath, imageBuffer);
        images.push({
          sourcePath: selected.entry.entryName,
          outputPath,
          markdownRef,
          size: imageBuffer.length
        });
      }

      return {
        success: true,
        output: [
          `Extracted ${images.length} embedded image(s) to ${resolvedOutputDir}`,
          ...images.map(image => `- ${image.outputPath} (${image.size} bytes)`),
          ...(images.length > 0
            ? [
                'Markdown references for generate_document:',
                ...images.map(image => `- ${image.markdownRef}`)
              ]
            : [])
        ].join('\n'),
        data: { images, outputDir: resolvedOutputDir }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to extract embedded images: ${getErrorMessage(error)}`
      };
    }
  }

  private selectDocxImagesForExtraction(zip: {
    getEntries: () => Array<{ isDirectory: boolean; entryName: string; getData: () => Buffer }>;
    getEntry: (entryName: string) => { isDirectory: boolean; entryName: string; getData: () => Buffer } | null;
    readAsText: (path: string) => string;
  }): Array<{ relationshipId?: string; entry: { isDirectory: boolean; entryName: string; getData: () => Buffer } }> {
    const relationships = this.extractDocxImageRelationshipEntries(zip);
    const byId = new Map(relationships.map(relationship => [relationship.id, relationship]));
    const documentXml = safeReadZipText(zip, 'word/document.xml');
    const orderedRelationshipIds = documentXml
      ? this.extractDocxImageRelationshipIdsInDocumentOrder(documentXml)
      : [];
    const selectedRelationships = orderedRelationshipIds
      .map(id => byId.get(id))
      .filter((relationship): relationship is DocxImageRelationship => Boolean(relationship));
    const relationshipsToExtract = selectedRelationships.length > 0 ? selectedRelationships : relationships;

    if (relationshipsToExtract.length > 0) {
      const seen = new Set<string>();
      return relationshipsToExtract
        .filter(relationship => {
          if (seen.has(relationship.zipPath)) return false;
          seen.add(relationship.zipPath);
          return true;
        })
        .map(relationship => {
          const entry = zip.getEntry(relationship.zipPath);
          return entry && !entry.isDirectory
            ? { relationshipId: relationship.id, entry }
            : null;
        })
        .filter((image): image is { relationshipId: string; entry: { isDirectory: boolean; entryName: string; getData: () => Buffer } } => Boolean(image));
    }

    // Backward-compatible fallback for minimal synthetic DOCX files or unusual
    // packages that include media but omit document relationships.
    return zip.getEntries()
      .filter(entry => !entry.isDirectory && entry.entryName.startsWith('word/media/'))
      .map(entry => ({ entry }));
  }

  /**
   * Read DOCX file
   */
  private async readDocx(filePath: string): Promise<DocumentContent> {
    const AdmZip = (await import('adm-zip')).default;
    const buffer = await this.vfs.readFileBuffer(filePath);
    const zip = new AdmZip(buffer);

    // Read document.xml
    const documentXml = zip.readAsText('word/document.xml');

    const relationships = this.extractDocxRelationships(zip);

    // Extract text from XML while preserving paragraph, table, and image
    // positions. Question documents depend on those breaks to keep
    // analysis/context attached to the right question.
    const extraction = this.extractDocxText(documentXml, relationships);
    const { text } = extraction;

    // Try to read metadata from core.xml
    const metadata = this.extractDocxMetadata(zip);

    return {
      text,
      type: 'docx',
      metadata: {
        ...metadata,
        wordCount: text.split(/\s+/).filter(w => w.length > 0).length,
        embeddedImageCount: extraction.embeddedImageCount
      }
    };
  }

  /**
   * Read XLSX file with async processing to avoid blocking the event loop
   */
  private async readXlsx(filePath: string): Promise<DocumentContent> {
    const AdmZip = (await import('adm-zip')).default;
    const buffer = await this.vfs.readFileBuffer(filePath);
    const zip = new AdmZip(buffer);

    // Read shared strings asynchronously
    const sharedStrings = await this.parseSharedStringsAsync(zip);

    // Read workbook to get sheet names (yield to event loop)
    await this.yieldToEventLoop();
    const workbookXml = zip.readAsText('xl/workbook.xml');
    const sheetNames = this.extractSheetNames(workbookXml);

    // Discover all available sheet files
    const sheetEntries = zip.getEntries()
      .filter(entry => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.entryName))
      .map(entry => {
        const match = entry.entryName.match(/sheet(\d+)\.xml$/);
        return { entryName: entry.entryName, index: match ? parseInt(match[1]) : 0 };
      })
      .sort((a, b) => a.index - b.index);

    // Process sheets in batches to avoid blocking
    const sheets: SheetContent[] = [];
    const parseErrors: string[] = [];
    const BATCH_SIZE = 3;

    for (let i = 0; i < sheetEntries.length; i += BATCH_SIZE) {
      // Yield to event loop between batches
      if (i > 0) {
        await this.yieldToEventLoop();
      }

      const batch = sheetEntries.slice(i, i + BATCH_SIZE);

      for (const { entryName, index } of batch) {
        try {
          const sheetXml = zip.readAsText(entryName);
          const sheetData = this.parseSheetXml(sheetXml, sharedStrings);

          sheets.push({
            name: sheetNames[index - 1] || `Sheet${index}`,
            data: sheetData.data,
            rowCount: sheetData.data.length,
            colCount: sheetData.maxCol
          });
        } catch (error) {
          // Log error and continue with remaining sheets
          const sheetName = sheetNames[index - 1] || `Sheet${index}`;
          const errorMsg = `Failed to parse ${sheetName}: ${getErrorMessage(error)}`;
          parseErrors.push(errorMsg);
          logger.error(`[DocumentTool] ${errorMsg}`);
        }
      }
    }

    // Combine all sheet text
    let text = sheets.map(s =>
      `[${s.name}]\n` + s.data.map(row => row.join('\t')).join('\n')
    ).join('\n\n');

    // Append parse errors if any occurred
    if (parseErrors.length > 0) {
      text += `\n\n[Parse Warnings]\n${parseErrors.join('\n')}`;
    }

    return {
      text,
      type: 'xlsx',
      metadata: {
        sheetCount: sheets.length
      },
      sheets
    };
  }

  /**
   * Parse shared strings XML asynchronously
   */
  private async parseSharedStringsAsync(zip: { readAsText: (path: string) => string }): Promise<string[]> {
    const sharedStrings: string[] = [];
    try {
      await this.yieldToEventLoop();
      const sharedStringsXml = zip.readAsText('xl/sharedStrings.xml');

      // Process in chunks if the XML is large
      const matches = sharedStringsXml.match(/<t[^>]*>([^<]*)<\/t>/g) || [];
      const CHUNK_SIZE = 1000;

      for (let i = 0; i < matches.length; i += CHUNK_SIZE) {
        if (i > 0) {
          await this.yieldToEventLoop();
        }
        const chunk = matches.slice(i, i + CHUNK_SIZE);
        for (const match of chunk) {
          const text = match.replace(/<[^>]+>/g, '');
          sharedStrings.push(text);
        }
      }
    } catch {
      // No shared strings file - this is normal for some Excel files
    }
    return sharedStrings;
  }

  /**
   * Extract sheet names from workbook XML
   */
  private extractSheetNames(workbookXml: string): string[] {
    const sheetNames: string[] = [];
    const sheetMatches = workbookXml.match(/<sheet[^>]+name="([^"]+)"[^>]*>/g) || [];
    for (const match of sheetMatches) {
      const nameMatch = match.match(/name="([^"]+)"/);
      if (nameMatch) {
        sheetNames.push(nameMatch[1]);
      }
    }
    return sheetNames;
  }

  /**
   * Yield to the event loop to prevent blocking
   */
  private yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
  }

  /**
   * Parse Excel sheet XML
   */
  private parseSheetXml(xml: string, sharedStrings: string[]): { data: string[][]; maxCol: number } {
    const data: string[][] = [];
    let maxCol = 0;

    // Find all rows
    const rowMatches = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];

    for (const rowXml of rowMatches) {
      const rowNumMatch = rowXml.match(/r="(\d+)"/);
      const rowNum = rowNumMatch ? parseInt(rowNumMatch[1]) - 1 : data.length;

      // Ensure row exists
      while (data.length <= rowNum) {
        data.push([]);
      }

      // Find all cells in row
      const cellMatches = rowXml.match(/<c[^>]*>[\s\S]*?<\/c>/g) || [];

      for (const cellXml of cellMatches) {
        const refMatch = cellXml.match(/r="([A-Z]+)(\d+)"/);
        if (!refMatch) continue;

        const colStr = refMatch[1];
        const colIndex = this.colStringToIndex(colStr);
        maxCol = Math.max(maxCol, colIndex + 1);

        // Ensure row has enough columns
        while (data[rowNum].length <= colIndex) {
          data[rowNum].push('');
        }

        // Get cell value
        const valueMatch = cellXml.match(/<v>([^<]*)<\/v>/);
        let value = valueMatch ? valueMatch[1] : '';

        // Check if it's a shared string reference
        const typeMatch = cellXml.match(/t="s"/);
        if (typeMatch && sharedStrings[parseInt(value)]) {
          value = sharedStrings[parseInt(value)];
        }

        data[rowNum][colIndex] = value;
      }
    }

    return { data, maxCol };
  }

  /**
   * Convert Excel column string to index (A=0, B=1, ..., AA=26, etc.)
   */
  private colStringToIndex(col: string): number {
    let index = 0;
    for (let i = 0; i < col.length; i++) {
      index = index * 26 + (col.charCodeAt(i) - 64);
    }
    return index - 1;
  }

  /**
   * Read PPTX file
   */
  private async readPptx(filePath: string): Promise<DocumentContent> {
    const AdmZip = (await import('adm-zip')).default;
    const buffer = await this.vfs.readFileBuffer(filePath);
    const zip = new AdmZip(buffer);

    const slides: SlideContent[] = [];
    let slideIndex = 1;

    // Guard against infinite loops (max 10000 slides should be more than enough)
    const guard = createLoopGuard({
      maxIterations: 10000,
      context: 'PPTX slide parsing',
      onWarn: (msg) => logger.warn(`[DocumentTool] ${msg}`)
    });

    while (true) {
      guard();
      try {
        const slideXml = zip.readAsText(`ppt/slides/slide${slideIndex}.xml`);
        const text = this.extractTextFromXml(slideXml, 'a:t');

        // Try to get slide title (usually in first shape)
        const titleMatch = slideXml.match(/<p:sp[^>]*>[\s\S]*?<p:txBody>[\s\S]*?<a:p>[\s\S]*?<a:t>([^<]+)<\/a:t>/);
        const title = titleMatch ? titleMatch[1] : undefined;

        slides.push({
          number: slideIndex,
          title,
          text
        });

        slideIndex++;
      } catch {
        break;
      }
    }

    const text = slides.map(s =>
      `[Slide ${s.number}${s.title ? ': ' + s.title : ''}]\n${s.text}`
    ).join('\n\n');

    return {
      text,
      type: 'pptx',
      metadata: {
        slideCount: slides.length
      },
      slides
    };
  }

  /**
   * Read CSV/TSV file
   */
  private async readCsv(filePath: string, delimiter: string): Promise<DocumentContent> {
    const content = await this.vfs.readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const data: string[][] = [];

    for (const line of lines) {
      if (line.trim()) {
        data.push(this.parseCsvLine(line, delimiter));
      }
    }

    const text = data.map(row => row.join('\t')).join('\n');

    return {
      text,
      type: 'csv',
      metadata: {},
      sheets: [{
        name: 'Data',
        data,
        rowCount: data.length,
        colCount: data[0]?.length || 0
      }]
    };
  }

  /**
   * Parse a single CSV line handling quotes
   */
  private parseCsvLine(line: string, delimiter: string): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    cells.push(current.trim());
    return cells;
  }

  /**
   * Read RTF file
   */
  private async readRtf(filePath: string): Promise<DocumentContent> {
    const content = await this.vfs.readFile(filePath, 'utf8');

    // Basic RTF to text conversion
    let text = content
      // Remove RTF header
      .replace(/^\{\\rtf[^}]*/, '')
      // Remove control words
      .replace(/\\[a-z]+\d* ?/g, '')
      // Remove groups
      .replace(/[{}]/g, '')
      // Convert special characters
      .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      // Clean up whitespace
      .replace(/\s+/g, ' ')
      .trim();

    return {
      text,
      type: 'rtf',
      metadata: {
        wordCount: text.split(/\s+/).filter(w => w.length > 0).length
      }
    };
  }

  /**
   * Extract text from XML content
   */
  private extractTextFromXml(xml: string, tagName: string): string {
    return this.extractTextRunsFromXml(xml, tagName)
      .map(text => text.trim())
      .filter(Boolean)
      .join(' ');
  }

  private extractDocxText(
    documentXml: string,
    relationships: Map<string, string> = new Map()
  ): { text: string; embeddedImageCount: number } {
    const bodyMatch = documentXml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/);
    const sourceXml = bodyMatch?.[1] || documentXml;
    const blocks = this.extractXmlBlocks(sourceXml, ['w:p', 'w:tbl']);

    if (blocks.length === 0) {
      const text = this.extractTextFromXml(documentXml, 'w:t');
      const imageMarkers = this.extractDocxImageMarkers(documentXml, relationships);
      return {
        text: [text, ...imageMarkers].filter(Boolean).join('\n'),
        embeddedImageCount: imageMarkers.length
      };
    }

    const lines: string[] = [];
    let embeddedImageCount = 0;

    for (const block of blocks) {
      if (block.tagName === 'w:tbl') {
        const table = this.extractDocxTableText(block.xml, relationships);
        if (table.lines.length > 0) {
          lines.push('[Table]', ...table.lines);
        }
        embeddedImageCount += table.embeddedImageCount;
        continue;
      }

      const paragraph = this.extractDocxParagraphText(block.xml, relationships);
      if (paragraph.lines.length > 0) {
        lines.push(...paragraph.lines);
      }
      embeddedImageCount += paragraph.embeddedImageCount;
    }

    return {
      text: lines.filter(Boolean).join('\n'),
      embeddedImageCount
    };
  }

  private extractXmlBlocks(xml: string, tagNames: string[]): Array<{ tagName: string; xml: string }> {
    const pattern = tagNames.map(tag => tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');
    const regex = new RegExp(`<(${pattern})\\b[^>]*>[\\s\\S]*?</\\1>`, 'g');
    const blocks: Array<{ tagName: string; xml: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(xml)) !== null) {
      blocks.push({ tagName: match[1], xml: match[0] });
    }

    return blocks;
  }

  private extractDocxTableText(
    tableXml: string,
    relationships: Map<string, string>
  ): { lines: string[]; embeddedImageCount: number } {
    const rows = this.extractXmlBlocks(tableXml, ['w:tr']);
    const lines: string[] = [];
    let embeddedImageCount = 0;

    for (const row of rows) {
      const cells = this.extractXmlBlocks(row.xml, ['w:tc']);
      const cellTexts: string[] = [];

      for (const cell of cells) {
        const paragraphs = this.extractXmlBlocks(cell.xml, ['w:p']);
        const paragraphLines: string[] = [];

        for (const paragraphXml of paragraphs) {
          const paragraph = this.extractDocxParagraphText(paragraphXml.xml, relationships);
          paragraphLines.push(...paragraph.lines);
          embeddedImageCount += paragraph.embeddedImageCount;
        }

        if (paragraphs.length === 0) {
          const paragraph = this.extractDocxParagraphText(cell.xml, relationships);
          paragraphLines.push(...paragraph.lines);
          embeddedImageCount += paragraph.embeddedImageCount;
        }

        cellTexts.push(paragraphLines.join(' / ').replace(/\s*\n\s*/g, ' / ').trim());
      }

      const rowText = cellTexts.join('\t').trim();
      if (rowText) {
        lines.push(rowText);
      }
    }

    return { lines, embeddedImageCount };
  }

  private extractDocxParagraphText(
    paragraphXml: string,
    relationships: Map<string, string>
  ): { lines: string[]; embeddedImageCount: number } {
    const text = this.extractTextRunsFromXml(paragraphXml, 'w:t').join('').trim();
    const imageMarkers = this.extractDocxImageMarkers(paragraphXml, relationships);

    return {
      lines: [text, ...imageMarkers].filter(Boolean),
      embeddedImageCount: imageMarkers.length
    };
  }

  private extractDocxImageMarkers(paragraphXml: string, relationships: Map<string, string>): string[] {
    const relIds = new Set<string>();
    const relRegex = /\br:(?:embed|link|id)=["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    const hasImageMarkup = /<(?:w:drawing|w:pict|pic:pic|v:imagedata)\b/.test(paragraphXml);

    while ((match = relRegex.exec(paragraphXml)) !== null) {
      relIds.add(this.decodeXmlText(match[1]));
    }

    const markers = [...relIds]
      .map(relId => relationships.get(relId))
      .filter((target): target is string => Boolean(target))
      .map(target => `[Embedded image: ${target}]`);

    if (markers.length === 0 && hasImageMarkup) {
      markers.push('[Embedded image]');
    }

    return markers;
  }

  private extractTextRunsFromXml(xml: string, tagName: string): string[] {
    const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'g');
    const texts: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(xml)) !== null) {
      texts.push(this.decodeXmlText(match[1]));
    }

    return texts;
  }

  private decodeXmlText(text: string): string {
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  private extractDocxRelationships(zip: { readAsText: (path: string) => string }): Map<string, string> {
    const relationships = new Map<string, string>();
    for (const relationship of this.extractDocxImageRelationshipEntries(zip)) {
      relationships.set(relationship.id, relationship.target);
    }
    return relationships;
  }

  private extractDocxImageRelationshipEntries(zip: { readAsText: (path: string) => string }): DocxImageRelationship[] {
    const relationships: DocxImageRelationship[] = [];
    try {
      const relsXml = zip.readAsText('word/_rels/document.xml.rels');
      const relMatches = relsXml.match(/<Relationship\b[^>]*\/?>/g) || [];

      for (const relXml of relMatches) {
        const id = this.getXmlAttribute(relXml, 'Id');
        const type = this.getXmlAttribute(relXml, 'Type');
        const target = this.getXmlAttribute(relXml, 'Target');
        const targetMode = this.getXmlAttribute(relXml, 'TargetMode');

        if (id && target && targetMode !== 'External' && type?.endsWith('/image')) {
          const zipPath = resolveDocxImageTargetToZipPath(target);
          if (zipPath) {
            relationships.push({ id, target, zipPath });
          }
        }
      }
    } catch {
      // Relationship extraction is best-effort; text extraction can continue.
    }

    return relationships;
  }

  private extractDocxImageRelationshipIdsInDocumentOrder(documentXml: string): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    const relRegex = /\br:(?:embed|link)=["']([^"']+)["']/g;
    let match: RegExpExecArray | null;

    while ((match = relRegex.exec(documentXml)) !== null) {
      const id = this.decodeXmlText(match[1]);
      if (!seen.has(id)) {
        ids.push(id);
        seen.add(id);
      }
    }

    return ids;
  }

  private getXmlAttribute(xml: string, attributeName: string): string | undefined {
    const match = xml.match(new RegExp(`\\b${attributeName}=(["'])(.*?)\\1`));
    return match ? this.decodeXmlText(match[2]) : undefined;
  }

  /**
   * Extract DOCX metadata
   */
  private extractDocxMetadata(zip: { readAsText: (path: string) => string }): DocumentMetadata {
    const metadata: DocumentMetadata = {};

    try {
      const coreXml = zip.readAsText('docProps/core.xml');

      const titleMatch = coreXml.match(/<dc:title>([^<]*)<\/dc:title>/);
      if (titleMatch) metadata.title = titleMatch[1];

      const creatorMatch = coreXml.match(/<dc:creator>([^<]*)<\/dc:creator>/);
      if (creatorMatch) metadata.author = creatorMatch[1];

      const createdMatch = coreXml.match(/<dcterms:created[^>]*>([^<]*)<\/dcterms:created>/);
      if (createdMatch) metadata.created = createdMatch[1];

      const modifiedMatch = coreXml.match(/<dcterms:modified[^>]*>([^<]*)<\/dcterms:modified>/);
      if (modifiedMatch) metadata.modified = modifiedMatch[1];

      const lastModifiedByMatch = coreXml.match(/<cp:lastModifiedBy>([^<]*)<\/cp:lastModifiedBy>/);
      if (lastModifiedByMatch) metadata.lastModifiedBy = lastModifiedByMatch[1];
    } catch {
      // Metadata extraction failed
    }

    return metadata;
  }

  /**
   * Format output for display
   */
  private formatOutput(content: DocumentContent, filePath: string): string {
    const lines: string[] = [];
    const typeEmoji = {
      docx: '📝',
      xlsx: '📊',
      pptx: '📽️',
      csv: '📊',
      rtf: '📝',
      odt: '📝',
      ods: '📊',
      odp: '📽️'
    };

    lines.push(`${typeEmoji[content.type] || '📄'} ${content.type.toUpperCase()}: ${path.basename(filePath)}`);

    if (content.metadata.title) {
      lines.push(`   Title: ${content.metadata.title}`);
    }
    if (content.metadata.author) {
      lines.push(`   Author: ${content.metadata.author}`);
    }
    if (content.metadata.wordCount) {
      lines.push(`   Words: ${content.metadata.wordCount}`);
    }
    if (content.metadata.embeddedImageCount) {
      lines.push(`   Images: ${content.metadata.embeddedImageCount}`);
    }
    if (content.metadata.sheetCount) {
      lines.push(`   Sheets: ${content.metadata.sheetCount}`);
    }
    if (content.metadata.slideCount) {
      lines.push(`   Slides: ${content.metadata.slideCount}`);
    }

    lines.push('');
    lines.push('--- Content ---');
    lines.push(content.text.slice(0, 5000));

    if (content.text.length > 5000) {
      lines.push(`\n... [truncated, ${content.text.length - 5000} more characters]`);
    }

    return lines.join('\n');
  }

  /**
   * List supported documents in directory
   */
  async listDocuments(dirPath: string = '.'): Promise<ToolResult> {
    try {
      const resolvedPath = path.resolve(process.cwd(), dirPath);

      if (!await this.vfs.exists(resolvedPath)) {
        return {
          success: false,
          error: `Directory not found: ${dirPath}`
        };
      }

      const entries = await this.vfs.readDirectory(resolvedPath);
      const docs = entries.filter(e => {
        if (!e.isFile) return false;
        const ext = path.extname(e.name).toLowerCase();
        return this.supportedFormats.includes(ext);
      });

      if (docs.length === 0) {
        return {
          success: true,
          output: `No supported documents found in ${dirPath}`
        };
      }

      const docListPromises = docs.map(async doc => {
        const fullPath = path.join(resolvedPath, doc.name);
        const stats = await this.vfs.stat(fullPath);
        const ext = path.extname(doc.name).toLowerCase();
        const emoji = ext.includes('doc') ? '📝' : ext.includes('xls') || ext === '.csv' ? '📊' : '📽️';
        return `  ${emoji} ${doc.name} (${this.formatSize(stats.size)})`;
      });

      const docList = (await Promise.all(docListPromises)).join('\n');

      return {
        success: true,
        output: `Documents in ${dirPath}:\n${docList}`
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list documents: ${getErrorMessage(error)}`
      };
    }
  }

  /**
   * Check if file is a supported document
   */
  isDocument(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedFormats.includes(ext);
  }

  /**
   * Format file size
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
}

function safeReadZipText(zip: { readAsText: (path: string) => string }, entryName: string): string | null {
  try {
    return zip.readAsText(entryName);
  } catch {
    return null;
  }
}

function resolveDocxImageTargetToZipPath(target: string): string | null {
  const normalized = target.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    return null;
  }

  const zipPath = normalized.startsWith('word/')
    ? normalized
    : path.posix.join('word', normalized);

  return zipPath.startsWith('word/media/') ? zipPath : null;
}

function formatMarkdownPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}
