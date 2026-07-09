import { ipcMain } from 'electron';
import { loadCoreModule } from '../utils/core-loader';
import { logError } from '../utils/logger';

interface WidgetRegistryModule {
  hasWidgetForData?: (data: unknown) => boolean;
  renderWidgetForData?: (data: unknown) => string | null;
}

function hasStructuredType(data: unknown): data is { type: string } {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { type?: unknown }).type === 'string'
  );
}

export function registerWidgetsIpcHandlers(): void {
  ipcMain.handle('widgets.render', async (_event, data: unknown): Promise<string | null> => {
    if (!hasStructuredType(data)) return null;

    try {
      const mod = await loadCoreModule<WidgetRegistryModule>('widgets/widget-registry.js');
      if (!mod?.renderWidgetForData) return null;
      if (mod.hasWidgetForData && !mod.hasWidgetForData(data)) return null;

      const html = mod.renderWidgetForData(data);
      return typeof html === 'string' && html.trim().length > 0 ? html : null;
    } catch (error) {
      logError('[widgets-ipc] failed to render widget:', error);
      return null;
    }
  });
}
