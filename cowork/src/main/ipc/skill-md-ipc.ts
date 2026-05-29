import { ipcMain } from 'electron';
import type { SkillMdBridge } from '../skills/skill-md-bridge';

// Getter, not value: the bridge is assigned during async boot, AFTER this
// top-level registration runs. Resolve lazily per call (see command-ipc.ts).
export function registerSkillMdIpcHandlers(getBridge: () => SkillMdBridge | null) {
  ipcMain.handle('skillMd.list', async () => {
    const skillMdBridge = getBridge();
    if (!skillMdBridge) return [];
    return skillMdBridge.list();
  });

  ipcMain.handle('skillMd.search', async (_event, query: string, limit?: number) => {
    const skillMdBridge = getBridge();
    if (!skillMdBridge) return [];
    return skillMdBridge.search(query, limit);
  });

  ipcMain.handle('skillMd.findBest', async (_event, request: string) => {
    const skillMdBridge = getBridge();
    if (!skillMdBridge) return null;
    return skillMdBridge.findBest(request);
  });

  ipcMain.handle(
    'skillMd.execute',
    async (
      _event,
      skillName: string,
      context: { userInput?: string; workspaceRoot?: string; sessionId?: string }
    ) => {
      const skillMdBridge = getBridge();
      if (!skillMdBridge) {
        return { success: false, error: 'Skill bridge unavailable' };
      }
      return skillMdBridge.execute(skillName, context);
    }
  );
}
