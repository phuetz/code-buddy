/**
 * `session.prune*` and `session.export*` IPC handlers.
 *
 * Both collaborators are initialized after the main-process IPC surface is
 * registered, so handlers resolve them lazily through accessors on every
 * invocation.
 *
 * @module main/ipc/session-export-ipc
 */

import { BrowserWindow, dialog, ipcMain } from 'electron';
import type { SessionExportService } from '../session/session-export-service';
import type { SessionManager } from '../session/session-manager';
import { logWarn } from '../utils/logger';
import { getMainWindow } from '../window-management';

export interface SessionExportIpcDeps {
  getSessionManager: () => SessionManager | null;
  getSessionExportService: () => SessionExportService | null;
}

interface SessionExportOptions {
  format: 'markdown' | 'json' | 'html';
  redactSecrets?: boolean;
  includeCheckpoints?: boolean;
}

export function registerSessionExportIpcHandlers(deps: SessionExportIpcDeps): void {
  const { getSessionManager, getSessionExportService } = deps;

  // Bulk session prune (Hermes parity): preview matches + age span, then
  // archive them in one pass. Pinned/archived/active sessions never match.
  ipcMain.handle(
    'session.prunePreview',
    async (
      _event,
      filter: { olderThanDays?: number; titleMatch?: string; excludeId?: string }
    ) => {
      const { previewPrune } = await import('../../shared/session-prune');
      const sessionManager = getSessionManager();
      if (!sessionManager) return { matches: [], ageSpan: null };
      const sessions = sessionManager
        .listSessions()
        .filter((session) => session.id !== filter.excludeId)
        .map((session) => ({
          id: session.id,
          title: session.title,
          pinned: session.pinned,
          archived: session.archived,
          updatedAt: session.updatedAt,
        }));
      const preview = previewPrune(sessions, filter, Date.now());
      return {
        matches: preview.matches.map((match) => ({
          id: match.id,
          title: match.title ?? '',
          updatedAt: match.updatedAt,
        })),
        ageSpan: preview.ageSpan,
      };
    }
  );

  ipcMain.handle('session.pruneApply', async (_event, { ids }: { ids: string[] }) => {
    const sessionManager = getSessionManager();
    if (!sessionManager) return { ok: false, archived: 0 };
    let archived = 0;
    for (const id of ids) {
      if (sessionManager.updateSessionSettings(id, { archived: true })) archived += 1;
    }
    return { ok: true, archived };
  });

  ipcMain.handle(
    'session.export',
    async (_event, sessionId: string, format: 'md' | 'json') => {
      try {
        const sessionManager = getSessionManager();
        if (!sessionManager) return null;
        const messages = (
          sessionManager as unknown as { getMessages?: (id: string) => unknown[] }
        ).getMessages?.(sessionId);
        return { messages, format };
      } catch {
        return null;
      }
    }
  );

  // Phase 2 step 16: enhanced session export with format/redaction options.
  ipcMain.handle(
    'session.exportFull',
    async (_event, sessionId: string, options: SessionExportOptions) => {
      const sessionExportService = getSessionExportService();
      if (!sessionExportService) {
        return {
          success: false,
          content: '',
          filename: '',
          error: 'Export service unavailable',
        };
      }
      return sessionExportService.exportSession(sessionId, options);
    }
  );

  // Export a conversation as PDF: render the standalone HTML export in an
  // offscreen window and print it (native Save-As).
  ipcMain.handle('session.exportPdf', async (_event, sessionId: string) => {
    try {
      const sessionManager = getSessionManager();
      if (!sessionManager) {
        return { success: false, error: 'Session manager unavailable' };
      }
      const session = sessionManager.listSessions().find((item) => item.id === sessionId);
      const rawMessages = sessionManager.getMessages(sessionId);
      const { buildConversationPdfHtml } = await import(
        '../session/conversation-pdf-template'
      );
      const pdfMessages = rawMessages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
          role: message.role,
          timestamp: message.timestamp,
          text: (Array.isArray(message.content) ? message.content : [])
            .filter(
              (block): block is { type: 'text'; text: string } =>
                (block as { type?: string }).type === 'text'
            )
            .map((block) => block.text)
            .join('\n\n'),
        }))
        .filter((message) => message.text.trim().length > 0);
      const htmlContent = buildConversationPdfHtml({
        title: session?.title || 'Conversation',
        model: session?.model,
        exportedAt: new Date(),
        messages: pdfMessages,
      });
      const win = getMainWindow();
      const safeName =
        (session?.title || 'conversation')
          .replace(/[^\w\u00C0-\u017F -]+/g, '')
          .trim()
          .slice(0, 60) || 'conversation';
      const dialogResult = win
        ? await dialog.showSaveDialog(win, {
            title: 'Exporter la conversation en PDF',
            defaultPath: `${safeName}.pdf`,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
          })
        : await dialog.showSaveDialog({
            title: 'Exporter la conversation en PDF',
            defaultPath: 'conversation.pdf',
          });
      if (dialogResult.canceled || !dialogResult.filePath) {
        return { success: false, canceled: true };
      }
      const offscreen = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true },
      });
      try {
        await offscreen.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`
        );
        const pdf = await offscreen.webContents.printToPDF({
          printBackground: true,
          margins: { marginType: 'default' },
        });
        const fsp = await import('fs/promises');
        await fsp.writeFile(dialogResult.filePath, pdf);
      } finally {
        offscreen.destroy();
      }
      return { success: true, savedTo: dialogResult.filePath };
    } catch (err) {
      logWarn('[session.exportPdf] failed:', err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(
    'session.exportToFile',
    async (_event, sessionId: string, options: SessionExportOptions) => {
      const sessionExportService = getSessionExportService();
      if (!sessionExportService) {
        return { success: false, error: 'Export service unavailable' };
      }
      const result = sessionExportService.exportSession(sessionId, options);
      if (!result.success) return { success: false, error: result.error };
      const dialogResult = await dialog.showSaveDialog({
        title: 'Export session',
        defaultPath: result.filename,
        filters: [
          options.format === 'markdown'
            ? { name: 'Markdown', extensions: ['md'] }
            : options.format === 'html'
              ? { name: 'HTML', extensions: ['html'] }
              : { name: 'JSON', extensions: ['json'] },
        ],
      });
      if (dialogResult.canceled || !dialogResult.filePath) {
        return { success: false, error: 'Cancelled' };
      }
      const writeResult = sessionExportService.saveToFile(
        dialogResult.filePath,
        result.content
      );
      return {
        success: writeResult.success,
        error: writeResult.error,
        path: dialogResult.filePath,
      };
    }
  );
}
