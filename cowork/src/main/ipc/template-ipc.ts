/**
 * `template.*` IPC — project templates (Claude Cowork parity Phase 2 step
 * 12): list/preview the SKILL.md starter packs and `create` (apply) one into
 * a workspace. Thin layer over {@link TemplateService}.
 *
 * Extracted from the main index.ts god-file. `templateService` is a runtime
 * mutable (built once skillMdBridge exists), so it is injected as an ACCESSOR
 * (getter) — handlers read the current instance and no-op with a safe
 * default while it is still null. Bodies copied verbatim.
 *
 * @module main/ipc/template-ipc
 */

import { ipcMain } from 'electron';
import type { TemplateService } from '../project/template-service';
import { logError } from '../utils/logger';

export interface TemplateIpcDeps {
  /** Current TemplateService (null until built) — accessor, not value. */
  getTemplateService: () => TemplateService | null;
}

export function registerTemplateIpcHandlers(deps: TemplateIpcDeps): void {
  const { getTemplateService } = deps;

  // Project templates — Claude Cowork parity Phase 2 step 12
  ipcMain.handle('template.list', async () => {
    const templateService = getTemplateService();
    if (!templateService) return [];
    try {
      return await templateService.list();
    } catch (err) {
      logError('[template.list] failed:', err);
      return [];
    }
  });

  ipcMain.handle('template.preview', async (_event, name: string) => {
    const templateService = getTemplateService();
    if (!templateService) return null;
    try {
      return await templateService.preview(name);
    } catch (err) {
      logError('[template.preview] failed:', err);
      return null;
    }
  });

  ipcMain.handle('template.create', async (_event, name: string, workspaceRoot: string) => {
    const templateService = getTemplateService();
    if (!templateService) {
      return { success: false, error: 'Template service unavailable' };
    }
    try {
      return await templateService.apply(name, workspaceRoot);
    } catch (err) {
      logError('[template.create] failed:', err);
      return {
        success: false,
        error: (err as Error).message ?? 'Template execution failed',
      };
    }
  });
}
