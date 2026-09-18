/**
 * IPC for local office export. Never accepts a raw output path from the renderer;
 * the save dialog proposes a file under the session folder.
 *
 * @module main/office-export/office-export-ipc
 */

import { dialog, type BrowserWindow } from 'electron';
import {
  proposeOfficeExportPath,
  writeOfficeExport,
  type OfficeExportFormat,
} from './export-office';

export interface OfficeExportSavePayload {
  markdown?: unknown;
  title?: unknown;
  format?: unknown;
  sessionId?: unknown;
  suggestedName?: unknown;
}

export interface OfficeExportSaveResult {
  success: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
  warnings?: string[];
}

export interface OfficeExportIpcDeps {
  getSession: (id: string) => { title?: string; cwd?: string } | null;
  getUserDataPath: () => string;
  getMainWindow?: () => BrowserWindow | null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseFormat(value: unknown): OfficeExportFormat | null {
  return value === 'docx' || value === 'pptx' ? value : null;
}

export function createOfficeExportSaveHandler(deps: OfficeExportIpcDeps) {
  return async (_event: unknown, payload: OfficeExportSavePayload): Promise<OfficeExportSaveResult> => {
    const format = parseFormat(payload?.format);
    if (!format) {
      return { success: false, error: 'Format invalide (docx ou pptx)' };
    }
    const markdown = asString(payload?.markdown);
    if (!markdown.trim()) {
      return { success: false, error: 'Aucun contenu à exporter' };
    }
    const sessionId = asString(payload?.sessionId) || undefined;
    const session = sessionId ? deps.getSession(sessionId) : null;
    const title =
      asString(payload?.title).trim() ||
      asString(payload?.suggestedName).trim() ||
      session?.title ||
      'export';
    const defaultPath = proposeOfficeExportPath({
      sessionCwd: session?.cwd,
      sessionId,
      userDataDir: deps.getUserDataPath(),
      title,
      format,
    });

    const win = deps.getMainWindow?.() ?? null;
    const dialogOpts = {
      title: format === 'docx' ? 'Exporter le document' : 'Exporter la présentation',
      defaultPath,
      filters: [
        format === 'docx'
          ? { name: 'Word', extensions: ['docx'] }
          : { name: 'PowerPoint', extensions: ['pptx'] },
      ],
    };
    const chosen = win
      ? await dialog.showSaveDialog(win, dialogOpts)
      : await dialog.showSaveDialog(dialogOpts);
    if (chosen.canceled || !chosen.filePath) {
      return { success: false, canceled: true };
    }

    const result = await writeOfficeExport({
      markdown,
      title,
      format,
      outputPath: chosen.filePath,
      baseDir: session?.cwd,
    });
    if (!result.success) {
      return { success: false, error: result.error, warnings: result.warnings };
    }
    return {
      success: true,
      path: result.path,
      warnings: result.warnings,
    };
  };
}

export function registerOfficeExportIpcHandlers(
  ipcMain: { handle: (channel: string, listener: (...args: unknown[]) => unknown) => void },
  deps: OfficeExportIpcDeps
): void {
  const save = createOfficeExportSaveHandler(deps);
  ipcMain.handle('officeExport.save', (event, payload) => save(event, payload as OfficeExportSavePayload));
}
