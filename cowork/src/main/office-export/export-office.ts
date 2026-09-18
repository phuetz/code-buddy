/**
 * Local Markdown → Office export (no network).
 *
 * @module main/office-export/export-office
 */

import * as fs from 'fs';
import * as path from 'path';
import { writeDocxFile } from './docx-export';
import { writePptxFile } from './pptx-export';
import { parseMarkdownDocument, FALLBACK_TITLE, type MdDocument } from './markdown-model';
import { slugifyExportName } from './sanitize';

export type OfficeExportFormat = 'docx' | 'pptx';

export interface OfficeExportRequest {
  markdown: string;
  title?: string;
  format: OfficeExportFormat;
  outputPath: string;
  baseDir?: string;
}

export interface OfficeExportWriteResult {
  success: boolean;
  path?: string;
  error?: string;
  warnings: string[];
  format: OfficeExportFormat;
  title: string;
  slideCount?: number;
}

export function proposeOfficeExportPath(input: {
  sessionCwd?: string;
  sessionId?: string;
  userDataDir: string;
  title: string;
  format: OfficeExportFormat;
}): string {
  const root =
    input.sessionCwd && input.sessionCwd.trim()
      ? input.sessionCwd
      : path.join(input.userDataDir, 'sessions', input.sessionId || 'default');
  const name = `${slugifyExportName(input.title)}.${input.format}`;
  return path.join(root, 'exports', name);
}

export function parseOfficeMarkdown(markdown: string, title?: string): MdDocument {
  const parsed = parseMarkdownDocument(markdown);
  const fallback = title?.trim();
  if (fallback && parsed.title === FALLBACK_TITLE) {
    return { ...parsed, title: fallback };
  }
  return parsed;
}

export async function writeOfficeExport(request: OfficeExportRequest): Promise<OfficeExportWriteResult> {
  const format = request.format;
  if (format !== 'docx' && format !== 'pptx') {
    return { success: false, error: `Format non pris en charge : ${String(format)}`, warnings: [], format: 'docx', title: '' };
  }
  const ext = path.extname(request.outputPath).toLowerCase();
  if (ext !== `.${format}`) {
    return {
      success: false,
      error: `Le chemin de sortie doit se terminer par .${format}`,
      warnings: [],
      format,
      title: request.title ?? '',
    };
  }

  const doc = parseOfficeMarkdown(request.markdown, request.title);
  const baseDir = request.baseDir || path.dirname(request.outputPath);

  try {
    fs.mkdirSync(path.dirname(request.outputPath), { recursive: true });
    if (format === 'docx') {
      const result = await writeDocxFile(doc, request.outputPath, baseDir);
      return {
        success: true,
        path: request.outputPath,
        warnings: result.warnings,
        format,
        title: doc.title,
      };
    }
    const result = await writePptxFile(doc, request.outputPath, baseDir);
    return {
      success: true,
      path: request.outputPath,
      warnings: result.warnings,
      format,
      title: doc.title,
      slideCount: result.slideCount,
    };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message ?? 'Export failed',
      warnings: [],
      format,
      title: doc.title,
    };
  }
}
