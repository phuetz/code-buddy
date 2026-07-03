/**
 * `test.*` IPC — the test-runner panel (Claude Cowork parity Phase 3 step
 * 12): detect the framework, run all/selected files, browse + run catalog
 * items, re-run failing, cancel, and read live state. The test-runner-bridge
 * is imported lazily inside each handler.
 *
 * Extracted from the main index.ts god-file. Fully self-contained — no
 * mutable capture, so no accessor injection. Bodies copied verbatim.
 *
 * @module main/ipc/test-runner-ipc
 */

import { ipcMain } from 'electron';
import { logError } from '../utils/logger';

export function registerTestRunnerIpcHandlers(): void {
  // Test runner — Claude Cowork parity Phase 3 step 12
  ipcMain.handle('test.detect', async () => {
    try {
      const { getTestRunnerBridge } = await import('../testing/test-runner-bridge');
      return await getTestRunnerBridge().detectFramework();
    } catch (err) {
      logError('[test.detect] failed:', err);
      return null;
    }
  });

  ipcMain.handle('test.run', async (_event, files?: string[]) => {
    try {
      const { getTestRunnerBridge } = await import('../testing/test-runner-bridge');
      return await getTestRunnerBridge().run(files ?? []);
    } catch (err) {
      logError('[test.run] failed:', err);
      return null;
    }
  });

  ipcMain.handle('test.catalog', async () => {
    try {
      const { getTestRunnerBridge } = await import('../testing/test-runner-bridge');
      return getTestRunnerBridge().getCatalog();
    } catch (err) {
      logError('[test.catalog] failed:', err);
      return [];
    }
  });

  ipcMain.handle('test.runCatalogItem', async (_event, id: string) => {
    try {
      const { getTestRunnerBridge } = await import('../testing/test-runner-bridge');
      return await getTestRunnerBridge().runCatalogItem(id);
    } catch (err) {
      logError('[test.runCatalogItem] failed:', err);
      return null;
    }
  });

  ipcMain.handle('test.runFailing', async () => {
    try {
      const { getTestRunnerBridge } = await import('../testing/test-runner-bridge');
      return await getTestRunnerBridge().runFailing();
    } catch (err) {
      logError('[test.runFailing] failed:', err);
      return null;
    }
  });

  ipcMain.handle('test.cancel', async () => {
    try {
      const { getTestRunnerBridge } = await import('../testing/test-runner-bridge');
      getTestRunnerBridge().cancel();
      return { success: true };
    } catch (_err) {
      return { success: false };
    }
  });

  ipcMain.handle('test.getState', async () => {
    try {
      const { getTestRunnerBridge } = await import('../testing/test-runner-bridge');
      return getTestRunnerBridge().getState();
    } catch (_err) {
      return null;
    }
  });
}
