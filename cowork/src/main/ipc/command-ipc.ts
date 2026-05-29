import { ipcMain } from 'electron';
import type { SlashCommandBridge } from '../commands/slash-command-bridge';

/**
 * Register slash-command IPC handlers.
 *
 * Takes a GETTER, not the bridge value. These handlers are registered at module
 * top-level (synchronous eval), but `slashCommandBridge` is only assigned later,
 * during the async boot. Capturing the value here would pin `null` forever and
 * every `command.*` call would return "bridge unavailable" — which is exactly
 * what happened until the e2e smoke caught it. Resolving lazily via the getter
 * reads the post-boot instance. (Mirrors the `() => projectManager` getter
 * pattern used by the Hermes-surface handlers in `index.ts`.)
 */
export function registerCommandIpcHandlers(getBridge: () => SlashCommandBridge | null) {
  ipcMain.handle('command.list', async () => {
    const bridge = getBridge();
    if (!bridge) return [];
    return bridge.listCommands();
  });

  ipcMain.handle('command.autocomplete', async (_event, prefix: string, limit?: number) => {
    const bridge = getBridge();
    if (!bridge) return [];
    return bridge.autocomplete(prefix, limit);
  });

  ipcMain.handle(
    'command.execute',
    async (_event, name: string, args: string[], sessionId?: string) => {
      const bridge = getBridge();
      if (!bridge) {
        return { success: false, error: 'Slash command bridge unavailable' };
      }
      return bridge.execute(name, args, sessionId);
    }
  );
}
